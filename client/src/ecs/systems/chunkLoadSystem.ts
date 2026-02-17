/**
 * System #5: ChunkLoadSystem
 *
 * Delegates to the existing ChunkLoader.update() with camera position
 * from the ECS camera entity. The ChunkLoader handles spiral loading,
 * worker dispatch, IndexedDB cache, and BatchedMesh management.
 *
 * During the migration period, this system acts as a thin ECS wrapper
 * around ChunkLoader. Full ECS migration of chunk entities will follow
 * when ChunkLoader internals are refactored.
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';
import type { ChunkLoader } from '../../world/chunkLoader';
import { getCameraWorldX, getCameraWorldZ } from './viewportSystem';

/** Set by Engine during init. */
let chunkLoaderRef: ChunkLoader | null = null;

export function setChunkLoaderRef(loader: ChunkLoader): void {
  chunkLoaderRef = loader;
}

export function getChunkLoaderRef(): ChunkLoader | null {
  return chunkLoaderRef;
}

export function chunkLoadSystem(_world: World, _delta: number): void {
  if (!chunkLoaderRef) return;
  chunkLoaderRef.update(getCameraWorldX(), getCameraWorldZ());
}
