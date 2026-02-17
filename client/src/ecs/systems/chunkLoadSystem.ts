/**
 * System #5: ChunkLoadSystem
 *
 * Triggers data fetch (IndexedDB → Supabase → procedural fallback)
 * for chunks that need loading. Dispatches binary data to workers
 * for greedy meshing.
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';

export function chunkLoadSystem(_world: World, _delta: number): void {
  // Stub: will check MeshRef.geometryId === -1 (needs load),
  // fetch chunk data, dispatch to worker pool.
  // Implementation in Phase 3 (chunk pipeline).
}
