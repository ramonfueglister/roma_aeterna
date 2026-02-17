/**
 * ChunkLoader: manages loading, caching, and lifecycle of terrain chunks.
 *
 * Uses THREE.BatchedMesh to render all chunks of the same LOD level in a
 * single draw call (4 draw calls total for terrain). Each chunk's geometry
 * is added to the appropriate LOD BatchedMesh and positioned via its
 * instance matrix.
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
import { getCachedMesh, putCachedMesh, hashChunkData } from './meshCache';
import { WorkerPool } from '../workers/workerPool';

const log = createLogger('ChunkLoader');

// ── Types ──────────────────────────────────────────────────────────

interface LoadedChunkEntry {
  lod: LODLevel;
  geometryId: number;
  instanceId: number;
}

/**
 * Provider function that returns ChunkData for a given chunk coordinate.
 * Returns null if the chunk is unavailable.
 */
export type ChunkDataProvider = (cx: number, cy: number) => ChunkData | null;

// ── Constants ──────────────────────────────────────────────────────

/** Maximum chunks to initiate loading per update frame. */
const LOAD_BUDGET_PER_FRAME = 2;

/** Shared material for all terrain BatchedMeshes (vertex-colored, flat-shaded). */
const CHUNK_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.95,
  metalness: 0.02,
  side: THREE.FrontSide,
});

/**
 * Per-LOD buffer budgets. Each LOD level pre-allocates space in its
 * BatchedMesh for this many chunks, with reserved vertex/index counts
 * sized for the worst-case greedy meshing output at that LOD.
 */
const LOD_BUDGETS: Record<LODLevel, {
  maxChunks: number;
  vertsPerChunk: number;
  indicesPerChunk: number;
}> = {
  0: { maxChunks: 80,  vertsPerChunk: 5000,  indicesPerChunk: 8000 },
  1: { maxChunks: 120, vertsPerChunk: 1500,  indicesPerChunk: 2500 },
  2: { maxChunks: 200, vertsPerChunk: 500,   indicesPerChunk: 800 },
  3: { maxChunks: 200, vertsPerChunk: 12,    indicesPerChunk: 12 },
};

// ── Pre-computed spiral offsets ────────────────────────────────────

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
  /** THREE.Group added to the scene; all BatchedMeshes are children. */
  readonly terrainGroup: THREE.Group;

  /** One BatchedMesh per LOD level. */
  private readonly batchedMeshes: Map<LODLevel, THREE.BatchedMesh> = new Map();

  /** Currently loaded and visible chunks. */
  private loadedChunks: Map<ChunkKey, LoadedChunkEntry> = new Map();

  /** Chunks currently being built (prevents duplicate requests). */
  private pendingLoads: Set<ChunkKey> = new Set();

  /** Radius in chunks within which chunks are loaded. */
  loadRadius: number;

  /** Radius in chunks beyond which chunks are unloaded. */
  unloadRadius: number;

  /** Chunk data provider. Defaults to procedural generator. */
  chunkDataProvider: ChunkDataProvider;

  /** Worker pool for off-thread mesh generation. */
  private workerPool: WorkerPool | null;

  /** Last camera chunk position. */
  private lastCameraCx = -9999;
  private lastCameraCy = -9999;

  /** Reusable matrix for positioning instances. */
  private readonly tmpMatrix = new THREE.Matrix4();

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
    this.workerPool = options?.workerPool ?? null;
    this.chunkDataProvider = generateProceduralChunk;

    // Create one BatchedMesh per LOD level
    for (const lod of [0, 1, 2, 3] as LODLevel[]) {
      this.createBatchedMesh(lod);
    }

    const workerInfo = this.workerPool
      ? `workerPool=${this.workerPool.workerCount} workers`
      : 'sync fallback (no WorkerPool)';

    log.info(
      `Initialised (BatchedMesh): loadRadius=${this.loadRadius}, ` +
      `unloadRadius=${this.unloadRadius}, ` +
      `gridSize=${GRID_SIZE}x${GRID_SIZE}, ${workerInfo}`,
    );
  }

  // ── BatchedMesh Setup ─────────────────────────────────────────

  private createBatchedMesh(lod: LODLevel): void {
    const budget = LOD_BUDGETS[lod];
    const totalVerts = budget.maxChunks * budget.vertsPerChunk;
    const totalIndices = budget.maxChunks * budget.indicesPerChunk;

    const bm = new THREE.BatchedMesh(
      budget.maxChunks,
      totalVerts,
      totalIndices,
      CHUNK_MATERIAL,
    );
    bm.name = `terrain_lod${lod}`;
    bm.frustumCulled = false; // We manage visibility per-instance
    this.batchedMeshes.set(lod, bm);
    this.terrainGroup.add(bm);
  }

  // ── Public API ─────────────────────────────────────────────────

  update(cameraWorldX: number, cameraWorldZ: number): void {
    const tileX = cameraWorldX + MAP_SIZE / 2;
    const tileZ = cameraWorldZ + MAP_SIZE / 2;
    const { cx: cameraCx, cy: cameraCy } = worldToChunk(tileX, tileZ);

    if (cameraCx === this.lastCameraCx && cameraCy === this.lastCameraCy) {
      return;
    }
    this.lastCameraCx = cameraCx;
    this.lastCameraCy = cameraCy;

    this.loadNearbyChunks(cameraCx, cameraCy);
    this.unloadDistantChunks(cameraCx, cameraCy);
    this.updateLODs(cameraCx, cameraCy);
  }

  get loadedCount(): number {
    return this.loadedChunks.size;
  }

  get pendingCount(): number {
    return this.pendingLoads.size;
  }

  setWorkerPool(pool: WorkerPool | null): void {
    this.workerPool = pool;
    log.info(
      pool
        ? `WorkerPool set: ${pool.workerCount} workers`
        : 'WorkerPool removed, using sync fallback',
    );
  }

  dispose(): void {
    for (const [key, entry] of this.loadedChunks) {
      this.removeFromBatch(entry);
      this.loadedChunks.delete(key);
    }
    this.pendingLoads.clear();

    for (const bm of this.batchedMeshes.values()) {
      bm.dispose();
    }
    this.batchedMeshes.clear();
    this.terrainGroup.removeFromParent();
    log.info('Disposed');
  }

  // ── Loading ────────────────────────────────────────────────────

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

  private loadChunk(cx: number, cy: number, lod: LODLevel): void {
    const key = makeChunkKey(cx, cy);
    this.pendingLoads.add(key);

    const chunkData = this.chunkDataProvider(cx, cy);
    if (!chunkData) {
      this.pendingLoads.delete(key);
      return;
    }

    const dataHash = hashChunkData(chunkData);

    // Try IndexedDB cache first (async, non-blocking)
    getCachedMesh(cx, cy, lod, dataHash).then((cached) => {
      if (!this.pendingLoads.has(key)) return;

      if (cached) {
        this.onMeshReady(key, cx, cy, lod, cached);
        return;
      }

      // Cache miss — generate the mesh
      this.generateMesh(key, cx, cy, lod, chunkData, dataHash);
    });
  }

  private generateMesh(
    key: ChunkKey,
    cx: number,
    cy: number,
    lod: LODLevel,
    chunkData: ChunkData,
    dataHash: string,
  ): void {
    if (this.workerPool) {
      this.workerPool.requestMesh(chunkData, lod).then(
        (meshData) => {
          putCachedMesh(cx, cy, lod, dataHash, meshData);
          this.onMeshReady(key, cx, cy, lod, meshData);
        },
        (error) => {
          this.pendingLoads.delete(key);
          log.warn(
            `Worker mesh generation failed for (${cx},${cy}) LOD${lod}, ` +
            `falling back to sync: ${error instanceof Error ? error.message : String(error)}`,
          );
          this.loadChunkSync(key, cx, cy, lod, chunkData, dataHash);
        },
      );
    } else {
      this.loadChunkSync(key, cx, cy, lod, chunkData, dataHash);
    }
  }

  private loadChunkSync(
    key: ChunkKey,
    cx: number,
    cy: number,
    lod: LODLevel,
    chunkData: ChunkData,
    dataHash: string,
  ): void {
    const meshData = buildChunkMesh(chunkData, lod);
    putCachedMesh(cx, cy, lod, dataHash, meshData);
    this.onMeshReady(key, cx, cy, lod, meshData);
  }

  private onMeshReady(
    key: ChunkKey,
    cx: number,
    cy: number,
    lod: LODLevel,
    meshData: ChunkMeshData,
  ): void {
    if (!this.pendingLoads.has(key)) return;
    this.pendingLoads.delete(key);
    if (this.loadedChunks.has(key)) return;

    const entry = this.addToBatch(cx, cy, lod, meshData);
    if (!entry) {
      log.warn(`BatchedMesh full for LOD${lod}, cannot add chunk (${cx},${cy})`);
      return;
    }

    this.loadedChunks.set(key, entry);
    gameEvents.emit('chunk_loaded', { cx, cy });
  }

  // ── Unloading ──────────────────────────────────────────────────

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

  private unloadChunk(key: ChunkKey): void {
    const entry = this.loadedChunks.get(key);
    if (!entry) return;

    const coords = parseKeyFast(key);
    this.removeFromBatch(entry);
    this.loadedChunks.delete(key);
    this.pendingLoads.delete(key);

    gameEvents.emit('chunk_unloaded', { cx: coords.cx, cy: coords.cy });
  }

  // ── LOD Management ─────────────────────────────────────────────

  private updateLODs(cameraCx: number, cameraCy: number): void {
    for (const [key, entry] of this.loadedChunks) {
      const coords = parseKeyFast(key);
      const dist = Math.max(
        Math.abs(coords.cx - cameraCx),
        Math.abs(coords.cy - cameraCy),
      );
      const desiredLod = this.getLOD(dist);

      if (desiredLod !== entry.lod) {
        if (this.pendingLoads.has(key)) continue;

        const chunkData = this.chunkDataProvider(coords.cx, coords.cy);
        if (!chunkData) continue;

        if (this.workerPool) {
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
              const syncMeshData = buildChunkMesh(chunkData, desiredLod);
              this.onLodMeshReady(key, coords.cx, coords.cy, desiredLod, syncMeshData);
            },
          );
        } else {
          const meshData = buildChunkMesh(chunkData, desiredLod);
          this.swapChunkLod(key, entry, coords.cx, coords.cy, desiredLod, meshData);
        }
      }
    }
  }

  private onLodMeshReady(
    key: ChunkKey,
    cx: number,
    cy: number,
    lod: LODLevel,
    meshData: ChunkMeshData,
  ): void {
    this.pendingLoads.delete(key);

    const entry = this.loadedChunks.get(key);
    if (!entry) return;
    if (entry.lod === lod) return;

    this.swapChunkLod(key, entry, cx, cy, lod, meshData);
  }

  private swapChunkLod(
    key: ChunkKey,
    entry: LoadedChunkEntry,
    cx: number,
    cy: number,
    newLod: LODLevel,
    meshData: ChunkMeshData,
  ): void {
    // Remove from old LOD batch
    this.removeFromBatch(entry);

    // Add to new LOD batch
    const newEntry = this.addToBatch(cx, cy, newLod, meshData);
    if (!newEntry) {
      // Could not fit in new batch -- keep chunk removed
      this.loadedChunks.delete(key);
      log.warn(`BatchedMesh full for LOD${newLod} during LOD swap (${cx},${cy})`);
      return;
    }

    // Update entry in-place
    entry.lod = newEntry.lod;
    entry.geometryId = newEntry.geometryId;
    entry.instanceId = newEntry.instanceId;

    gameEvents.emit('lod_changed', { cx, cy, lod: newLod });
  }

  private getLOD(chunkDistance: number): LODLevel {
    if (chunkDistance <= 2) return 0;
    if (chunkDistance <= 5) return 1;
    if (chunkDistance <= 9) return 2;
    return 3;
  }

  // ── BatchedMesh Operations ────────────────────────────────────

  /**
   * Add a chunk's geometry to the appropriate LOD BatchedMesh.
   * Returns the entry with geometry/instance IDs, or null if the batch is full.
   */
  private addToBatch(
    cx: number,
    cy: number,
    lod: LODLevel,
    meshData: ChunkMeshData,
  ): LoadedChunkEntry | null {
    const bm = this.batchedMeshes.get(lod);
    if (!bm) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(meshData.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

    const budget = LOD_BUDGETS[lod];

    let geometryId: number;
    try {
      geometryId = bm.addGeometry(geometry, budget.vertsPerChunk, budget.indicesPerChunk);
    } catch {
      geometry.dispose();
      return null;
    }

    let instanceId: number;
    try {
      instanceId = bm.addInstance(geometryId);
    } catch {
      bm.deleteGeometry(geometryId);
      geometry.dispose();
      return null;
    }

    // Position the instance at the chunk's world-space origin
    this.tmpMatrix.makeTranslation(
      cx * CHUNK_SIZE - MAP_SIZE / 2,
      0,
      cy * CHUNK_SIZE - MAP_SIZE / 2,
    );
    bm.setMatrixAt(instanceId, this.tmpMatrix);

    // Dispose the temporary geometry (data has been copied into BatchedMesh)
    geometry.dispose();

    return { lod, geometryId, instanceId };
  }

  /**
   * Remove a chunk from its LOD BatchedMesh.
   */
  private removeFromBatch(entry: LoadedChunkEntry): void {
    const bm = this.batchedMeshes.get(entry.lod);
    if (!bm) return;

    try {
      bm.deleteGeometry(entry.geometryId);
    } catch {
      // Geometry may have already been removed
    }
  }
}

// ── Utility ────────────────────────────────────────────────────────

function parseKeyFast(key: ChunkKey): { cx: number; cy: number } {
  const commaIdx = key.indexOf(',');
  return {
    cx: Number(key.slice(0, commaIdx)),
    cy: Number(key.slice(commaIdx + 1)),
  };
}
