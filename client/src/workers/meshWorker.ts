/**
 * Web Worker for off-thread terrain mesh generation.
 *
 * Receives chunk voxel data + LOD level, runs the greedy mesher,
 * and posts back the resulting mesh geometry using Transferable
 * ArrayBuffers for zero-copy transfer to the main thread.
 *
 * Bundled by Vite as an ES module worker:
 *   new Worker(new URL('./meshWorker.ts', import.meta.url), { type: 'module' })
 *
 * Dependencies:
 *   - greedyMesher.ts (pure TypeScript, no THREE.js)
 *   - biomeColors.ts  (pure TypeScript, no THREE.js)
 *   - config.ts       (constants only)
 *   - types.ts        (type definitions)
 */

import { greedyMeshChunk } from '../world/greedyMesher';
import type { WorkerRequest, WorkerResponse, ChunkData, ChunkMeshData } from '../types';

/**
 * Typed reference to the worker global scope for postMessage.
 * We cast through `unknown` because the tsconfig includes DOM lib
 * (not WebWorker lib), so DedicatedWorkerGlobalScope is unavailable.
 */
const workerSelf = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void;
};

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

  // Collect unique ArrayBuffers for transfer. De-duplicate in case any
  // typed arrays share the same underlying buffer (defensive -- should
  // not happen with greedyMeshChunk output, but prevents DataCloneError).
  // Also skip zero-length buffers which have nothing to transfer.
  const seen = new Set<ArrayBuffer>();
  const transferables: ArrayBuffer[] = [];

  const buffers = [
    meshData.positions.buffer as ArrayBuffer,
    meshData.normals.buffer as ArrayBuffer,
    meshData.colors.buffer as ArrayBuffer,
    meshData.indices.buffer as ArrayBuffer,
  ];

  for (const buf of buffers) {
    if (buf.byteLength > 0 && !seen.has(buf)) {
      seen.add(buf);
      transferables.push(buf);
    }
  }

  workerSelf.postMessage(response, transferables);
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
  workerSelf.postMessage(response);
}

/**
 * Reconstruct a ChunkData object from the structured-clone payload.
 *
 * When chunk data arrives via postMessage, the Uint8Arrays are recreated
 * by the structured clone algorithm. This function ensures they are
 * proper Uint8Array instances (not plain objects) in case the clone
 * produced ArrayBuffer views that need wrapping.
 */
function reconstructChunkData(raw: ChunkData): ChunkData {
  return {
    cx: raw.cx,
    cy: raw.cy,
    heights: new Uint8Array(raw.heights),
    biomes: new Uint8Array(raw.biomes),
    flags: new Uint8Array(raw.flags),
    provinces: new Uint8Array(raw.provinces),
  };
}

// ── Message handler ──────────────────────────────────────────────

workerSelf.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type !== 'GENERATE_MESH') {
    postError(request.id, `Unknown request type: ${request.type}`);
    return;
  }

  try {
    const chunk = reconstructChunkData(request.chunkData);
    const meshData = greedyMeshChunk(chunk, request.lod);
    postMeshReady(request.id, meshData);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    postError(
      request.id,
      `Mesh generation failed for chunk (${request.chunkData.cx},${request.chunkData.cy}) ` +
      `LOD${request.lod}: ${message}`,
    );
  }
});
