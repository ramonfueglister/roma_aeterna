/**
 * ECS public API.
 *
 * Re-exports the pieces needed by the Engine and existing GameSystems
 * during the migration period.
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

// System configuration setters (called by Engine during init)
export { setCameraRef } from './systems/cameraInputSystem';
export { setChunkLoaderRef, getChunkLoaderRef } from './systems/chunkLoadSystem';
export { setCityRendererRef } from './systems/cityLODSystem';
export { setTreeRendererRef } from './systems/treeRenderSystem';
export { setAgentRendererRef } from './systems/agentRenderSystem';
export { setLabelRendererRef } from './systems/labelSystem';
export { setProvinceRendererRef } from './systems/provinceOverlaySystem';
export { getViewport, getCameraHeight, getCameraWorldX, getCameraWorldZ } from './systems/viewportSystem';
