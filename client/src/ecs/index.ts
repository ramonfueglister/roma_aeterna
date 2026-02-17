/**
 * ECS public API.
 *
 * Re-exports the pieces needed by the Engine and bootstrap code.
 * The ECS pipeline is the sole update path — no GameSystem loop.
 */

export { world, MAX_ENTITIES } from './world';
export { runPipeline } from './pipeline';

// Components
export {
  Position, Velocity, Rotation,
  ChunkCoord, LODLevel, MeshRef, InstanceRef,
  CityInfo, CityDisplay,
  AgentRole, AgentMovement,
  TreeVariant, ProvinceTag, ResourceSite,
  ServerSync, Visible,
  IsChunk, IsCity, IsAgent, IsTree,
  IsProvince, IsResource, IsCamera, IsWater, IsLabel,
  PendingRemoval,
} from './components';

// Archetypes
export {
  createChunkEntity, createCityEntity, createAgentEntity,
  createTreeEntity, createProvinceEntity, createResourceEntity,
  createCameraEntity, createWaterEntity,
  addChunkArchetype, addCityArchetype, addAgentArchetype,
  addTreeArchetype, addProvinceArchetype, addResourceArchetype,
  addCameraArchetype, addWaterArchetype,
} from './archetypes';

// Server sync
export {
  getOrCreateEntity, getEidForUuid, getUuidForEid,
  removeServerEntity, removeServerEntityByEid,
  hasServerEntity, serverEntityCount, forEachServerEntity,
} from './serverEntityMap';

// Chunk entity map
export {
  getChunkEid, setChunkEid, hasChunkEntity,
  removeChunkEntity, removeChunkEntityByEid,
  clearChunkEntityMap, chunkEntityCount,
} from './chunkEntityMap';

// Enums
export {
  BiomeType, Culture, AgentType, AgentRoleType, AgentState,
  CityTier, CityLODMode, TreeSpecies,
  ResourceType, HarvestState, InstancePool,
} from './enums';

// MeshRegistry
export {
  registerBatchedMesh, getBatchedMesh, unregisterBatchedMesh,
  registerInstancePool, getInstancePool, unregisterInstancePool,
  allocateInstance, releaseInstance, getActiveInstanceCount,
  clearMeshRegistry,
} from './meshRegistry';

// System configuration setters (called during bootstrap in main.ts)
export { setCameraRef } from './systems/cameraInputSystem';
export { setControllerRef, getControllerRef } from './systems/cameraMovementSystem';
export { setChunkLoaderRef, getChunkLoaderRef } from './systems/chunkLoadSystem';
export { setCityRendererRef } from './systems/cityLODSystem';
export { setTreeRendererRef } from './systems/treeRenderSystem';
export { setAgentRendererRef } from './systems/agentRenderSystem';
export { setLabelRendererRef } from './systems/labelSystem';
export { setProvinceRendererRef } from './systems/provinceOverlaySystem';
export { setWaterRendererRef } from './systems/waterRenderSystem';
export { setRoadRendererRef } from './systems/roadRenderSystem';
export { setParticleSystemRef } from './systems/particleRenderSystem';
export { setPostProcessingRef } from './systems/postProcessingRenderSystem';
export { setHudRef, setToast } from './systems/hudSystem';
export type { HudElements } from './systems/hudSystem';
export { getViewport, getCameraHeight, getCameraWorldX, getCameraWorldZ, getViewRange, getCameraChunkX, getCameraChunkY } from './systems/viewportSystem';
