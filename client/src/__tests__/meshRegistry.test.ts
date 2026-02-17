import { describe, it, expect, beforeEach } from 'vitest';
import type * as THREE from 'three';
import {
  registerBatchedMesh,
  getBatchedMesh,
  unregisterBatchedMesh,
  registerInstancePool,
  getInstancePool,
  unregisterInstancePool,
  allocateInstance,
  releaseInstance,
  getActiveInstanceCount,
  clearMeshRegistry,
} from '../ecs/meshRegistry';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBatchedMesh(): THREE.BatchedMesh {
  return {} as unknown as THREE.BatchedMesh;
}

function makeInstancedMesh(count: number): THREE.InstancedMesh {
  return { count } as unknown as THREE.InstancedMesh;
}

// ── Reset state before every test ────────────────────────────────────────────

beforeEach(() => {
  clearMeshRegistry();
});

// ─────────────────────────────────────────────────────────────────────────────
// BatchedMesh Registry
// ─────────────────────────────────────────────────────────────────────────────

describe('BatchedMesh registry', () => {
  it('returns the registered mesh for a given batchId', () => {
    const mesh = makeBatchedMesh();
    registerBatchedMesh(1, mesh);

    expect(getBatchedMesh(1)).toBe(mesh);
  });

  it('returns undefined for an unregistered batchId', () => {
    expect(getBatchedMesh(999)).toBeUndefined();
  });

  it('unregisterBatchedMesh removes the entry so subsequent lookups return undefined', () => {
    const mesh = makeBatchedMesh();
    registerBatchedMesh(2, mesh);
    unregisterBatchedMesh(2);

    expect(getBatchedMesh(2)).toBeUndefined();
  });

  it('multiple BatchedMeshes can coexist under different batchIds', () => {
    const meshA = makeBatchedMesh();
    const meshB = makeBatchedMesh();
    const meshC = makeBatchedMesh();
    registerBatchedMesh(10, meshA);
    registerBatchedMesh(20, meshB);
    registerBatchedMesh(30, meshC);

    expect(getBatchedMesh(10)).toBe(meshA);
    expect(getBatchedMesh(20)).toBe(meshB);
    expect(getBatchedMesh(30)).toBe(meshC);
  });

  it('registering a new mesh under the same batchId overwrites the previous entry', () => {
    const meshOld = makeBatchedMesh();
    const meshNew = makeBatchedMesh();
    registerBatchedMesh(5, meshOld);
    registerBatchedMesh(5, meshNew);

    expect(getBatchedMesh(5)).toBe(meshNew);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// InstancedMesh Pool Registry
// ─────────────────────────────────────────────────────────────────────────────

describe('InstancedMesh pool registry', () => {
  it('returns the registered mesh for a given poolId', () => {
    const mesh = makeInstancedMesh(10);
    registerInstancePool(1, mesh);

    expect(getInstancePool(1)).toBe(mesh);
  });

  it('returns undefined for an unregistered poolId', () => {
    expect(getInstancePool(999)).toBeUndefined();
  });

  it('unregisterInstancePool removes the pool, freeList, and highWaterMark', () => {
    const mesh = makeInstancedMesh(10);
    registerInstancePool(3, mesh);
    // Allocate so that internal state is non-trivial before removal.
    allocateInstance(3);
    releaseInstance(3, 0);

    unregisterInstancePool(3);

    expect(getInstancePool(3)).toBeUndefined();
    // After removal allocations must fail cleanly (pool lookup returns -1).
    expect(allocateInstance(3)).toBe(-1);
    // Active count should fall back to its default zero-state.
    expect(getActiveInstanceCount(3)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Instance Allocation
// ─────────────────────────────────────────────────────────────────────────────

describe('allocateInstance', () => {
  it('returns sequential indices starting at 0 for fresh allocations', () => {
    registerInstancePool(1, makeInstancedMesh(10));

    expect(allocateInstance(1)).toBe(0);
    expect(allocateInstance(1)).toBe(1);
    expect(allocateInstance(1)).toBe(2);
  });

  it('returns -1 when the poolId is not registered', () => {
    expect(allocateInstance(404)).toBe(-1);
  });

  it('returns -1 when the pool is full (highWaterMark has reached mesh.count)', () => {
    registerInstancePool(1, makeInstancedMesh(3));
    allocateInstance(1); // slot 0
    allocateInstance(1); // slot 1
    allocateInstance(1); // slot 2 — pool now full

    expect(allocateInstance(1)).toBe(-1);
  });

  it('reuses a previously released slot before advancing the highWaterMark', () => {
    registerInstancePool(1, makeInstancedMesh(5));
    allocateInstance(1); // slot 0
    allocateInstance(1); // slot 1
    releaseInstance(1, 0); // push 0 back onto freeList

    // Next allocation must recycle slot 0 (LIFO freeList pop).
    expect(allocateInstance(1)).toBe(0);
    // HWM should still be 2; next fresh allocation yields slot 2.
    expect(allocateInstance(1)).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// releaseInstance
// ─────────────────────────────────────────────────────────────────────────────

describe('releaseInstance', () => {
  it('is a no-op when instanceId is negative', () => {
    registerInstancePool(1, makeInstancedMesh(5));
    allocateInstance(1); // slot 0

    // Releasing a negative id must not throw and must not corrupt state.
    releaseInstance(1, -1);

    expect(getActiveInstanceCount(1)).toBe(1);
  });

  it('is a no-op when the poolId is not registered', () => {
    // Must not throw even though pool 999 was never registered.
    expect(() => releaseInstance(999, 0)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getActiveInstanceCount
// ─────────────────────────────────────────────────────────────────────────────

describe('getActiveInstanceCount', () => {
  it('returns 0 for a freshly registered pool', () => {
    registerInstancePool(1, makeInstancedMesh(10));

    expect(getActiveInstanceCount(1)).toBe(0);
  });

  it('returns 0 for an unregistered poolId (defaults to hwm=0, freeCount=0)', () => {
    expect(getActiveInstanceCount(404)).toBe(0);
  });

  it('increments by 1 for each allocation', () => {
    registerInstancePool(1, makeInstancedMesh(10));
    allocateInstance(1);
    allocateInstance(1);
    allocateInstance(1);

    expect(getActiveInstanceCount(1)).toBe(3);
  });

  it('decrements by 1 for each release', () => {
    registerInstancePool(1, makeInstancedMesh(10));
    allocateInstance(1); // slot 0
    allocateInstance(1); // slot 1
    releaseInstance(1, 0);

    expect(getActiveInstanceCount(1)).toBe(1);
  });

  it('stays correct across a mixed allocate/release/reallocate sequence', () => {
    registerInstancePool(1, makeInstancedMesh(10));

    // Allocate three slots.
    allocateInstance(1); // 0
    allocateInstance(1); // 1
    allocateInstance(1); // 2
    expect(getActiveInstanceCount(1)).toBe(3);

    // Release two of them.
    releaseInstance(1, 1);
    releaseInstance(1, 0);
    expect(getActiveInstanceCount(1)).toBe(1);

    // Reallocate one recycled slot.
    allocateInstance(1); // recycles 0 (LIFO)
    expect(getActiveInstanceCount(1)).toBe(2);

    // Allocate one fresh slot.
    allocateInstance(1); // slot 3 (hwm was 3)
    expect(getActiveInstanceCount(1)).toBe(3);

    // Release the recycled and the new slot.
    releaseInstance(1, 0);
    releaseInstance(1, 3);
    expect(getActiveInstanceCount(1)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clearMeshRegistry
// ─────────────────────────────────────────────────────────────────────────────

describe('clearMeshRegistry', () => {
  it('removes all batched meshes, instance pools, freeLists, and highWaterMarks', () => {
    registerBatchedMesh(1, makeBatchedMesh());
    registerBatchedMesh(2, makeBatchedMesh());

    registerInstancePool(10, makeInstancedMesh(5));
    allocateInstance(10);
    allocateInstance(10);
    releaseInstance(10, 0);

    registerInstancePool(20, makeInstancedMesh(8));
    allocateInstance(20);

    clearMeshRegistry();

    // BatchedMesh entries must be gone.
    expect(getBatchedMesh(1)).toBeUndefined();
    expect(getBatchedMesh(2)).toBeUndefined();

    // Pool entries must be gone.
    expect(getInstancePool(10)).toBeUndefined();
    expect(getInstancePool(20)).toBeUndefined();

    // Allocation on cleared pools must return -1.
    expect(allocateInstance(10)).toBe(-1);
    expect(allocateInstance(20)).toBe(-1);

    // Active counts must default to zero.
    expect(getActiveInstanceCount(10)).toBe(0);
    expect(getActiveInstanceCount(20)).toBe(0);
  });

  it('leaves the registry in a fully functional state for new registrations after clearing', () => {
    registerInstancePool(1, makeInstancedMesh(3));
    allocateInstance(1);

    clearMeshRegistry();

    // Re-register after clear — should work as if fresh.
    registerInstancePool(1, makeInstancedMesh(3));
    expect(allocateInstance(1)).toBe(0);
    expect(allocateInstance(1)).toBe(1);
    expect(getActiveInstanceCount(1)).toBe(2);
  });
});
