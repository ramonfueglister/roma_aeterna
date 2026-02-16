import './main.css';

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

import { APP_NAME, DEFAULT_CAMERA_HEIGHT, FAR_CLIP, MAP_SIZE } from './config';
import { testSupabaseConnection } from './supabase';
import { type CityMarker } from './types';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('App mount point missing');
}

const canvasContainer = document.createElement('div');
canvasContainer.style.width = '100%';
canvasContainer.style.height = '100%';
app.appendChild(canvasContainer);

const hud = document.createElement('div');
hud.id = 'hud';
hud.innerHTML = `
  <h1>${APP_NAME}</h1>
  <div class="row" id="status">Supabase: checking…</div>
  <div class="row" id="fps">FPS: ...</div>
  <div class="row" id="coords">Kamera: x=0, y=0, z=0</div>
  <div class="row">Interaktion: Ziehen = Kamera, Mausrad = Zoom, Klick auf Stadt = Details</div>
`;
app.appendChild(hud);

const toast = document.createElement('div');
toast.id = 'toast';
toast.innerHTML = `<div class="title">Imperium gestartet</div><div>Basisgerüst aktiv. Supabase optional konfiguriert.</div>`;
app.appendChild(toast);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0a1120, 1200, 2600);
scene.background = new THREE.Color(0x07111b);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, FAR_CLIP);
camera.position.set(2600, DEFAULT_CAMERA_HEIGHT, 2400);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
canvasContainer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 200;
controls.maxDistance = 5000;

const ambientLight = new THREE.AmbientLight(0x8f9fb8, 0.55);
scene.add(ambientLight);

const sun = new THREE.DirectionalLight(0xfff8e8, 1.1);
sun.position.set(2000, 3200, 1800);
sun.castShadow = false;
scene.add(sun);

const terrain = buildTerrainGroup();
scene.add(terrain.group);

const cityGroup = new THREE.Group();
scene.add(cityGroup);

const knownCities: CityMarker[] = [
  { id: 'roma', name: 'Roma', tileX: 1024, tileY: 1000, culture: 'roman', size: 'metropolis', provinceNumber: 27, color: 0xc2a255 },
  { id: 'aqua', name: 'Aqua Ilva', tileX: 1140, tileY: 1120, culture: 'roman', size: 'medium', provinceNumber: 39, color: 0x77b07a },
  { id: 'alex', name: 'Alexandria', tileX: 1280, tileY: 1245, culture: 'egyptian', size: 'metropolis', provinceNumber: 2, color: 0xd39e5d },
  { id: 'carth', name: 'Carthago', tileX: 840, tileY: 1185, culture: 'roman', size: 'large', provinceNumber: 3, color: 0xd49a61 },
  { id: 'athen', name: 'Athenae', tileX: 1130, tileY: 940, culture: 'greek', size: 'large', provinceNumber: 1, color: 0x6f8bbf },
];

for (const city of knownCities) {
  const marker = createCityMarker(city);
  cityGroup.add(marker);
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

renderer.domElement.addEventListener('pointerdown', (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(cityGroup.children, true);
  if (hits.length > 0) {
    const hit = hits[0].object;
    const city = cityGroup.children.find((cityObj) => cityObj === hit || cityObj.children.includes(hit));
    const marker = city?.userData as CityMarker | undefined;
    if (marker) {
      setToast(`Auswahl: ${marker.name} (${marker.culture}, Größe: ${marker.size})`, 'Stadt markiert');
    }
  }
});

let lastFpsTime = performance.now();
let frames = 0;

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);

  frames += 1;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    const fps = Math.round((frames * 1000) / (now - lastFpsTime));
    const fpsNode = document.querySelector<HTMLDivElement>('#fps');
    if (fpsNode) fpsNode.textContent = `FPS: ${fps}`;
    frames = 0;
    lastFpsTime = now;
  }
  const coordsNode = document.querySelector<HTMLDivElement>('#coords');
  if (coordsNode) {
    coordsNode.textContent = `Kamera: x=${camera.position.x.toFixed(0)}, y=${camera.position.y.toFixed(0)}, z=${camera.position.z.toFixed(0)}`;
  }
}
animate();

function buildTerrainGroup(): { group: THREE.Group } {
  const group = new THREE.Group();
  const plane = buildTerrainMesh();
  group.add(plane);
  group.add(buildGrid());
  return { group };
}

function buildTerrainMesh(): THREE.Mesh {
  const segments = 144;
  const geom = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, segments, segments);
  geom.rotateX(-Math.PI / 2);

  const positions = geom.attributes.position as THREE.BufferAttribute;
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
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(0, 0, 0);
  mesh.receiveShadow = false;

  return mesh;
}

function buildGrid(): THREE.LineSegments {
  const size = 400;
  const divisions = 40;
  const grid = new THREE.GridHelper(size, divisions, 0x253142, 0x1a2532);
  grid.position.set(0, 0.1, 0);
  return grid;
}

function createCityMarker(city: CityMarker): THREE.Object3D {
  const worldX = city.tileX - MAP_SIZE / 2;
  const worldZ = city.tileY - MAP_SIZE / 2;
  const material = new THREE.MeshStandardMaterial({ color: city.color });
  const group = new THREE.Group();
  group.position.set(worldX, 70, worldZ);
  group.userData = city;

  const geometry = new THREE.BoxGeometry(24, 24, 24);
  const core = new THREE.Mesh(geometry, material);
  core.position.y = 12;
  group.add(core);

  const label = createLabelCanvas(city.name, city.color);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(label),
      transparent: true,
      color: 0xffffff,
      depthTest: false,
    }),
  );
  sprite.position.set(0, 110, 0);
  sprite.scale.set(180, 60, 1);
  sprite.userData = city;
  group.add(sprite);

  return group;
}

function createLabelCanvas(text: string, color: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const w = 512;
  const h = 128;
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d');
  if (!context) {
    return canvas;
  }
  context.clearRect(0, 0, w, h);
  context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  context.fillRect(8, 8, 14, 14);
  context.font = 'bold 36px Georgia, serif';
  context.fillStyle = '#f1eadc';
  context.strokeStyle = 'rgba(10,18,30,0.8)';
  context.lineWidth = 4;
  context.strokeText(text, 34, 48);
  context.fillText(text, 34, 48);
  return canvas;
}

function simpleNoise(x: number, z: number): number {
  const nx = Math.sin(x * 0.013) + Math.cos(z * 0.011);
  const ny = Math.cos(x * 0.006) * Math.sin(z * 0.007);
  return (nx + ny + 2) / 4;
}

function biomeColorFromNoise(n: number): THREE.Color {
  if (n < 0.18) return new THREE.Color(0x2e3f79);
  if (n < 0.33) return new THREE.Color(0x4f6f8a);
  if (n < 0.52) return new THREE.Color(0xa58f47);
  if (n < 0.72) return new THREE.Color(0x3f6f44);
  return new THREE.Color(0x6f7f73);
}

function setToast(title: string, body: string): void {
  toast.innerHTML = `<div class="title">${title}</div><div>${body}</div>`;
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

testSupabaseConnection().then((isOnline) => {
  const statusNode = document.querySelector<HTMLDivElement>('#status');
  if (statusNode) {
    statusNode.textContent = `Supabase: ${isOnline ? 'verbunden' : 'nicht konfiguriert'}`;
  }
});
