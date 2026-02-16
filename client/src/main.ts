import * as THREE from 'three';

import { APP_NAME, DEFAULT_CAMERA_HEIGHT, FAR_CLIP, MAP_SIZE, NEAR_CLIP, CAMERA_FOV, MAX_PIXEL_RATIO } from './config';
import { testSupabaseConnection } from './supabase';
import { perfMonitor } from './core/perfMonitor';
import { createLogger } from './core/logger';
import { getStartupChecks, summarizeStartupChecks } from './startup';
import { QUALITY_PRESETS, QUALITY_PRESET_ORDER, QualityPresetManager } from './core/qualityManager';
import { gameEvents } from './core/eventBus';
import { ChunkLoader } from './world/chunkLoader';
import { WaterRenderer } from './world/waterRenderer';
import { ProvinceRenderer } from './world/provinceRenderer';
import { CityRenderer } from './world/cityDatabase';
import { TreeRenderer } from './world/treeRenderer';
import { CameraController } from './camera/cameraController';
import { PostProcessingPipeline } from './rendering/postProcessing';
import { generateProceduralChunk } from './world/proceduralChunk';
import type { QualityPreset } from './types';

const log = createLogger('main');

// ── Mount Points ────────────────────────────────────────────────

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App mount point #app missing');

const canvasContainer = document.createElement('div');
canvasContainer.style.width = '100%';
canvasContainer.style.height = '100%';
app.appendChild(canvasContainer);

const startupReport = getStartupChecks();
const startupStatus = summarizeStartupChecks(startupReport);
const qualityManager = new QualityPresetManager();
const qualityOptions = QUALITY_PRESET_ORDER
  .map((preset) => `<option value="${preset}">${QUALITY_PRESETS[preset].label}</option>`)
  .join('');

const hud = document.createElement('div');
hud.id = 'hud';
hud.innerHTML = `
  <h1>${APP_NAME}</h1>
  <div class="row" id="status">${startupStatus}</div>
  <div class="row" id="fps">FPS: ...</div>
  <div class="row" id="chunks">Chunks: ...</div>
  <div class="row" id="coords">Camera: x=0, y=0, z=0</div>
  <div class="row">
    <label for="quality-select">Quality</label>
    <select id="quality-select">${qualityOptions}</select>
  </div>
`;
app.appendChild(hud);

const toast = document.createElement('div');
toast.id = 'toast';
toast.innerHTML = `<div class="title">Imperium</div><div>Loading terrain...</div>`;
app.appendChild(toast);

const qualitySelect = document.querySelector<HTMLSelectElement>('#quality-select');
if (qualitySelect) {
  qualitySelect.value = qualityManager.currentPreset;
  qualitySelect.addEventListener('change', () => {
    const selected = qualitySelect.value as QualityPreset;
    const changed = qualityManager.setPreset(selected);
    if (changed) {
      applyQualityPreset(selected);
    }
  });
}

// ── Scene Setup ─────────────────────────────────────────────────

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0a1120, 800, 2000);
scene.background = new THREE.Color(0x07111b);

const camera = new THREE.PerspectiveCamera(
  CAMERA_FOV,
  window.innerWidth / window.innerHeight,
  NEAR_CLIP,
  FAR_CLIP,
);
camera.position.set(0, DEFAULT_CAMERA_HEIGHT, -24);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
renderer.setSize(window.innerWidth, window.innerHeight);
canvasContainer.appendChild(renderer.domElement);

// ── Camera Controller ────────────────────────────────────────────

const cameraController = new CameraController(camera, renderer.domElement, scene);
cameraController.orbitControls.target.set(0, 40, -24);

// ── Lighting ────────────────────────────────────────────────────

const ambientLight = new THREE.AmbientLight(0x8f9fb8, 0.6);
scene.add(ambientLight);

const sun = new THREE.DirectionalLight(0xfff0d0, 1.2);
sun.position.set(-1500, 3000, -1200);
scene.add(sun);

const fill = new THREE.DirectionalLight(0xb8c8e8, 0.3);
fill.position.set(1500, 1500, 1200);
scene.add(fill);

// ── Chunk-based Terrain ─────────────────────────────────────────

const chunkLoader = new ChunkLoader(scene, { loadRadius: 6, unloadRadius: 10 });

// ── Animated Water ──────────────────────────────────────────────

const water = new WaterRenderer(scene, {
  quality: QUALITY_PRESETS[qualityManager.currentPreset].waterShader,
});

// ── Post-Processing Pipeline ────────────────────────────────────

const postfx = new PostProcessingPipeline(renderer, scene, camera);
postfx.setQuality(qualityManager.currentPreset);

// ── Province Overlay ──────────────────────────────────────────────

const provinceRenderer = new ProvinceRenderer(scene);
provinceRenderer.setQuality(qualityManager.currentPreset);

// ── City Renderer ────────────────────────────────────────────────

const cityRenderer = new CityRenderer(scene);

// ── Tree Instances ───────────────────────────────────────────────

const treeRenderer = new TreeRenderer(scene);
treeRenderer.setMaxInstances(QUALITY_PRESETS[qualityManager.currentPreset].treeInstances);

// ── Chunk Data Listeners ─────────────────────────────────────────

// Feed province + tree data into their renderers as chunks load
gameEvents.on('chunk_loaded', ({ cx, cy }) => {
  const chunkData = generateProceduralChunk(cx, cy);
  provinceRenderer.updateChunkProvinces(cx, cy, chunkData.provinces);
  treeRenderer.updateChunkTrees(cx, cy, chunkData.heights, chunkData.biomes);
});

// ── Interaction ─────────────────────────────────────────────────

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

renderer.domElement.addEventListener('pointerdown', (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const cityData = cityRenderer.raycast(raycaster);
  if (cityData) {
    setToast(`Selected: ${cityData.name}`, `${cityData.culture}, Tier ${cityData.tier}`);
    gameEvents.emit('city_selected', cityData);
    // Fly camera to selected city
    const worldX = cityData.tileX - MAP_SIZE / 2;
    const worldZ = cityData.tileY - MAP_SIZE / 2;
    cameraController.jumpToCity(worldX, worldZ, 800);
  }
});

// ── Render Loop ─────────────────────────────────────────────────

let toastCleared = false;
const clock = new THREE.Clock();
let lastQualityPreset = qualityManager.currentPreset;

function animate(): void {
  requestAnimationFrame(animate);
  perfMonitor.beginFrame();

  const deltaTime = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  // Update camera controller (replaces OrbitControls.update)
  cameraController.update(deltaTime);

  // Update chunk loading based on camera position
  chunkLoader.update(camera.position.x, camera.position.z);

  // Update province overlay (camera-height dependent visibility)
  provinceRenderer.update(camera.position.y);

  // Update city markers (LOD zone transitions)
  cityRenderer.update(camera.position.y, camera.position.x, camera.position.z);

  // Update tree instances (camera-distance culled)
  treeRenderer.update(camera.position.x, camera.position.y, camera.position.z);

  // Update animated water
  water.update(elapsed, camera.position);

  // Render through post-processing pipeline
  postfx.render();

  perfMonitor.drawCalls = renderer.info.render.calls;
  perfMonitor.triangles = renderer.info.render.triangles;
  perfMonitor.endFrame();

  // Clear the loading toast after first chunks arrive
  if (!toastCleared && chunkLoader.loadedCount > 0) {
    toastCleared = true;
    setToast('Imperium', `${chunkLoader.loadedCount} chunks loaded`);
  }

  // Update HUD every 30 frames
  if (renderer.info.render.frame % 30 === 0) {
    const snap = perfMonitor.snapshot();
    const activeProfile = qualityManager.updateFromSnapshot(snap);

    // Sync quality across all systems when auto-adjusted
    if (activeProfile !== lastQualityPreset) {
      lastQualityPreset = activeProfile;
      applyQualityPreset(activeProfile);
      if (qualitySelect && qualitySelect.value !== activeProfile) {
        qualitySelect.value = activeProfile;
      }
    }

    const fpsNode = document.querySelector<HTMLDivElement>('#fps');
    if (fpsNode) {
      fpsNode.textContent = `FPS: ${snap.fps} | Draw: ${snap.drawCalls} | Tri: ${snap.triangles}`;
    }

    const chunksNode = document.querySelector<HTMLDivElement>('#chunks');
    if (chunksNode) {
      chunksNode.textContent = `Chunks: ${chunkLoader.loadedCount} loaded, ${chunkLoader.pendingCount} pending`;
    }

    const coordsNode = document.querySelector<HTMLDivElement>('#coords');
    if (coordsNode) {
      coordsNode.textContent = `Camera: x=${camera.position.x.toFixed(0)}, y=${camera.position.y.toFixed(0)}, z=${camera.position.z.toFixed(0)}`;
    }
  }
}
animate();
log.info('Render loop started');

// ── Quality Preset Sync ─────────────────────────────────────────

function applyQualityPreset(preset: QualityPreset): void {
  const config = QUALITY_PRESETS[preset];
  postfx.setQuality(preset);
  water.setQuality(config.waterShader);
  provinceRenderer.setQuality(preset);
  treeRenderer.setMaxInstances(config.treeInstances);

  const statusNode = document.querySelector<HTMLDivElement>('#status');
  if (statusNode) {
    statusNode.textContent = `Quality profile: ${config.label}`;
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function setToast(title: string, body: string): void {
  toast.innerHTML = `<div class="title">${title}</div><div>${body}</div>`;
}

// ── Resize Handler ──────────────────────────────────────────────

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx.setSize(window.innerWidth, window.innerHeight);
});

// ── Supabase Connection Check ───────────────────────────────────

testSupabaseConnection().then((isOnline) => {
  const statusNode = document.querySelector<HTMLDivElement>('#status');
  if (statusNode) {
    statusNode.textContent = `Supabase: ${isOnline ? 'connected' : 'not configured'}`;
  }
});
