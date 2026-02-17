/**
 * System #7: ChunkUnloadSystem
 *
 * Currently a no-op. Chunk unloading is handled internally by
 * ChunkLoader.unloadDistantChunks() called from ChunkLoader.update().
 *
 * This system exists as a placeholder for future ECS-native chunk
 * lifecycle management.
 *
 * Frequency: every 500ms
 */

import type { World } from 'bitecs';

let _accumulator = 0;

export function chunkUnloadSystem(_world: World, delta: number): void {
  _accumulator += delta;
  if (_accumulator < 0.5) return;
  _accumulator -= 0.5;

  // ChunkLoader.unloadDistantChunks() handles unloading internally.
}
