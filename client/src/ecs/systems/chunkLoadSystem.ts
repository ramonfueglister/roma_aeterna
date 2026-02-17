/**
 * System #5: ChunkLoadSystem
 *
 * Delegates chunk loading to ChunkLoader.update() and mirrors chunk lifecycle
 * into ECS entities via callback hooks. When ChunkLoader loads a chunk mesh,
 * this system creates a chunk entity with ChunkCoord, LODLevel, and MeshRef
 * components. When a chunk is unloaded, the entity is removed.
 *
 * The ChunkLoader remains the rendering backend — it owns the BatchedMesh
 * instances, worker pool, IndexedDB cache, and spiral loading. ECS entities
 * are a reflection layer that lets other systems query chunk state.
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';
import type { ChunkLoader } from '../../world/chunkLoader';
import { getCameraWorldX, getCameraWorldZ, getViewRange } from './viewportSystem';
import { createChunkEntity } from '../archetypes';
import { ChunkCoord, LODLevel, MeshRef } from '../components';
import { getChunkEid, setChunkEid, removeChunkEntity } from '../chunkEntityMap';

/** Set by Engine during init. */
let chunkLoaderRef: ChunkLoader | null = null;
let hooked = false;

export function setChunkLoaderRef(loader: ChunkLoader): void {
  chunkLoaderRef = loader;
}

export function getChunkLoaderRef(): ChunkLoader | null {
  return chunkLoaderRef;
}

/**
 * Wire ChunkLoader callbacks to create/update/remove ECS entities.
 * Called once on first system tick when both world and loader are available.
 */
function hookCallbacks(world: World, loader: ChunkLoader): void {
  loader.onChunkMeshReady = (cx, cy, lod, geometryId, instanceId) => {
    let eid = getChunkEid(cx, cy);
    if (eid === undefined) {
      eid = createChunkEntity(world);
      ChunkCoord.cx[eid] = cx;
      ChunkCoord.cy[eid] = cy;
      setChunkEid(cx, cy, eid);
    }

    // Write mesh reference
    MeshRef.batchId[eid] = lod;
    MeshRef.geometryId[eid] = geometryId;
    MeshRef.instanceId[eid] = instanceId;

    // Sync LOD state
    LODLevel.current[eid] = lod;
    LODLevel.target[eid] = lod;
    LODLevel.blendAlpha[eid] = 1.0;
  };

  loader.onChunkUnloaded = (cx, cy) => {
    removeChunkEntity(world, cx, cy);
  };
}

export function chunkLoadSystem(world: World, _delta: number): void {
  if (!chunkLoaderRef) return;

  // One-time hook setup
  if (!hooked) {
    hookCallbacks(world, chunkLoaderRef);
    hooked = true;
  }

  chunkLoaderRef.update(getCameraWorldX(), getCameraWorldZ(), getViewRange());
}
