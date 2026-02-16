/**
 * Core type definitions for the Imperium voxel world.
 */

// ── Biomes ──────────────────────────────────────────────────────

export enum BiomeType {
  WATER_DEEP = 0,
  WATER_SHALLOW = 1,
  SAND = 2,
  GRASS = 3,
  FOREST = 4,
  DENSE_FOREST = 5,
  SCRUB = 6,
  FARMLAND = 7,
  MARSH = 8,
  DESERT = 9,
  MOUNTAIN = 10,
  SNOW = 11,
  ROAD = 12,
  RIVER = 13,
  CITY = 14,
  COAST = 15,
  STEPPE = 16,
  VOLCANIC = 17,
  OLIVE_GROVE = 18,
  VINEYARD = 19,
}

// ── LOD ─────────────────────────────────────────────────────────

export type LODLevel = 0 | 1 | 2 | 3;

// ── Chunks ──────────────────────────────────────────────────────

export interface ChunkCoord {
  cx: number;
  cy: number;
}

export interface ChunkData {
  cx: number;
  cy: number;
  heights: Uint8Array;    // 1024 bytes (32x32)
  biomes: Uint8Array;     // 1024 bytes
  flags: Uint8Array;      // 1024 bytes
  provinces: Uint8Array;  // 1024 bytes
}

export interface ChunkMeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

// ── Tile ────────────────────────────────────────────────────────

export interface TileData {
  height: number;
  biome: BiomeType;
  flags: number;
  provinceId: number;
}

// ── Tile Flags ──────────────────────────────────────────────────

export const TileFlags = {
  HAS_ROAD: 1 << 0,
  HAS_RIVER: 1 << 1,
  HAS_RESOURCE: 1 << 2,
  HAS_BUILDING: 1 << 3,
  IS_COAST: 1 << 4,
  IS_PORT: 1 << 5,
  HAS_WALL: 1 << 6,
  RESERVED: 1 << 7,
} as const;

// ── Camera ──────────────────────────────────────────────────────

export interface CameraState {
  x: number;
  y: number;
  z: number;
  zoom: number;
  targetX: number;
  targetZ: number;
}

export interface ViewportRect {
  minCx: number;
  minCy: number;
  maxCx: number;
  maxCy: number;
}

// ── Cities ──────────────────────────────────────────────────────

export type CityTier = 1 | 2 | 3 | 4;

export type CultureType =
  | 'roman'
  | 'greek'
  | 'egyptian'
  | 'eastern'
  | 'levantine'
  | 'north_african'
  | 'celtic'
  | 'germanic'
  | 'dacian';

export interface CityData {
  id: string;
  name: string;
  latinName: string;
  tileX: number;
  tileY: number;
  tier: CityTier;
  culture: CultureType;
  population: number;
  provinceId: number;
  isPort: boolean;
  isCapital: boolean;
}

// ── Agents ──────────────────────────────────────────────────────

export enum AgentType {
  TRADER = 'trader',
  SHIP = 'ship',
  LEGION = 'legion',
  CITIZEN = 'citizen',
  CARAVAN = 'caravan',
  FISHING_BOAT = 'fishing_boat',
  HORSE_RIDER = 'horse_rider',
  OX_CART = 'ox_cart',
}

export enum AgentState {
  IDLE = 'idle',
  PLANNING = 'planning',
  MOVING = 'moving',
  TRADING = 'trading',
  RESTING = 'resting',
  PATROLLING = 'patrolling',
}

export interface AgentData {
  id: string;
  type: AgentType;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  state: AgentState;
  speed: number;
  homeCityId: string;
  cargo: string | null;
}

// ── Resources ───────────────────────────────────────────────────

export type ResourceType =
  | 'grain' | 'olive' | 'grape' | 'timber' | 'iron'
  | 'gold' | 'silver' | 'copper' | 'tin' | 'marble'
  | 'salt' | 'fish' | 'wool' | 'linen' | 'silk'
  | 'spice' | 'incense' | 'pottery' | 'glass' | 'garum'
  | 'wine' | 'oil' | 'horses' | 'slaves';

// ── Province ────────────────────────────────────────────────────

export interface ProvinceData {
  id: number;
  name: string;
  latinName: string;
  culture: CultureType;
  capitalCityId: string;
  color: number; // RGB hex
}

// ── Quality ─────────────────────────────────────────────────────

export type QualityPreset = 'high' | 'medium' | 'low' | 'toaster';

// ── Events ──────────────────────────────────────────────────────

export type GameEventType =
  | 'chunk_loaded'
  | 'chunk_unloaded'
  | 'city_selected'
  | 'agent_selected'
  | 'province_selected'
  | 'camera_moved'
  | 'quality_changed'
  | 'viewport_changed';

export interface GameEvent<T = unknown> {
  type: GameEventType;
  payload: T;
  timestamp: number;
}

// ── Result Type ─────────────────────────────────────────────────

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// ── Worker Messages ─────────────────────────────────────────────

export interface WorkerRequest {
  id: number;
  type: 'GENERATE_MESH';
  chunkData: ChunkData;
  lod: LODLevel;
}

export interface WorkerResponse {
  id: number;
  type: 'MESH_READY' | 'ERROR';
  meshData?: ChunkMeshData;
  error?: string;
}
