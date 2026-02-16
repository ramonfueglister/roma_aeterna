/**
 * Web Worker for off-thread terrain mesh generation.
 *
 * Receives chunk voxel data + LOD level, runs greedy meshing,
 * and posts back the resulting mesh geometry using Transferable
 * ArrayBuffers for zero-copy transfer to the main thread.
 *
 * Bundled by Vite as an ES module worker:
 *   new Worker(new URL('./meshWorker.ts', import.meta.url), { type: 'module' })
 */

import { greedyMeshChunk } from '../world/greedyMesher';
import type { WorkerRequest, WorkerResponse, ChunkMeshData } from '../types';

/**
 * Build a MESH_READY response and post it with Transferable buffers.
 * After this call the typed-array backing buffers are neutered (transferred),
 * so they must not be referenced again on the worker side.
 */
function postMeshReady(id: number, meshData: ChunkMeshData): void {
  const response: WorkerResponse = {
    id,
    type: 'MESH_READY',
    meshData,
  };

  const transferables = [
    meshData.positions.buffer as ArrayBuffer,
    meshData.normals.buffer as ArrayBuffer,
    meshData.colors.buffer as ArrayBuffer,
    meshData.indices.buffer as ArrayBuffer,
  ];

  // De-duplicate buffers in case any typed arrays share the same
  // underlying ArrayBuffer (defensive -- should not happen with
  // greedyMeshChunk output, but prevents a DataCloneError).
  const seen = new Set<ArrayBuffer>();
  const uniqueTransferables: ArrayBuffer[] = [];
  for (const buf of transferables) {
    if (!seen.has(buf)) {
      seen.add(buf);
      uniqueTransferables.push(buf);
    }
  }

  (self as unknown as Worker).postMessage(response, uniqueTransferables);
}

/**
 * Build and post an ERROR response.
 */
function postError(id: number, error: string): void {
  const response: WorkerResponse = {
    id,
    type: 'ERROR',
    error,
  };
  (self as unknown as Worker).postMessage(response);
}

// ── Message handler ──────────────────────────────────────────────

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type !== 'GENERATE_MESH') {
    postError(request.id, `Unknown request type: ${request.type}`);
    return;
  }

  try {
    const meshData = greedyMeshChunk(request.chunkData, request.lod);
    postMeshReady(request.id, meshData);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);
    postError(request.id, `Mesh generation failed for chunk (${request.chunkData.cx},${request.chunkData.cy}) LOD${request.lod}: ${message}`);
  }
});
