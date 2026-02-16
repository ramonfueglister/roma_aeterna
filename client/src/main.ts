import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { APP_NAME, DEFAULT_CAMERA_HEIGHT, FAR_CLIP, MAP_SIZE, NEAR_CLIP, CAMERA_FOV, MAX_PIXEL_RATIO } from './config';
import { testSupabaseConnection } from './supabase';
import { perfMonitor } from './core/perfMonitor';
import { createLogger } from './core/logger';
import { getStartupChecks, summarizeStartupChecks } from './startup';
import { QUALITY_PRESETS, QUALITY_PRESET_ORDER, QualityPresetManager } from './core/qualityManager';
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
  <div class="row" id="net">Net: ...</div>
  <div class="row" id="coords">Camera: x=0, y=0, z=0</div>
  <div class="row">
    <label for="quality-select">Quality</label>
    <select id="quality-select">${qualityOptions}</select>
  </div>
`;
app.appendChild(hud);

const toast = document.createElement('div');
toast.id = 'toast';
toast.innerHTML = `<div class="title">Imperium started</div><div>Base scaffold active.</div>`;
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
scene.fog = new THREE.Fog(0x0a1120, 1200, 2600);
scene.background = new THREE.Color(0x07111b);

const camera = new THREE.PerspectiveCamera(
  CAMERA_FOV,
  window.innerWidth / window.innerHeight,
  NEAR_CLIP,
  FAR_CLIP,
);
camera.position.set(2600, DEFAULT_CAMERA_HEIGHT, 2400);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
renderer.setSize(window.innerWidth, window.innerHeight);
canvasContainer.appendChild(renderer.domElement);

// ── Controls ────────────────────────────────────────────────────

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 200;
controls.maxDistance = 5000;

// ── Lighting ────────────────────────────────────────────────────

const ambientLight = new THREE.AmbientLight(0x8f9fb8, 0.55);
scene.add(ambientLight);

const sun = new THREE.DirectionalLight(0xfff8e8, 1.1);
sun.position.set(2000, 3200, 1800);
scene.add(sun);

// ── Placeholder Terrain ─────────────────────────────────────────

const terrainGroup = buildTerrainGroup();
scene.add(terrainGroup);

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

function animate(): void {
  requestAnimationFrame(animate);
  perfMonitor.beginFrame();

  controls.update();
  renderer.render(scene, camera);

  perfMonitor.drawCalls = renderer.info.render.calls;
  perfMonitor.triangles = renderer.info.render.triangles;
  perfMonitor.endFrame();

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
      fpsNode.textContent = `FPS: ${snap.fps} | Quality: ${QUALITY_PRESETS[activeProfile].label} | Draw: ${snap.drawCalls} | Tri: ${snap.triangles}`;
    }

    const netNode = document.querySelector<HTMLDivElement>('#net');
    if (netNode) {
      netNode.textContent = `Net: ${getNetworkStatus()}`;
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

function buildTerrainGroup(): THREE.Group {
  const group = new THREE.Group();
  const segments = 144;
  const geom = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, segments, segments);
  geom.rotateX(-Math.PI / 2);

  const positions = geom.attributes['position'] as THREE.BufferAttribute;
  const colors: number[] = [];

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const noise = simpleNoise(x, z);
    const height = 16 + noise * 80;
    positions.setY(i, height);

    const c = biomeColorFromNoise(noise);
    colors.push(c.r, c.g, c.b);
  }
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  positions.needsUpdate = true;

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: false,
    side: THREE.DoubleSide,
    roughness: 0.95,
    metalness: 0.02,
  });
  group.add(new THREE.Mesh(geom, mat));
  return group;
}

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

function simpleNoise(x: number, z: number): number {
  const nx = Math.sin(x * 0.013) + Math.cos(z * 0.011);
  const ny = Math.cos(x * 0.006) * Math.sin(z * 0.007);
  return (nx + ny + 2) / 4;
}

function biomeColorFromNoise(n: number): THREE.Color {
  if (n < 0.18) return new THREE.Color(0x1a3a5c);
  if (n < 0.33) return new THREE.Color(0x2d5f8a);
  if (n < 0.52) return new THREE.Color(0xc4a854);
  if (n < 0.72) return new THREE.Color(0x5a8a3c);
  return new THREE.Color(0x6a6a6a);
}

function setToast(title: string, body: string): void {
  toast.innerHTML = `<div class="title">${title}</div><div>${body}</div>`;
}

function getNetworkStatus(): string {
  const hasEffectiveConnection = 'connection' in navigator;
  if (!hasEffectiveConnection) {
    return navigator.onLine ? 'online' : 'offline';
  }

  const connection = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number } }).connection;
  if (!connection) {
    return navigator.onLine ? 'online' : 'offline';
  }

  const parts = [];
  if (connection.effectiveType) {
    parts.push(connection.effectiveType);
  }
  if (typeof connection.downlink === 'number') {
    parts.push(`${Math.round(connection.downlink)} Mbps`);
  }

  if (parts.length > 0) {
    return parts.join(' / ');
  }

  return navigator.onLine ? 'online' : 'offline';
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
