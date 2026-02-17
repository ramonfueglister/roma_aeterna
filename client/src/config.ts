/**
 * Global constants for the Imperium voxel world.
 * All magic numbers live here, nowhere else.
 */

// ── Map Dimensions ──────────────────────────────────────────────
export const APP_NAME = 'Imperium';
export const MAP_SIZE = 2048;
export const CHUNK_SIZE = 32;
export const GRID_SIZE = MAP_SIZE / CHUNK_SIZE; // 64 chunks per axis
export const CHUNKS_PER_AXIS = GRID_SIZE;
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
export const NEAR_CLIP = 0.5;
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
export const CHUNK_LOAD_BUDGET = 150;

// ── Agent System ────────────────────────────────────────────────
export const AGENT_TICK_INTERVAL_MS = 2000;
export const MAX_AGENTS = 10_000;

// ── Height ──────────────────────────────────────────────────────
export const MAX_HEIGHT = 127;
export const WATER_LEVEL = 32;

// ── Provinces ───────────────────────────────────────────────────
export const PROVINCE_COUNT = 41;
export const BARBARIAN_PROVINCE_ID = 0;

// ── Map Edge ────────────────────────────────────────────────────
export const MAP_EDGE_FADE_TILES = 50;

// ── Client Runtime Config Loading ──────────────────────────────
export interface ClientRuntimeConfig {
  appName: string;
  mapSize: number;
  chunkSize: number;
  gridSize: number;
  totalChunks: number;
  targetFps: number;
  frameBudgetMs: number;
  lodLevels: number;
  minZoom: number;
  maxZoom: number;
  nearClip: number;
  farClip: number;
  maxAgents: number;
}

export interface ConfigValidationResult {
  valid: boolean;
  config: ClientRuntimeConfig;
  errors: string[];
}

const DEFAULT_RUNTIME_CONFIG: ClientRuntimeConfig = {
  appName: APP_NAME,
  mapSize: MAP_SIZE,
  chunkSize: CHUNK_SIZE,
  gridSize: GRID_SIZE,
  totalChunks: TOTAL_CHUNKS,
  targetFps: TARGET_FPS,
  frameBudgetMs: FRAME_BUDGET_MS,
  lodLevels: LOD_LEVELS,
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM,
  nearClip: NEAR_CLIP,
  farClip: FAR_CLIP,
  maxAgents: MAX_AGENTS,
};

const INTEGER_FIELDS = [
  'mapSize',
  'chunkSize',
  'gridSize',
  'totalChunks',
  'targetFps',
  'lodLevels',
  'maxAgents',
] as const;

const POSITIVE_NUMBER_FIELDS = [
  'minZoom',
  'maxZoom',
  'nearClip',
  'farClip',
] as const;

function isPositiveInt(value: unknown, field: string, errors: string[]): boolean {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
    errors.push(`${field} must be greater than 0`);
    return false;
  }
  if (!Number.isFinite(value)) {
    errors.push(`${field} must be finite`);
    return false;
  }
  if (!Number.isInteger(value)) {
    errors.push(`${field} must be an integer`);
    return false;
  }
  return true;
}

function isPositiveNumber(value: unknown, field: string, errors: string[]): boolean {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
    errors.push(`${field} must be greater than 0`);
    return false;
  }
  if (!Number.isFinite(value)) {
    errors.push(`${field} must be finite`);
    return false;
  }
  return true;
}

/**
 * Merge defaults with overrides and validate resulting runtime config.
 */
export function validateAndLoadConfig(
  overrides: Partial<ClientRuntimeConfig> = {},
): ConfigValidationResult {
  const config: ClientRuntimeConfig = { ...DEFAULT_RUNTIME_CONFIG, ...overrides };
  config.frameBudgetMs = 1000 / config.targetFps;
  const errors: string[] = [];

  for (const field of INTEGER_FIELDS) {
    isPositiveInt(config[field], field, errors);
  }

  for (const field of POSITIVE_NUMBER_FIELDS) {
    isPositiveNumber(config[field], field, errors);
  }

  isPositiveNumber(config.frameBudgetMs, 'frameBudgetMs', errors);

  if (typeof config.appName !== 'string' || config.appName.trim().length === 0) {
    errors.push('appName must be a non-empty string');
  }

  if (config.mapSize % config.chunkSize !== 0) {
    errors.push(`mapSize (${config.mapSize}) must be divisible by chunkSize (${config.chunkSize})`);
  }

  const expectedGrid = config.mapSize / config.chunkSize;
  if (config.gridSize !== expectedGrid) {
    errors.push(`gridSize must equal mapSize / chunkSize (${expectedGrid}), got ${config.gridSize}`);
  }

  const expectedTotal = config.gridSize * config.gridSize;
  if (config.totalChunks !== expectedTotal) {
    errors.push(`totalChunks must equal gridSize^2 (${expectedTotal}), got ${config.totalChunks}`);
  }

  if (config.minZoom >= config.maxZoom) {
    errors.push(`minZoom (${config.minZoom}) must be smaller than maxZoom (${config.maxZoom})`);
  }

  if (config.nearClip >= config.farClip) {
    errors.push(`nearClip (${config.nearClip}) must be smaller than farClip (${config.farClip})`);
  }

  if (config.lodLevels > LOD_DISTANCES.length) {
    errors.push(`lodLevels (${config.lodLevels}) must not exceed LOD distance count (${LOD_DISTANCES.length})`);
  }

  const expectedBudget = 1000 / config.targetFps;
  if (Math.abs(config.frameBudgetMs - expectedBudget) > 0.01) {
    errors.push(`frameBudgetMs should be approximately 1000/targetFps (${expectedBudget}), got ${config.frameBudgetMs}`);
  }

  return {
    valid: errors.length === 0,
    config,
    errors,
  };
}
