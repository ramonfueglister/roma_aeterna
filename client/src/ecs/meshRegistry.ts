/**
 * MeshRegistry: Bridge between ECS integer indices and Three.js objects.
 *
 * ECS components store only integers (MeshRef.batchId, InstanceRef.poolId,
 * InstanceRef.instanceId). Systems use this registry to look up the actual
 * Three.js objects (BatchedMesh, InstancedMesh) for rendering.
 *
 * This is a singleton module — import and use directly, no class instantiation.
 */

import type * as THREE from 'three';

// ── BatchedMesh Registry (terrain LOD meshes) ─────────────────────

const batchedMeshes = new Map<number, THREE.BatchedMesh>();

export function registerBatchedMesh(batchId: number, mesh: THREE.BatchedMesh): void {
  batchedMeshes.set(batchId, mesh);
}

export function getBatchedMesh(batchId: number): THREE.BatchedMesh | undefined {
  return batchedMeshes.get(batchId);
}

export function unregisterBatchedMesh(batchId: number): void {
  batchedMeshes.delete(batchId);
}

// ── InstancedMesh Pool Registry (trees, agents, city icons) ───────

const instancePools = new Map<number, THREE.InstancedMesh>();

/**
 * Free-list per pool for instance slot recycling.
 * When an instance is released, its slot index is pushed onto the free list.
 * Next allocation pops from the free list before incrementing the high-water mark.
 */
const freeLists = new Map<number, number[]>();

/** High-water mark per pool: next fresh slot to allocate when free list empty. */
const highWaterMarks = new Map<number, number>();

export function registerInstancePool(poolId: number, mesh: THREE.InstancedMesh): void {
  instancePools.set(poolId, mesh);
  freeLists.set(poolId, []);
  highWaterMarks.set(poolId, 0);
}

export function getInstancePool(poolId: number): THREE.InstancedMesh | undefined {
  return instancePools.get(poolId);
}

export function unregisterInstancePool(poolId: number): void {
  instancePools.delete(poolId);
  freeLists.delete(poolId);
  highWaterMarks.delete(poolId);
}

/**
 * Allocate an instance slot from the pool.
 * Returns the instance index, or -1 if the pool is full.
 */
export function allocateInstance(poolId: number): number {
  const mesh = instancePools.get(poolId);
  if (!mesh) return -1;

  const freeList = freeLists.get(poolId);
  if (freeList && freeList.length > 0) {
    return freeList.pop()!;
  }

  const hwm = highWaterMarks.get(poolId) ?? 0;
  if (hwm >= mesh.count) return -1;

  highWaterMarks.set(poolId, hwm + 1);
  return hwm;
}

/**
 * Release an instance slot back to the pool for reuse.
 */
export function releaseInstance(poolId: number, instanceId: number): void {
  if (instanceId < 0) return;
  const freeList = freeLists.get(poolId);
  if (freeList) {
    freeList.push(instanceId);
  }
}

/**
 * Get the number of active (allocated) instances in a pool.
 */
export function getActiveInstanceCount(poolId: number): number {
  const hwm = highWaterMarks.get(poolId) ?? 0;
  const freeCount = freeLists.get(poolId)?.length ?? 0;
  return hwm - freeCount;
}

// ── Cleanup ───────────────────────────────────────────────────────

/** Clear all registries. Call on engine dispose. */
export function clearMeshRegistry(): void {
  batchedMeshes.clear();
  instancePools.clear();
  freeLists.clear();
  highWaterMarks.clear();
}
