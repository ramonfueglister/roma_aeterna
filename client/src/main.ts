import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { APP_NAME, DEFAULT_CAMERA_HEIGHT, FAR_CLIP, MAP_SIZE, NEAR_CLIP, CAMERA_FOV, MAX_PIXEL_RATIO } from './config';
import { testSupabaseConnection } from './supabase';
import { perfMonitor } from './core/perfMonitor';
import { createLogger } from './core/logger';
import { getStartupChecks, summarizeStartupChecks } from './startup';
import { QUALITY_PRESETS, QUALITY_PRESET_ORDER, QualityPresetManager } from './core/qualityManager';
import { ChunkLoader } from './world/chunkLoader';
import type { CityData, CityTier, CultureType } from './types';

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
    const selected = qualitySelect.value as 'high' | 'medium' | 'low' | 'toaster';
    const changed = qualityManager.setPreset(selected);
    if (changed) {
      const statusNode = document.querySelector<HTMLDivElement>('#status');
      if (statusNode) {
        statusNode.textContent = `Quality profile: ${QUALITY_PRESETS[selected].label}`;
      }
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
// Start above Roma (tile 1024,1000 -> world 0, -24)
camera.position.set(0, DEFAULT_CAMERA_HEIGHT, -24);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
renderer.setSize(window.innerWidth, window.innerHeight);
canvasContainer.appendChild(renderer.domElement);

// ── Controls ────────────────────────────────────────────────────

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 40, -24);
controls.maxPolarAngle = Math.PI * 0.45;
controls.minDistance = 100;
controls.maxDistance = 4000;

// ── Lighting ────────────────────────────────────────────────────

const ambientLight = new THREE.AmbientLight(0x8f9fb8, 0.6);
scene.add(ambientLight);

// Warm golden-hour sun from the southwest
const sun = new THREE.DirectionalLight(0xfff0d0, 1.2);
sun.position.set(-1500, 3000, -1200);
scene.add(sun);

// Fill light from opposite side
const fill = new THREE.DirectionalLight(0xb8c8e8, 0.3);
fill.position.set(1500, 1500, 1200);
scene.add(fill);

// ── Chunk-based Terrain ─────────────────────────────────────────

const chunkLoader = new ChunkLoader(scene, { loadRadius: 6, unloadRadius: 10 });

// ── Water Plane ─────────────────────────────────────────────────

const waterGeometry = new THREE.PlaneGeometry(MAP_SIZE * 1.5, MAP_SIZE * 1.5);
waterGeometry.rotateX(-Math.PI / 2);
const waterMaterial = new THREE.MeshStandardMaterial({
  color: 0x1a3a5c,
  transparent: true,
  opacity: 0.85,
  roughness: 0.3,
  metalness: 0.1,
});
const waterPlane = new THREE.Mesh(waterGeometry, waterMaterial);
waterPlane.position.y = 19; // Just below WATER_LEVEL (20)
scene.add(waterPlane);

// ── Placeholder Cities ──────────────────────────────────────────

const cityGroup = new THREE.Group();
scene.add(cityGroup);

const knownCities: CityData[] = [
  { id: 'roma', name: 'Roma', latinName: 'Roma', tileX: 1024, tileY: 1000, tier: 1 as CityTier, culture: 'roman' as CultureType, population: 1000000, provinceId: 27, isPort: false, isCapital: true },
  { id: 'alex', name: 'Alexandria', latinName: 'Alexandria', tileX: 1280, tileY: 1245, tier: 1 as CityTier, culture: 'egyptian' as CultureType, population: 500000, provinceId: 2, isPort: true, isCapital: true },
  { id: 'carth', name: 'Carthago', latinName: 'Carthago', tileX: 840, tileY: 1185, tier: 2 as CityTier, culture: 'north_african' as CultureType, population: 300000, provinceId: 3, isPort: true, isCapital: true },
  { id: 'athen', name: 'Athenae', latinName: 'Athenae', tileX: 1130, tileY: 940, tier: 2 as CityTier, culture: 'greek' as CultureType, population: 250000, provinceId: 1, isPort: true, isCapital: true },
];

for (const city of knownCities) {
  const marker = createCityMarker(city);
  cityGroup.add(marker);
}

// ── Interaction ─────────────────────────────────────────────────

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

renderer.domElement.addEventListener('pointerdown', (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(cityGroup.children, true);
  if (hits.length > 0) {
    const hit = hits[0];
    if (hit) {
      const cityObj = cityGroup.children.find(
        (c) => c === hit.object || c.children.includes(hit.object),
      );
      const cityData = cityObj?.userData as CityData | undefined;
      if (cityData) {
        setToast(`Selected: ${cityData.name}`, `${cityData.culture}, Tier ${cityData.tier}`);
      }
    }
  }
});

// ── Render Loop ─────────────────────────────────────────────────

let toastCleared = false;

function animate(): void {
  requestAnimationFrame(animate);
  perfMonitor.beginFrame();

  controls.update();

  // Update chunk loading based on camera position
  chunkLoader.update(camera.position.x, camera.position.z);

  renderer.render(scene, camera);

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
    if (qualitySelect && qualitySelect.value !== activeProfile) {
      qualitySelect.value = activeProfile;
      const statusNode = document.querySelector<HTMLDivElement>('#status');
      if (statusNode) {
        statusNode.textContent = `Quality profile: ${QUALITY_PRESETS[activeProfile].label}`;
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

// ── Helpers ─────────────────────────────────────────────────────

function createCityMarker(city: CityData): THREE.Object3D {
  const worldX = city.tileX - MAP_SIZE / 2;
  const worldZ = city.tileY - MAP_SIZE / 2;
  const group = new THREE.Group();
  group.position.set(worldX, 70, worldZ);
  group.userData = city;

  const size = city.tier === 1 ? 24 : city.tier === 2 ? 18 : 12;
  const color = city.culture === 'roman' ? 0xc2a255 : city.culture === 'greek' ? 0x6f8bbf : 0xd49a61;
  const geometry = new THREE.BoxGeometry(size, size, size);
  const material = new THREE.MeshStandardMaterial({ color });
  const core = new THREE.Mesh(geometry, material);
  core.position.y = size / 2;
  group.add(core);

  return group;
}

function setToast(title: string, body: string): void {
  toast.innerHTML = `<div class="title">${title}</div><div>${body}</div>`;
}

// ── Resize Handler ──────────────────────────────────────────────

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Supabase Connection Check ───────────────────────────────────

testSupabaseConnection().then((isOnline) => {
  const statusNode = document.querySelector<HTMLDivElement>('#status');
  if (statusNode) {
    statusNode.textContent = `Supabase: ${isOnline ? 'connected' : 'not configured'}`;
  }
});
