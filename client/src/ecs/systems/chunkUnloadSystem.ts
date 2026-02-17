/**
 * System #7: ChunkUnloadSystem
 *
 * Removes chunks outside the viewport, disposes geometry,
 * recycles entities.
 *
 * Frequency: every 500ms
 */

import type { World } from 'bitecs';

let _accumulator = 0;

export function chunkUnloadSystem(_world: World, delta: number): void {
  _accumulator += delta;
  if (_accumulator < 0.5) return;
  _accumulator -= 0.5;

  // Stub: will check chunks outside viewport range,
  // dispose BatchedMesh geometry, removeEntity.
  // Implementation in Phase 3 (chunk pipeline).
}
