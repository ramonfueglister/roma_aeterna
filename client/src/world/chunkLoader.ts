/**
 * ChunkLoader: manages loading, caching, and lifecycle of terrain chunks.
 *
 * Decides which chunks to load/unload based on camera position using
 * spiral outward ordering. Mesh generation is offloaded to a WorkerPool
 * (Web Workers) for non-blocking operation. A synchronous fallback via
 * buildChunkMesh is used only when the WorkerPool is unavailable.
 *
 * Chunk world-space positioning:
 *   Chunk (0,0) starts at world x = -MAP_SIZE/2, z = -MAP_SIZE/2.
 *   Each chunk spans CHUNK_SIZE world units along X and Z.
 */

import * as THREE from 'three';
import { CHUNK_SIZE, GRID_SIZE, MAP_SIZE } from '../config';
import type { ChunkData, ChunkMeshData, LODLevel } from '../types';
import { makeChunkKey, type ChunkKey } from '../types';
import { worldToChunk, spiralOrder, isChunkInBounds } from '../core/math';
import { gameEvents } from '../core/eventBus';
import { createLogger } from '../core/logger';
import { generateProceduralChunk } from './proceduralChunk';
import { buildChunkMesh } from './chunkMeshBuilder';
import { WorkerPool } from '../workers/workerPool';

const log = createLogger('ChunkLoader');

// ── Types ──────────────────────────────────────────────────────────

interface LoadedChunkEntry {
  mesh: THREE.Mesh;
  lod: LODLevel;
}

/**
 * Provider function that returns ChunkData for a given chunk coordinate.
 * Returns null if the chunk is unavailable (e.g. out of bounds or not yet fetched).
 */
export type ChunkDataProvider = (cx: number, cy: number) => ChunkData | null;

// ── Constants ──────────────────────────────────────────────────────

/** Maximum chunks to initiate loading per update frame. */
const LOAD_BUDGET_PER_FRAME = 2;

/** Shared material for all chunk meshes (vertex-colored, flat-shaded). */
const CHUNK_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.95,
  metalness: 0.02,
  side: THREE.FrontSide,
});

// ── Pre-computed spiral offsets (computed once, reused every frame) ─

/** Spiral offsets covering the maximum unload radius. */
let cachedSpiralRadius = 0;
let cachedSpiral: Array<[number, number]> = [];

function getSpiralOffsets(radius: number): Array<[number, number]> {
  if (radius !== cachedSpiralRadius) {
    cachedSpiral = spiralOrder(radius);
    cachedSpiralRadius = radius;
  }
  return cachedSpiral;
}

// ── ChunkLoader ────────────────────────────────────────────────────

export class ChunkLoader {
  /** THREE.Group added to the scene; all chunk meshes are children. */
  readonly terrainGroup: THREE.Group;

  /** Currently loaded and visible chunks. */
  private loadedChunks: Map<ChunkKey, LoadedChunkEntry> = new Map();

  /** Chunks currently being built (prevents duplicate requests). */
  private pendingLoads: Set<ChunkKey> = new Set();

  /** Radius in chunks within which chunks are loaded. */
  loadRadius: number;

  /** Radius in chunks beyond which chunks are unloaded. */
  unloadRadius: number;

  /**
   * Function that provides ChunkData for a coordinate pair.
   * Defaults to the procedural generator.
   * Replace this with a Supabase-backed provider when the backend is ready.
   */
  chunkDataProvider: ChunkDataProvider;

  /** Worker pool for off-thread mesh generation. */
  private workerPool: WorkerPool | null;

  /** Last camera chunk position; skip work when the camera hasn't moved to a new chunk. */
  private lastCameraCx = -9999;
  private lastCameraCy = -9999;

  constructor(
    scene: THREE.Scene,
    options?: {
      loadRadius?: number;
      unloadRadius?: number;
      workerPool?: WorkerPool;
    },
  ) {
    this.terrainGroup = new THREE.Group();
    this.terrainGroup.name = 'terrain';
    scene.add(this.terrainGroup);

    this.loadRadius = options?.loadRadius ?? 8;
    this.unloadRadius = options?.unloadRadius ?? 12;

    // Accept an external WorkerPool or create a default one.
    // The pool can be shared across multiple subsystems if needed.
    this.workerPool = options?.workerPool ?? null;

    // Default to procedural generation
    this.chunkDataProvider = generateProceduralChunk;

    const workerInfo = this.workerPool
      ? `workerPool=${this.workerPool.workerCount} workers`
      : 'sync fallback (no WorkerPool)';

    log.info(
      `Initialised: loadRadius=${this.loadRadius}, unloadRadius=${this.unloadRadius}, ` +
        `gridSize=${GRID_SIZE}x${GRID_SIZE}, ${workerInfo}`,
    );
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Called every frame from the render loop.
   * Converts camera world position to chunk coordinates, then loads
   * nearby chunks and unloads distant ones within a per-frame budget.
   *
   * @param cameraWorldX - Camera X in world space (Three.js X axis).
   * @param cameraWorldZ - Camera Z in world space (Three.js Z axis).
   */
  update(cameraWorldX: number, cameraWorldZ: number): void {
    // Convert world position to tile coordinate
    // World origin (-MAP_SIZE/2, -MAP_SIZE/2) maps to tile (0, 0)
    const tileX = cameraWorldX + MAP_SIZE / 2;
    const tileZ = cameraWorldZ + MAP_SIZE / 2;
    const { cx: cameraCx, cy: cameraCy } = worldToChunk(tileX, tileZ);

    // Early exit if camera chunk has not changed
    if (cameraCx === this.lastCameraCx && cameraCy === this.lastCameraCy) {
      return;
    }
    this.lastCameraCx = cameraCx;
    this.lastCameraCy = cameraCy;

    this.loadNearbyChunks(cameraCx, cameraCy);
    this.unloadDistantChunks(cameraCx, cameraCy);
    this.updateLODs(cameraCx, cameraCy);
  }

  /** Number of chunks currently loaded and visible. */
  get loadedCount(): number {
    return this.loadedChunks.size;
  }

  /** Number of chunks currently being built. */
  get pendingCount(): number {
    return this.pendingLoads.size;
  }

  /** Replace the worker pool (e.g. after quality preset change). */
  setWorkerPool(pool: WorkerPool | null): void {
    this.workerPool = pool;
    log.info(
      pool
        ? `WorkerPool set: ${pool.workerCount} workers`
        : 'WorkerPool removed, using sync fallback',
    );
  }

  /** Clean up all resources. */
  dispose(): void {
    for (const [key, entry] of this.loadedChunks) {
      this.disposeEntry(entry);
      this.loadedChunks.delete(key);
    }
    this.pendingLoads.clear();
    this.terrainGroup.removeFromParent();
    log.info('Disposed');
  }

  // ── Loading ────────────────────────────────────────────────────

  /**
   * Load chunks near the camera in spiral order, respecting per-frame budget.
   */
  private loadNearbyChunks(cameraCx: number, cameraCy: number): void {
    const spiral = getSpiralOffsets(this.loadRadius);
    let loaded = 0;

    for (let i = 0; i < spiral.length; i++) {
      if (loaded >= LOAD_BUDGET_PER_FRAME) break;

      const offset = spiral[i]!;
      const cx = cameraCx + offset[0];
      const cy = cameraCy + offset[1];

      if (!isChunkInBounds(cx, cy)) continue;

      const key = makeChunkKey(cx, cy);
      if (this.loadedChunks.has(key) || this.pendingLoads.has(key)) continue;

      const dist = Math.max(Math.abs(offset[0]), Math.abs(offset[1]));
      const lod = this.getLOD(dist);

      this.loadChunk(cx, cy, lod);
      loaded++;
    }
  }

  /**
   * Load a single chunk: get data, build mesh off-thread, add to scene.
   *
   * Uses the WorkerPool for async mesh generation when available.
   * Falls back to synchronous buildChunkMesh on the main thread if
   * no worker pool is set (e.g. during tests or if workers fail to load).
   */
  private loadChunk(cx: number, cy: number, lod: LODLevel): void {
    const key = makeChunkKey(cx, cy);
    this.pendingLoads.add(key);

    const chunkData = this.chunkDataProvider(cx, cy);
    if (!chunkData) {
      this.pendingLoads.delete(key);
      return;
    }

    if (this.workerPool) {
      // Async path: offload mesh generation to a Web Worker
      this.workerPool.requestMesh(chunkData, lod).then(
        (meshData) => {
          this.onMeshReady(key, cx, cy, lod, meshData);
        },
        (error) => {
          this.pendingLoads.delete(key);
          log.warn(
            `Worker mesh generation failed for (${cx},${cy}) LOD${lod}, ` +
            `falling back to sync: ${error instanceof Error ? error.message : String(error)}`,
          );
          // Fallback: build synchronously on main thread
          this.loadChunkSync(key, cx, cy, lod, chunkData);
        },
      );
    } else {
      // Sync fallback: build on main thread
      this.loadChunkSync(key, cx, cy, lod, chunkData);
    }
  }

  /**
   * Synchronous mesh build fallback. Used when WorkerPool is unavailable
   * or when a worker request fails.
   */
  private loadChunkSync(
    key: ChunkKey,
    cx: number,
    cy: number,
    lod: LODLevel,
    chunkData: ChunkData,
  ): void {
    const meshData = buildChunkMesh(chunkData, lod);
    this.onMeshReady(key, cx, cy, lod, meshData);
  }

  /**
   * Handle completed mesh data (from either worker or sync fallback).
   *
   * Guards against stale results: if the chunk was unloaded while
   * the worker was busy (camera moved away), the result is discarded.
   */
  private onMeshReady(
    key: ChunkKey,
    cx: number,
    cy: number,
    lod: LODLevel,
    meshData: ChunkMeshData,
  ): void {
    // Discard if no longer pending (chunk was unloaded while building)
    if (!this.pendingLoads.has(key)) {
      return;
    }

    this.pendingLoads.delete(key);

    // Discard if chunk was already loaded by another path (race condition)
    if (this.loadedChunks.has(key)) {
      return;
    }

    const mesh = this.createMeshFromData(meshData, cx, cy);
    this.loadedChunks.set(key, { mesh, lod });
    this.terrainGroup.add(mesh);

    gameEvents.emit('chunk_loaded', { cx, cy });
  }

  // ── Unloading ──────────────────────────────────────────────────

  /**
   * Unload chunks that are beyond unloadRadius from camera chunk.
   */
  private unloadDistantChunks(cameraCx: number, cameraCy: number): void {
    const toRemove: ChunkKey[] = [];

    for (const key of this.loadedChunks.keys()) {
      const coords = parseKeyFast(key);
      const dist = Math.max(
        Math.abs(coords.cx - cameraCx),
        Math.abs(coords.cy - cameraCy),
      );
      if (dist > this.unloadRadius) {
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      this.unloadChunk(key);
    }
  }

  /**
   * Remove a single chunk: dispose GPU resources, remove from scene and map.
   * Also cancels any pending load for this chunk key so that in-flight
   * worker results are discarded in onMeshReady.
   */
  private unloadChunk(key: ChunkKey): void {
    const entry = this.loadedChunks.get(key);
    if (!entry) return;

    const coords = parseKeyFast(key);
    this.disposeEntry(entry);
    this.loadedChunks.delete(key);

    // If the chunk is still pending (async build in flight), mark it
    // as no longer wanted so onMeshReady discards the result.
    this.pendingLoads.delete(key);

    gameEvents.emit('chunk_unloaded', { cx: coords.cx, cy: coords.cy });
  }

  // ── LOD Management ─────────────────────────────────────────────

  /**
   * Re-evaluate LOD for loaded chunks and rebuild any that need a different level.
   */
  private updateLODs(cameraCx: number, cameraCy: number): void {
    for (const [key, entry] of this.loadedChunks) {
      const coords = parseKeyFast(key);
      const dist = Math.max(
        Math.abs(coords.cx - cameraCx),
        Math.abs(coords.cy - cameraCy),
      );
      const desiredLod = this.getLOD(dist);

      if (desiredLod !== entry.lod) {
        // Skip if already rebuilding this chunk
        if (this.pendingLoads.has(key)) continue;

        const chunkData = this.chunkDataProvider(coords.cx, coords.cy);
        if (!chunkData) continue;

        if (this.workerPool) {
          // Async LOD rebuild via worker
          this.pendingLoads.add(key);
          this.workerPool.requestMesh(chunkData, desiredLod).then(
            (meshData) => {
              this.onLodMeshReady(key, coords.cx, coords.cy, desiredLod, meshData);
            },
            (error) => {
              this.pendingLoads.delete(key);
              log.warn(
                `Worker LOD rebuild failed for (${coords.cx},${coords.cy}), ` +
                `falling back to sync: ${error instanceof Error ? error.message : String(error)}`,
              );
              // Sync fallback for LOD rebuild
              const syncMeshData = buildChunkMesh(chunkData, desiredLod);
              this.onLodMeshReady(key, coords.cx, coords.cy, desiredLod, syncMeshData);
            },
          );
        } else {
          // Sync LOD rebuild
          const meshData = buildChunkMesh(chunkData, desiredLod);
          const newMesh = this.createMeshFromData(meshData, coords.cx, coords.cy);

          this.disposeEntry(entry);
          entry.mesh = newMesh;
          entry.lod = desiredLod;
          this.terrainGroup.add(newMesh);

          gameEvents.emit('lod_changed', { cx: coords.cx, cy: coords.cy, lod: desiredLod });
        }
      }
    }
  }

  /**
   * Handle completed LOD rebuild mesh data from a worker.
   *
   * Guards against stale results: the chunk may have been unloaded
   * or further LOD changes may have occurred while the worker was busy.
   */
  private onLodMeshReady(
    key: ChunkKey,
    cx: number,
    cy: number,
    lod: LODLevel,
    meshData: ChunkMeshData,
  ): void {
    this.pendingLoads.delete(key);

    const entry = this.loadedChunks.get(key);
    if (!entry) {
      // Chunk was unloaded while we were rebuilding -- discard.
      return;
    }

    // Only apply if the LOD is still different (might have been
    // rebuilt again by a subsequent sync path).
    if (entry.lod === lod) {
      return;
    }

    const newMesh = this.createMeshFromData(meshData, cx, cy);

    this.disposeEntry(entry);
    entry.mesh = newMesh;
    entry.lod = lod;
    this.terrainGroup.add(newMesh);

    gameEvents.emit('lod_changed', { cx, cy, lod });
  }

  /**
   * Determine LOD level from Chebyshev distance (in chunks) to the camera chunk.
   *
   * LOD0: 0-2 chunks (full detail voxels)
   * LOD1: 3-5 chunks (reduced)
   * LOD2: 6-9 chunks (low detail)
   * LOD3: 10+ chunks  (single quad per chunk)
   */
  private getLOD(chunkDistance: number): LODLevel {
    if (chunkDistance <= 2) return 0;
    if (chunkDistance <= 5) return 1;
    if (chunkDistance <= 9) return 2;
    return 3;
  }

  // ── Mesh Creation ──────────────────────────────────────────────

  /**
   * Create a Three.js Mesh from worker-produced ChunkMeshData.
   * Uses shared material (vertex colors), positions chunk in world space.
   */
  private createMeshFromData(meshData: ChunkMeshData, cx: number, cy: number): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(meshData.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

    const mesh = new THREE.Mesh(geometry, CHUNK_MATERIAL);

    // Chunk (0,0) starts at world x = -MAP_SIZE/2, z = -MAP_SIZE/2
    mesh.position.set(
      cx * CHUNK_SIZE - MAP_SIZE / 2,
      0,
      cy * CHUNK_SIZE - MAP_SIZE / 2,
    );

    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    // Store chunk coords in userData for raycasting / debugging
    mesh.userData = { cx, cy };

    return mesh;
  }

  // ── Cleanup Helpers ────────────────────────────────────────────

  /**
   * Dispose GPU resources for a loaded chunk entry.
   */
  private disposeEntry(entry: LoadedChunkEntry): void {
    entry.mesh.geometry.dispose();
    // Material is shared -- do NOT dispose it here
    this.terrainGroup.remove(entry.mesh);
  }
}

// ── Utility ────────────────────────────────────────────────────────

/**
 * Fast chunk key parser that avoids string split + Number conversion overhead.
 * ChunkKey is always `${number},${number}`.
 */
function parseKeyFast(key: ChunkKey): { cx: number; cy: number } {
  const commaIdx = key.indexOf(',');
  return {
    cx: Number(key.slice(0, commaIdx)),
    cy: Number(key.slice(commaIdx + 1)),
  };
}
