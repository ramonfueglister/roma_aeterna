/**
 * Application entry point.
 *
 * Loads heightmap data, creates the Engine, registers all game systems
 * in order, and starts the render loop.
 *
 * System registration order matters: systems update() in this order.
 */

import { Engine } from './engine/Engine';
import {
  CameraSystem,
  TerrainSystem,
  WaterSystem,
  ProvinceSystem,
  CitySystem,
  TreeSystem,
  TextLabelSystem,
  RoadSystem,
  AgentSystem,
  ParticleSystemWrapper,
  PostProcessingSystem,
  HudSystem,
  InteractionSystem,
} from './engine/systems';
import { testSupabaseConnection } from './supabase';
import { loadHeightmaps } from './world/heightmapLoader';

// ECS
import {
  world,
  createCameraEntity,
  setCameraRef,
  setChunkLoaderRef,
  setCityRendererRef,
  setTreeRendererRef,
  setAgentRendererRef,
  setLabelRendererRef,
  setProvinceRendererRef,
} from './ecs';

// ── Bootstrap ─────────────────────────────────────────────────────

async function init(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('App mount point #app missing');

  // Load heightmap and province map before engine starts
  await loadHeightmaps();

  const engine = new Engine(app);

  // Register systems in update order:
  // 1. Camera first (other systems read camera position)
  // 2. Terrain (loads chunks based on camera)
  // 3. World renderers (provinces, cities, trees, water)
  // 4. Text labels (SDF labels for cities and provinces)
  // 5. Post-processing (renders the final frame)
  // 6. HUD + interaction (UI overlay, input handling)
  engine.register(new CameraSystem());
  engine.register(new TerrainSystem());
  engine.register(new WaterSystem());
  engine.register(new ProvinceSystem());
  engine.register(new CitySystem());
  engine.register(new TreeSystem());
  engine.register(new TextLabelSystem());
  engine.register(new RoadSystem());
  engine.register(new AgentSystem());
  engine.register(new ParticleSystemWrapper());
  engine.register(new PostProcessingSystem());
  engine.register(new HudSystem());
  engine.register(new InteractionSystem());

  // ── ECS Initialization ──────────────────────────────────────────
  // Create singleton camera entity and wire Three.js camera ref
  createCameraEntity(world);
  setCameraRef(engine.camera);

  // Wire renderer refs so ECS systems can delegate to existing renderers
  const terrainSys = engine.getSystem<TerrainSystem>('terrain');
  if (terrainSys) setChunkLoaderRef(terrainSys.loader);

  const citySys = engine.getSystem<CitySystem>('cities');
  if (citySys) setCityRendererRef(citySys.renderer);

  const treeSys = engine.getSystem<TreeSystem>('trees');
  if (treeSys) setTreeRendererRef(treeSys.renderer);

  const agentSys = engine.getSystem<AgentSystem>('agents');
  if (agentSys) setAgentRendererRef(agentSys.renderer);

  const labelSys = engine.getSystem<TextLabelSystem>('textLabels');
  if (labelSys) setLabelRendererRef(labelSys.renderer);

  const provinceSys = engine.getSystem<ProvinceSystem>('provinces');
  if (provinceSys) setProvinceRendererRef(provinceSys.renderer);

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
