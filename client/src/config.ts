/**
 * Global constants for the Imperium voxel world.
 * All magic numbers live here, nowhere else.
 */

// ── Map Dimensions ──────────────────────────────────────────────
export const APP_NAME = 'Imperium';
export const MAP_SIZE = 2048;
export const CHUNK_SIZE = 32;
export const GRID_SIZE = MAP_SIZE / CHUNK_SIZE; // 64 chunks per axis
export const TOTAL_CHUNKS = GRID_SIZE * GRID_SIZE; // 4096
export const CHUNK_BYTES = 4104; // 8 header + 4 * 1024 data

// ── LOD ─────────────────────────────────────────────────────────
export const LOD_LEVELS = 4;
export const LOD_DISTANCES = [200, 500, 1000, Infinity] as const;
export const LOD_TRANSITION_RANGE = 150; // alpha blend zone in world units

// ── Camera ──────────────────────────────────────────────────────
export const DEFAULT_CAMERA_HEIGHT = 1800;
export const MIN_ZOOM = 50;
export const MAX_ZOOM = 5000;
export const FAR_CLIP = 12000;
export const NEAR_CLIP = 0.1;
export const CAMERA_FOV = 45;

// ── Rendering ───────────────────────────────────────────────────
export const MAX_DRAW_CALLS = 50;
export const TARGET_FPS = 60;
export const FRAME_BUDGET_MS = 1000 / TARGET_FPS; // 16.67ms
export const MAX_PIXEL_RATIO = 2;

// ── Face Shading Multipliers ────────────────────────────────────
export const FACE_SHADE = {
  TOP: 1.0,
  EAST: 0.88,
  NORTH: 0.80,
  SOUTH: 0.80,
  WEST: 0.65,
  BOTTOM: 0.50,
} as const;

// ── Workers ─────────────────────────────────────────────────────
export const WORKER_COUNT = 4;
export const WORKER_TASK_TIMEOUT_MS = 5000;

// ── Memory Budgets ──────────────────────────────────────────────
export const GPU_MEMORY_BUDGET_MB = 512;
export const JS_HEAP_BUDGET_MB = 256;

// ── Agent System ────────────────────────────────────────────────
export const AGENT_TICK_INTERVAL_MS = 2000;
export const MAX_AGENTS = 10_000;

// ── Height ──────────────────────────────────────────────────────
export const MAX_HEIGHT = 127;
export const WATER_LEVEL = 20;

// ── Provinces ───────────────────────────────────────────────────
export const PROVINCE_COUNT = 41;
export const BARBARIAN_PROVINCE_ID = 0;

// ── Map Edge ────────────────────────────────────────────────────
export const MAP_EDGE_FADE_TILES = 50;
