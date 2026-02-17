/**
 * IndexedDB mesh cache using idb-keyval.
 *
 * Caches generated ChunkMeshData buffers keyed by (cx, cy, lod, dataHash).
 * On subsequent visits, cached meshes load instantly without re-running
 * greedy meshing. A simple FNV-1a hash of the chunk's raw data arrays
 * detects when chunk content has changed and invalidates stale entries.
 */

import { get, set, del, keys } from 'idb-keyval';
import type { ChunkData, ChunkMeshData, LODLevel } from '../types';
import { createLogger } from '../core/logger';

const log = createLogger('MeshCache');

// ── Cache Key ──────────────────────────────────────────────────────

type CacheKey = `mesh:${number},${number}:${LODLevel}:${string}`;

function makeCacheKey(cx: number, cy: number, lod: LODLevel, hash: string): CacheKey {
  return `mesh:${cx},${cy}:${lod}:${hash}`;
}

// ── Hashing ────────────────────────────────────────────────────────

/**
 * FNV-1a 32-bit hash of a Uint8Array, returned as a hex string.
 * Fast, deterministic, no crypto overhead.
 */
function fnv1a(data: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Hash a ChunkData by combining its 4 data arrays.
 */
export function hashChunkData(chunk: ChunkData): string {
  const h = fnv1a(chunk.heights);
  const b = fnv1a(chunk.biomes);
  const f = fnv1a(chunk.flags);
  const p = fnv1a(chunk.provinces);
  return `${h}-${b}-${f}-${p}`;
}

// ── Serialisation ──────────────────────────────────────────────────

interface CachedMesh {
  positions: ArrayBuffer;
  normals: ArrayBuffer;
  colors: ArrayBuffer;
  indices: ArrayBuffer;
}

function copyBuffer(arr: Float32Array | Uint32Array): ArrayBuffer {
  const copy = new ArrayBuffer(arr.byteLength);
  new Uint8Array(copy).set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
  return copy;
}

function serialise(mesh: ChunkMeshData): CachedMesh {
  return {
    positions: copyBuffer(mesh.positions),
    normals: copyBuffer(mesh.normals),
    colors: copyBuffer(mesh.colors),
    indices: copyBuffer(mesh.indices),
  };
}

function deserialise(cached: CachedMesh): ChunkMeshData {
  return {
    positions: new Float32Array(cached.positions),
    normals: new Float32Array(cached.normals),
    colors: new Float32Array(cached.colors),
    indices: new Uint32Array(cached.indices),
  };
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Try to retrieve a cached mesh for the given chunk + lod + data hash.
 * Returns null on cache miss or any error.
 */
export async function getCachedMesh(
  cx: number,
  cy: number,
  lod: LODLevel,
  dataHash: string,
): Promise<ChunkMeshData | null> {
  try {
    const key = makeCacheKey(cx, cy, lod, dataHash);
    const cached = await get<CachedMesh>(key);
    if (!cached) return null;
    return deserialise(cached);
  } catch {
    return null;
  }
}

/**
 * Store a mesh in the cache.
 */
export async function putCachedMesh(
  cx: number,
  cy: number,
  lod: LODLevel,
  dataHash: string,
  mesh: ChunkMeshData,
): Promise<void> {
  try {
    const key = makeCacheKey(cx, cy, lod, dataHash);
    await set(key, serialise(mesh));
  } catch {
    // Silently ignore write failures (quota exceeded, etc.)
  }
}

/**
 * Remove all cached meshes for a specific chunk (all LODs and hashes).
 */
export async function invalidateChunk(cx: number, cy: number): Promise<void> {
  try {
    const prefix = `mesh:${cx},${cy}:`;
    const allKeys = await keys<string>();
    const toDelete = allKeys.filter(k => k.startsWith(prefix));
    await Promise.all(toDelete.map(k => del(k)));
  } catch {
    // Ignore
  }
}

/**
 * Clear the entire mesh cache.
 */
export async function clearMeshCache(): Promise<void> {
  try {
    const allKeys = await keys<string>();
    const meshKeys = allKeys.filter(k => typeof k === 'string' && k.startsWith('mesh:'));
    await Promise.all(meshKeys.map(k => del(k)));
    log.info(`Cleared ${meshKeys.length} cached meshes`);
  } catch {
    // Ignore
  }
}
