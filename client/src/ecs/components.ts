/**
 * ECS component definitions (bitECS v0.4.0 API).
 *
 * Components are plain objects with pre-allocated TypedArray stores,
 * indexed by entity ID (eid). No Three.js objects — data only.
 *
 * Convention: Float32Array for positions/speeds/timers,
 *             Uint8Array for enums/booleans/small ints,
 *             Uint16Array for medium indices,
 *             Int32Array/Uint32Array for large IDs or signed indices.
 */

import { MAX_ENTITIES } from './world';

const N = MAX_ENTITIES;

// ── Spatial ──────────────────────────────────────────────────────

/** World-space position (tile coords for game objects, world units for camera). */
export const Position = {
  x: new Float32Array(N),
  y: new Float32Array(N),
  z: new Float32Array(N),
};

/** Movement velocity (tiles/s for agents, units/s for camera). */
export const Velocity = {
  x: new Float32Array(N),
  y: new Float32Array(N),
  z: new Float32Array(N),
};

/** Rotation in radians. */
export const Rotation = {
  yaw: new Float32Array(N),
  pitch: new Float32Array(N),
};

// ── Chunk ────────────────────────────────────────────────────────

/** Grid coordinates (0-63) identifying a chunk in the 64x64 grid. */
export const ChunkCoord = {
  cx: new Uint8Array(N),
  cy: new Uint8Array(N),
};

/** Current and target LOD level (0-3) with blend alpha for transitions. */
export const LODLevel = {
  current: new Uint8Array(N),
  target: new Uint8Array(N),
  blendAlpha: new Float32Array(N),
};

// ── Mesh References ──────────────────────────────────────────────

/**
 * Index into a BatchedMesh (terrain chunks, city detail meshes).
 * batchId selects which BatchedMesh (0=LOD0, 1=LOD1, 2=LOD2, 3=LOD3).
 * geometryId is the index returned by BatchedMesh.addGeometry(), -1 = none.
 */
export const MeshRef = {
  batchId: new Uint16Array(N),
  geometryId: new Int32Array(N),
  instanceId: new Int32Array(N),
};

/**
 * Index into an InstancedMesh (trees, agents, icons, ships).
 * poolId selects which InstancedMesh pool (see InstancePool enum).
 * instanceId is the index in the InstancedMesh, -1 = none.
 */
export const InstanceRef = {
  poolId: new Uint8Array(N),
  instanceId: new Int32Array(N),
};

// ── City ─────────────────────────────────────────────────────────

/** City metadata (maps from cities table). */
export const CityInfo = {
  tier: new Uint8Array(N),
  population: new Uint32Array(N),
  provinceNumber: new Uint8Array(N),
  culture: new Uint8Array(N),
  isHarbor: new Uint8Array(N),
  isCapital: new Uint8Array(N),
};

/** LOD-specific city display state. */
export const CityDisplay = {
  lodMode: new Uint8Array(N),
};

// ── Agent ────────────────────────────────────────────────────────

/** Agent type and role (maps from agents table). */
export const AgentRole = {
  agentType: new Uint8Array(N),
  role: new Uint8Array(N),
  state: new Uint8Array(N),
};

/** Agent movement interpolation between server ticks.
 *  prevX/nextX = east-west (world X), prevZ/nextZ = north-south (world Z).
 *  Y (terrain height) is sampled separately, not interpolated here. */
export const AgentMovement = {
  prevX: new Float32Array(N),
  prevZ: new Float32Array(N),
  nextX: new Float32Array(N),
  nextZ: new Float32Array(N),
  interpT: new Float32Array(N),
  speed: new Float32Array(N),
  heading: new Float32Array(N),
};

// ── Environment ──────────────────────────────────────────────────

/** Tree species variant and scale. */
export const TreeVariant = {
  species: new Uint8Array(N),
  scale: new Float32Array(N),
};

/** Province entity metadata (not per-tile). */
export const ProvinceTag = {
  number: new Uint8Array(N),
  culture: new Uint8Array(N),
};

/** Resource site data driving the harvest state machine. */
export const ResourceSite = {
  resourceType: new Uint8Array(N),
  harvestState: new Uint8Array(N),
  stateTimer: new Float32Array(N),
  fieldSizeX: new Uint8Array(N),
  fieldSizeY: new Uint8Array(N),
};

// ── Sync & Lifecycle ─────────────────────────────────────────────

/** Server synchronization tracking. */
export const ServerSync = {
  lastTick: new Uint32Array(N),
  missedPolls: new Uint8Array(N),
  dirty: new Uint8Array(N),
};

/** Visibility flag (frustum culled, zoom filtered, or explicitly hidden). */
export const Visible = {
  value: new Uint8Array(N),
};

// ── Tags (marker components, no data) ────────────────────────────

export const IsChunk = {};
export const IsCity = {};
export const IsAgent = {};
export const IsTree = {};
export const IsProvince = {};
export const IsResource = {};
export const IsCamera = {};
export const IsWater = {};
export const IsLabel = {};
export const PendingRemoval = {};
