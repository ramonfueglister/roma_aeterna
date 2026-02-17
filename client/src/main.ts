/**
 * Application entry point.
 *
 * Creates the Engine, instantiates all renderers/controllers,
 * wires ECS system refs, hydrates game entities, and starts
 * the render loop.
 *
 * The ECS pipeline is the sole update path. Renderers are created
 * here, their refs are injected into ECS systems, and the Engine
 * manages only the frame loop and Three.js infrastructure.
 */

import * as THREE from 'three';
import { Engine } from './engine/Engine';
import { MAP_SIZE, PROVINCE_COUNT } from './config';
import { gameEvents } from './core/eventBus';
import { testSupabaseConnection } from './supabase';
import { loadHeightmaps, getHeightmapData, sampleHeight, hasHeightmap } from './world/heightmapLoader';
import { generateProceduralChunk } from './world/proceduralChunk';

// Renderers & Controllers
import { CameraController } from './camera/cameraController';
import { ChunkLoader } from './world/chunkLoader';
import { WorkerPool } from './workers/workerPool';
import { WaterRenderer } from './world/waterRenderer';
import { ProvinceRenderer } from './world/provinceRenderer';
import { CityRenderer, CITY_DATABASE } from './world/cityDatabase';
import { TreeRenderer } from './world/treeRenderer';
import { TextLabelRenderer } from './world/textLabels';
import { RoadRenderer } from './world/roadRenderer';
import { AgentRenderer } from './world/agentRenderer';
import { ParticleSystem } from './world/particleSystem';
import { PostProcessingPipeline } from './rendering/postProcessing';
import { PROVINCE_DATABASE } from './world/provinceDatabase';

// ECS
import {
  world,
  createCameraEntity,
  createProvinceEntity,
  createCityEntity,
  Position,
  CityInfo,
  ProvinceTag,
  Culture,
  // System ref setters
  setCameraRef,
  setControllerRef,
  setChunkLoaderRef,
  setCityRendererRef,
  setTreeRendererRef,
  setAgentRendererRef,
  setLabelRendererRef,
  setProvinceRendererRef,
  setWaterRendererRef,
  setRoadRendererRef,
  setParticleSystemRef,
  setPostProcessingRef,
  setHudRef,
  setToast,
} from './ecs';
import type { HudElements } from './ecs';
import type { CultureType } from './types';

// ── Culture string → ECS enum mapping ────────────────────────────

const CULTURE_MAP: Record<CultureType, number> = {
  roman: Culture.ROMAN,
  greek: Culture.GREEK,
  egyptian: Culture.EGYPTIAN,
  celtic: Culture.CELTIC,
  germanic: Culture.GERMANIC,
  north_african: Culture.NORTH_AFRICAN,
  eastern: Culture.EASTERN,
  levantine: Culture.EASTERN,
  dacian: Culture.CELTIC,
};

// ── Entity Hydration ─────────────────────────────────────────────

/** Create ECS province entities (1 per province, IDs 1-41). */
function hydrateProvinceEntities(): void {
  for (let i = 1; i <= PROVINCE_COUNT; i++) {
    const eid = createProvinceEntity(world);
    ProvinceTag.number[eid] = i;
  }
}

/** Hydrate ECS city entities from the static city database. */
function hydrateCityEntities(): void {
  const halfMap = MAP_SIZE / 2;
  const useHm = hasHeightmap();
  for (const city of CITY_DATABASE) {
    const eid = createCityEntity(world);

    Position.x[eid] = city.tileX - halfMap;
    Position.y[eid] = useHm ? (sampleHeight(city.tileX, city.tileY) ?? 0) : 0;
    Position.z[eid] = city.tileY - halfMap;

    CityInfo.tier[eid] = city.tier;
    CityInfo.culture[eid] = CULTURE_MAP[city.culture] ?? Culture.ROMAN;
    CityInfo.population[eid] = city.population;
    CityInfo.provinceNumber[eid] = city.provinceId;
    CityInfo.isHarbor[eid] = city.isPort ? 1 : 0;
    CityInfo.isCapital[eid] = city.isCapital ? 1 : 0;
  }
}

// ── HUD Creation ─────────────────────────────────────────────────

function createHud(mountPoint: HTMLElement): HudElements {
  const hudEl = document.createElement('div');
  hudEl.id = 'hud';
  hudEl.innerHTML = `
    <h1>Imperium</h1>
    <div class="row" id="status">Loading...</div>
    <div class="row" id="fps">FPS: ...</div>
    <div class="row" id="chunks">Chunks: ...</div>
    <div class="row" id="coords">Camera: x=0, y=0, z=0</div>
  `;
  mountPoint.appendChild(hudEl);

  const toastEl = document.createElement('div');
  toastEl.id = 'toast';
  toastEl.innerHTML = `<div class="title">Imperium</div><div>Loading terrain...</div>`;
  mountPoint.appendChild(toastEl);

  return {
    fpsNode: document.querySelector('#fps'),
    chunksNode: document.querySelector('#chunks'),
    coordsNode: document.querySelector('#coords'),
    toastEl,
    dispose() {
      hudEl.remove();
      toastEl.remove();
    },
  };
}

// ── Interaction Setup ────────────────────────────────────────────

function setupInteraction(
  engine: Engine,
  cityRenderer: CityRenderer,
  cameraController: CameraController,
): () => void {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const onPointerDown = (event: PointerEvent): void => {
    const rect = engine.renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, engine.camera);

    const cityData = cityRenderer.raycast(raycaster);
    if (cityData) {
      setToast(`Selected: ${cityData.name}`, `${cityData.culture}, Tier ${cityData.tier}`);
      gameEvents.emit('city_selected', cityData);

      const worldX = cityData.tileX - MAP_SIZE / 2;
      const worldZ = cityData.tileY - MAP_SIZE / 2;
      cameraController.jumpToCity(worldX, worldZ, 800);
    }
  };

  engine.renderer.domElement.addEventListener('pointerdown', onPointerDown);

  const unsubClosePanel = gameEvents.on('close_panel', () => {
    gameEvents.emit('city_selected', null);
    gameEvents.emit('agent_selected', null);
    gameEvents.emit('province_selected', null);
  });

  return () => {
    engine.renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    unsubClosePanel();
  };
}

// ── Bootstrap ────────────────────────────────────────────────────

async function init(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('App mount point #app missing');

  // Load heightmap and province map before engine starts
  await loadHeightmaps();

  const engine = new Engine(app);
  await engine.init();

  // ── Create all renderers/controllers ──────────────────────────

  const cameraController = new CameraController(engine.camera, engine.renderer.domElement, engine.scene);
  cameraController.orbitControls.target.set(0, 40, -24);

  const workerPool = new WorkerPool(4);
  const chunkLoader = new ChunkLoader(engine.scene, {
    loadRadius: 6,
    unloadRadius: 10,
    workerPool,
  });

  const waterRenderer = new WaterRenderer(engine.scene);
  if (hasHeightmap()) {
    const hmData = getHeightmapData();
    if (hmData) {
      const tex = new THREE.DataTexture(
        hmData,
        MAP_SIZE,
        MAP_SIZE,
        THREE.RedFormat,
        THREE.UnsignedByteType,
      );
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      waterRenderer.setHeightmapTexture(tex);
    }
  }

  const provinceRenderer = new ProvinceRenderer(engine.scene);
  const cityRenderer = new CityRenderer(engine.scene);
  const treeRenderer = new TreeRenderer(engine.scene);

  const labelRenderer = new TextLabelRenderer(engine.scene);
  labelRenderer.setCities([...CITY_DATABASE]);
  labelRenderer.setProvinces([...PROVINCE_DATABASE]);

  const roadRenderer = new RoadRenderer(engine.scene);
  const agentRenderer = new AgentRenderer(engine.scene);
  const particleSystem = new ParticleSystem(engine.scene);
  const postProcessing = new PostProcessingPipeline(engine.renderer, engine.scene, engine.camera);

  // ── Event listeners ───────────────────────────────────────────

  const unsubChunkTree = gameEvents.on('chunk_loaded', ({ cx, cy }) => {
    const chunkData = generateProceduralChunk(cx, cy);
    treeRenderer.updateChunkTrees(cx, cy, chunkData.heights, chunkData.biomes);
    provinceRenderer.updateChunkProvinces(cx, cy, chunkData.provinces);
  });

  const unsubOverlay = gameEvents.on('toggle_overlay', () => {
    provinceRenderer.toggleVisible();
  });

  // ── Wire ECS system refs ──────────────────────────────────────

  setCameraRef(engine.camera);
  setControllerRef(cameraController);
  setChunkLoaderRef(chunkLoader);
  setCityRendererRef(cityRenderer);
  setTreeRendererRef(treeRenderer);
  setAgentRendererRef(agentRenderer);
  setLabelRendererRef(labelRenderer);
  setProvinceRendererRef(provinceRenderer);
  setWaterRendererRef(waterRenderer);
  setRoadRendererRef(roadRenderer);
  setParticleSystemRef(particleSystem);
  setPostProcessingRef(postProcessing);

  // ── HUD ───────────────────────────────────────────────────────

  const mount = engine.container.parentElement;
  if (mount) {
    const hud = createHud(mount);
    setHudRef(hud);
    engine.onDispose(() => hud.dispose());
  }

  // ── Interaction ───────────────────────────────────────────────

  const disposeInteraction = setupInteraction(engine, cityRenderer, cameraController);

  // ── ECS entity hydration ──────────────────────────────────────

  createCameraEntity(world);
  hydrateCityEntities();
  hydrateProvinceEntities();

  // ── Resize & Dispose ──────────────────────────────────────────

  engine.onResize((w, h) => postProcessing.setSize(w, h));

  engine.onDispose(() => {
    unsubChunkTree();
    unsubOverlay();
    disposeInteraction();
    cameraController.dispose();
    chunkLoader.dispose();
    workerPool.dispose();
    waterRenderer.dispose();
    provinceRenderer.dispose();
    cityRenderer.dispose();
    treeRenderer.dispose();
    labelRenderer.dispose();
    roadRenderer.dispose();
    agentRenderer.dispose();
    particleSystem.dispose();
    postProcessing.dispose();
  });

  // ── Start ─────────────────────────────────────────────────────

  engine.start();

  // ── Supabase Connection Check ─────────────────────────────────

  testSupabaseConnection().then((isOnline) => {
    const statusNode = document.querySelector<HTMLDivElement>('#status');
    if (statusNode) {
      statusNode.textContent = `Supabase: ${isOnline ? 'connected' : 'not configured'}`;
    }
  });
}

init().catch((e) => {
  console.error('Failed to initialize:', e);
});
