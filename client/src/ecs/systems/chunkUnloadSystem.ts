/**
 * System #7: ChunkUnloadSystem
 *
 * Chunk unloading is driven by ChunkLoader.unloadDistantChunks() which fires
 * the onChunkUnloaded callback. The callback (wired in chunkLoadSystem) calls
 * removeChunkEntity to destroy the ECS entity and clean up the chunk-to-EID map.
 *
 * This system remains as an explicit pipeline slot to preserve the system
 * ordering contract (system #7 runs after #6 chunkMesh).
 *
 * Frequency: every frame (no-op; unloading is callback-driven)
 */

import type { World } from 'bitecs';

export function chunkUnloadSystem(_world: World, _delta: number): void {
  // Chunk unloading is handled by ChunkLoader.unloadDistantChunks() →
  // onChunkUnloaded callback → removeChunkEntity() in chunkEntityMap.
}
