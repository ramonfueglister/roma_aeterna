/**
 * Application entry point.
 *
 * Creates the Engine, registers all game systems in order, and starts
 * the render loop. Each system is self-contained and manages its own
 * lifecycle through the GameSystem interface.
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
  PostProcessingSystem,
  HudSystem,
  InteractionSystem,
} from './engine/systems';
import { testSupabaseConnection } from './supabase';

// ── Bootstrap ─────────────────────────────────────────────────────

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App mount point #app missing');

const engine = new Engine(app);

// Register systems in update order:
// 1. Camera first (other systems read camera position)
// 2. Terrain (loads chunks based on camera)
// 3. World renderers (provinces, cities, trees, water)
// 4. Post-processing (renders the final frame)
// 5. HUD + interaction (UI overlay, input handling)
engine.register(new CameraSystem());
engine.register(new TerrainSystem());
engine.register(new WaterSystem());
engine.register(new ProvinceSystem());
engine.register(new CitySystem());
engine.register(new TreeSystem());
engine.register(new PostProcessingSystem());
engine.register(new HudSystem());
engine.register(new InteractionSystem());

engine.start();

// ── Supabase Connection Check ─────────────────────────────────────

testSupabaseConnection().then((isOnline) => {
  const statusNode = document.querySelector<HTMLDivElement>('#status');
  if (statusNode) {
    statusNode.textContent = `Supabase: ${isOnline ? 'connected' : 'not configured'}`;
  }
});
