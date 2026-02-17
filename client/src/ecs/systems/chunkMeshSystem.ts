/**
 * System #6: ChunkMeshSystem
 *
 * Currently a no-op. Mesh creation is handled internally by ChunkLoader
 * (worker results → BatchedMesh.addGeometry()). The chunkLoadSystem
 * delegates to ChunkLoader.update() which drives the full pipeline.
 *
 * This system exists as a placeholder for future ECS-native chunk
 * mesh management where worker results write directly to ECS components.
 *
 * Frequency: on worker callback (event-driven)
 */

import type { World } from 'bitecs';

export function chunkMeshSystem(_world: World, _delta: number): void {
  // ChunkLoader handles mesh creation internally.
  // Worker results → BatchedMesh.addGeometry() → geometry ID stored in loadedChunks.
}
