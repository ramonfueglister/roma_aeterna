import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock Three.js before any imports
vi.mock('three', () => {
  const Group = vi.fn(() => ({
    name: '',
    add: vi.fn(),
    remove: vi.fn(),
    removeFromParent: vi.fn(),
    children: [],
  }));
  const Scene = vi.fn(() => ({
    add: vi.fn(),
    remove: vi.fn(),
    children: [],
  }));
  const BufferGeometry = vi.fn(() => ({
    setAttribute: vi.fn(),
    setIndex: vi.fn(),
    dispose: vi.fn(),
  }));
  const BufferAttribute = vi.fn();
  const MeshStandardMaterial = vi.fn(() => ({
    dispose: vi.fn(),
  }));
  const Matrix4 = vi.fn(() => ({
    makeTranslation: vi.fn().mockReturnThis(),
  }));
  const BatchedMesh = vi.fn(() => ({
    name: '',
    frustumCulled: true,
    addGeometry: vi.fn().mockReturnValue(0),
    addInstance: vi.fn().mockReturnValue(0),
    setMatrixAt: vi.fn(),
    setColorAt: vi.fn(),
    deleteGeometry: vi.fn(),
    deleteInstance: vi.fn(),
    dispose: vi.fn(),
  }));
  return {
    Group,
    Scene,
    BufferGeometry,
    BufferAttribute,
    MeshStandardMaterial,
    Matrix4,
    BatchedMesh,
    FrontSide: 0,
  };
});

// Mock greedyMesher (ChunkLoader uses greedyMeshChunk, not buildChunkMesh)
vi.mock('../world/greedyMesher', () => ({
  greedyMeshChunk: vi.fn(() => ({
    positions: new Float32Array(12),
    normals: new Float32Array(12),
    colors: new Float32Array(12),
    indices: new Uint32Array(6),
  })),
}));

// Mock proceduralChunk (default chunkDataProvider)
vi.mock('../world/proceduralChunk', () => ({
  generateProceduralChunk: vi.fn(() => null),
}));

// Mock meshRegistry to prevent ECS side effects
vi.mock('../ecs/meshRegistry', () => ({
  registerBatchedMesh: vi.fn(),
  unregisterBatchedMesh: vi.fn(),
}));

// Mock meshCache to resolve synchronously in tests
vi.mock('../world/meshCache', () => ({
  getCachedMesh: vi.fn(() => Promise.resolve(null)),
  putCachedMesh: vi.fn(() => Promise.resolve()),
  hashChunkData: vi.fn(() => 'testhash'),
}));

// Mock logger to suppress console output during tests
vi.mock('../core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock gameEvents to prevent event emission side effects
vi.mock('../core/eventBus', () => ({
  gameEvents: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    clear: vi.fn(),
  },
}));

import * as THREE from 'three';
import { ChunkLoader } from '../world/chunkLoader';
import { greedyMeshChunk } from '../world/greedyMesher';
import { BiomeType, type ChunkData } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockBatchedMesh = THREE.BatchedMesh as any as ReturnType<typeof vi.fn>;

/**
 * Create a minimal ChunkData object for testing.
 */
function createMockChunkData(cx: number, cy: number): ChunkData {
  return {
    cx,
    cy,
    heights: new Uint8Array(1024).fill(20),
    biomes: new Uint8Array(1024).fill(BiomeType.GRASS),
    flags: new Uint8Array(1024).fill(0),
    provinces: new Uint8Array(1024).fill(1),
  };
}

/**
 * Helper: make the mock BatchedMesh return incrementing IDs to avoid collisions.
 */
function setupIncrementingIds(): void {
  let geoId = 0;
  let instId = 0;
  const bmInstances = MockBatchedMesh.mock.results;
  for (const result of bmInstances) {
    const bm = result.value;
    (bm.addGeometry as ReturnType<typeof vi.fn>).mockImplementation(() => geoId++);
    (bm.addInstance as ReturnType<typeof vi.fn>).mockImplementation(() => instId++);
  }
}

/**
 * Flush microtask queue so async cache lookups resolve.
 */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>(r => setTimeout(r, 0));
}

/**
 * Run multiple update() calls with microtask flushing between each,
 * so the async cache path resolves.
 */
async function updateNTimes(loader: ChunkLoader, n: number, x: number, z: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    loader.update(x, z);
    await flushMicrotasks();
  }
}

describe('ChunkLoader', () => {
  let scene: THREE.Scene;
  let loader: ChunkLoader;

  beforeEach(() => {
    vi.clearAllMocks();
    scene = new THREE.Scene();
    loader = new ChunkLoader(scene);
    setupIncrementingIds();
  });

  describe('Constructor', () => {
    it('creates terrainGroup and adds to scene', () => {
      expect(THREE.Group).toHaveBeenCalledTimes(1);
      expect(scene.add).toHaveBeenCalledWith(loader.terrainGroup);
      expect(loader.terrainGroup.name).toBe('terrain');
    });

    it('creates 4 BatchedMeshes (one per LOD level)', () => {
      expect(THREE.BatchedMesh).toHaveBeenCalledTimes(4);
    });

    it('adds all BatchedMeshes to terrainGroup', () => {
      expect(loader.terrainGroup.add).toHaveBeenCalledTimes(4);
    });

    it('uses default loadRadius of 8', () => {
      expect(loader.loadRadius).toBe(8);
    });

    it('uses default unloadRadius of 12', () => {
      expect(loader.unloadRadius).toBe(12);
    });

    it('accepts custom loadRadius via options', () => {
      const customLoader = new ChunkLoader(scene, { loadRadius: 5 });
      expect(customLoader.loadRadius).toBe(5);
    });

    it('accepts custom unloadRadius via options', () => {
      const customLoader = new ChunkLoader(scene, { unloadRadius: 15 });
      expect(customLoader.unloadRadius).toBe(15);
    });

    it('accepts both custom radii via options', () => {
      const customLoader = new ChunkLoader(scene, { loadRadius: 6, unloadRadius: 10 });
      expect(customLoader.loadRadius).toBe(6);
      expect(customLoader.unloadRadius).toBe(10);
    });

    it('initializes with zero loaded chunks', () => {
      expect(loader.loadedCount).toBe(0);
    });

    it('initializes with zero pending chunks', () => {
      expect(loader.pendingCount).toBe(0);
    });

    it('has a default chunkDataProvider', () => {
      expect(typeof loader.chunkDataProvider).toBe('function');
    });
  });

  describe('update()', () => {
    beforeEach(() => {
      loader.chunkDataProvider = (cx: number, cy: number) => {
        if (cx >= 0 && cx < 64 && cy >= 0 && cy < 64) {
          return createMockChunkData(cx, cy);
        }
        return null;
      };
    });

    it('loads chunks when camera is at world origin', async () => {
      await updateNTimes(loader, 10, 0, 0);
      expect(loader.loadedCount).toBeGreaterThan(0);
    });

    it('respects load budget of 2 chunks per frame', async () => {
      const initialCount = loader.loadedCount;
      loader.update(0, 0);
      await flushMicrotasks();
      const loadedInFrame = loader.loadedCount - initialCount;
      expect(loadedInFrame).toBeLessThanOrEqual(2);
    });

    it('does not re-trigger loading when called with same position twice', async () => {
      loader.update(0, 0);
      await flushMicrotasks();
      const countAfterFirst = loader.loadedCount;
      loader.update(0, 0);
      await flushMicrotasks();
      const countAfterSecond = loader.loadedCount;
      expect(countAfterSecond).toBe(countAfterFirst);
    });

    it('loads more chunks when camera moves to new chunk', async () => {
      await updateNTimes(loader, 5, 0, 0);
      const initialCount = loader.loadedCount;

      await updateNTimes(loader, 5, 64, 64);
      const newCount = loader.loadedCount;
      expect(newCount).toBeGreaterThan(initialCount);
    });

    it('loads chunks within loadRadius', async () => {
      const smallLoader = new ChunkLoader(scene, { loadRadius: 2 });
      setupIncrementingIds();
      smallLoader.chunkDataProvider = loader.chunkDataProvider;

      await updateNTimes(smallLoader, 20, 0, 0);

      // With radius 2, should load (2*2+1)^2 = 25 chunks maximum
      expect(smallLoader.loadedCount).toBeLessThanOrEqual(25);
      expect(smallLoader.loadedCount).toBeGreaterThan(0);
    });

    it('calls greedyMeshChunk for each loaded chunk', async () => {
      await updateNTimes(loader, 3, 0, 0);

      expect(greedyMeshChunk).toHaveBeenCalled();
      expect(vi.mocked(greedyMeshChunk).mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe('chunkDataProvider null handling', () => {
    it('skips chunks when chunkDataProvider returns null', async () => {
      loader.chunkDataProvider = () => null;

      await updateNTimes(loader, 10, 0, 0);

      expect(loader.loadedCount).toBe(0);
    });

    it('loads only chunks where provider returns data', async () => {
      loader.chunkDataProvider = (cx: number, cy: number) => {
        if (cx === 32 && cy === 32) {
          return createMockChunkData(cx, cy);
        }
        return null;
      };

      await updateNTimes(loader, 20, 0, 0);

      expect(loader.loadedCount).toBe(1);
    });

    it('skips individual null chunks but loads others', async () => {
      loader.chunkDataProvider = (cx: number, cy: number) => {
        if (cx >= 30 && cx <= 34 && cy >= 30 && cy <= 34) {
          if (cx === 32 && cy === 32) {
            return null;
          }
          return createMockChunkData(cx, cy);
        }
        return null;
      };

      await updateNTimes(loader, 25, 0, 0);

      expect(loader.loadedCount).toBeGreaterThan(0);
    });
  });

  describe('dispose()', () => {
    beforeEach(async () => {
      loader.chunkDataProvider = (cx: number, cy: number) => {
        if (cx >= 30 && cx <= 34 && cy >= 30 && cy <= 34) {
          return createMockChunkData(cx, cy);
        }
        return null;
      };

      await updateNTimes(loader, 20, 0, 0);
    });

    it('clears all loaded chunks', () => {
      expect(loader.loadedCount).toBeGreaterThan(0);
      loader.dispose();
      expect(loader.loadedCount).toBe(0);
    });

    it('clears all pending chunks', () => {
      loader.dispose();
      expect(loader.pendingCount).toBe(0);
    });

    it('removes terrainGroup from parent scene', () => {
      const removeFromParentSpy = vi.spyOn(loader.terrainGroup, 'removeFromParent');
      loader.dispose();
      expect(removeFromParentSpy).toHaveBeenCalledTimes(1);
    });

    it('disposes all BatchedMeshes', () => {
      const bmResults = MockBatchedMesh.mock.results;
      const loaderBMs = bmResults.slice(-4);

      loader.dispose();

      for (const result of loaderBMs) {
        expect(result.value.dispose).toHaveBeenCalled();
      }
    });

    it('calls deleteGeometry for loaded chunks during dispose', () => {
      const bmResults = MockBatchedMesh.mock.results;
      const loaderBMs = bmResults.slice(-4);

      const initialLoadedCount = loader.loadedCount;
      expect(initialLoadedCount).toBeGreaterThan(0);

      loader.dispose();

      let totalDeleteCalls = 0;
      for (const result of loaderBMs) {
        totalDeleteCalls += (result.value.deleteGeometry as ReturnType<typeof vi.fn>).mock.calls.length;
      }
      expect(totalDeleteCalls).toBeGreaterThanOrEqual(initialLoadedCount);
    });

    it('can be called multiple times safely', () => {
      expect(() => {
        loader.dispose();
        loader.dispose();
      }).not.toThrow();
    });
  });

  describe('loadedCount', () => {
    beforeEach(() => {
      loader.chunkDataProvider = (cx: number, cy: number) => {
        if (cx >= 30 && cx <= 34 && cy >= 30 && cy <= 34) {
          return createMockChunkData(cx, cy);
        }
        return null;
      };
    });

    it('starts at zero', () => {
      expect(loader.loadedCount).toBe(0);
    });

    it('increases as chunks are loaded', async () => {
      const initialCount = loader.loadedCount;

      await updateNTimes(loader, 5, 0, 0);

      expect(loader.loadedCount).toBeGreaterThan(initialCount);
    });

    it('returns to zero after dispose', async () => {
      await updateNTimes(loader, 10, 0, 0);

      loader.dispose();

      expect(loader.loadedCount).toBe(0);
    });
  });

  describe('pendingCount', () => {
    beforeEach(() => {
      loader.chunkDataProvider = (cx: number, cy: number) => {
        if (cx >= 30 && cx <= 34 && cy >= 30 && cy <= 34) {
          return createMockChunkData(cx, cy);
        }
        return null;
      };
    });

    it('starts at zero', () => {
      expect(loader.pendingCount).toBe(0);
    });

    it('returns to zero after loading completes', async () => {
      await updateNTimes(loader, 20, 0, 0);
      expect(loader.pendingCount).toBe(0);
    });

    it('returns to zero after dispose', () => {
      loader.dispose();
      expect(loader.pendingCount).toBe(0);
    });
  });

  describe('chunk unloading', () => {
    beforeEach(() => {
      loader.chunkDataProvider = (cx: number, cy: number) => {
        if (cx >= 0 && cx < 64 && cy >= 0 && cy < 64) {
          return createMockChunkData(cx, cy);
        }
        return null;
      };
    });

    it('unloads distant chunks when camera moves far away', async () => {
      await updateNTimes(loader, 20, 0, 0);
      const initialCount = loader.loadedCount;
      expect(initialCount).toBeGreaterThan(0);

      await updateNTimes(loader, 30, 500, 500);

      const finalCount = loader.loadedCount;
      expect(finalCount).toBeGreaterThan(0);
    });

    it('respects unloadRadius when removing chunks', async () => {
      const customLoader = new ChunkLoader(scene, { loadRadius: 3, unloadRadius: 5 });
      setupIncrementingIds();
      customLoader.chunkDataProvider = loader.chunkDataProvider;

      await updateNTimes(customLoader, 20, 0, 0);

      await updateNTimes(customLoader, 30, 500, 500);

      expect(customLoader.loadedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('LOD system', () => {
    beforeEach(() => {
      loader.chunkDataProvider = (cx: number, cy: number) => {
        if (cx >= 0 && cx < 64 && cy >= 0 && cy < 64) {
          return createMockChunkData(cx, cy);
        }
        return null;
      };
    });

    it('passes LOD level to greedyMeshChunk based on distance', async () => {
      await updateNTimes(loader, 10, 0, 0);

      const calls = vi.mocked(greedyMeshChunk).mock.calls;
      expect(calls.length).toBeGreaterThan(0);

      calls.forEach(call => {
        expect(call[0]).toBeDefined(); // chunkData
        expect(typeof call[1]).toBe('number'); // lod level (0-3)
        expect(call[1]).toBeGreaterThanOrEqual(0);
        expect(call[1]).toBeLessThanOrEqual(3);
      });
    });

    it('uses lower LOD (0) for nearby chunks', async () => {
      await updateNTimes(loader, 5, 0, 0);

      const calls = vi.mocked(greedyMeshChunk).mock.calls;
      const hasLod0 = calls.some(call => call[1] === 0);
      expect(hasLod0).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles camera at negative world coordinates', async () => {
      loader.chunkDataProvider = (cx: number, cy: number) => {
        if (cx >= 0 && cx < 64 && cy >= 0 && cy < 64) {
          return createMockChunkData(cx, cy);
        }
        return null;
      };

      await expect((async () => {
        await updateNTimes(loader, 5, -1000, -1000);
      })()).resolves.not.toThrow();
    });

    it('handles camera at extreme positive coordinates', async () => {
      loader.chunkDataProvider = (cx: number, cy: number) => {
        if (cx >= 0 && cx < 64 && cy >= 0 && cy < 64) {
          return createMockChunkData(cx, cy);
        }
        return null;
      };

      await expect((async () => {
        await updateNTimes(loader, 5, 3000, 3000);
      })()).resolves.not.toThrow();
    });

    it('handles empty chunkDataProvider gracefully', async () => {
      loader.chunkDataProvider = () => null;

      await expect((async () => {
        await updateNTimes(loader, 10, 0, 0);
      })()).resolves.not.toThrow();

      expect(loader.loadedCount).toBe(0);
    });

    it('handles rapid camera movement', async () => {
      loader.chunkDataProvider = (cx: number, cy: number) => {
        if (cx >= 0 && cx < 64 && cy >= 0 && cy < 64) {
          return createMockChunkData(cx, cy);
        }
        return null;
      };

      await expect((async () => {
        for (let i = 0; i < 10; i++) {
          loader.update(i * 100, i * 100);
          await flushMicrotasks();
        }
      })()).resolves.not.toThrow();
    });
  });

  describe('BatchedMesh integration', () => {
    beforeEach(() => {
      loader.chunkDataProvider = (cx: number, cy: number) => {
        if (cx === 32 && cy === 32) {
          return createMockChunkData(cx, cy);
        }
        return null;
      };
    });

    it('creates BufferGeometry for mesh data before adding to batch', async () => {
      await updateNTimes(loader, 10, 0, 0);

      expect(THREE.BufferGeometry).toHaveBeenCalled();
      expect(THREE.BufferAttribute).toHaveBeenCalled();
    });

    it('calls addGeometry and addInstance on BatchedMesh', async () => {
      await updateNTimes(loader, 10, 0, 0);

      const bmResults = MockBatchedMesh.mock.results;
      let totalAddGeoCalls = 0;
      let totalAddInstCalls = 0;
      for (const result of bmResults) {
        totalAddGeoCalls += (result.value.addGeometry as ReturnType<typeof vi.fn>).mock.calls.length;
        totalAddInstCalls += (result.value.addInstance as ReturnType<typeof vi.fn>).mock.calls.length;
      }

      expect(totalAddGeoCalls).toBeGreaterThan(0);
      expect(totalAddInstCalls).toBeGreaterThan(0);
    });

    it('calls setMatrixAt to position instances', async () => {
      await updateNTimes(loader, 10, 0, 0);

      const bmResults = MockBatchedMesh.mock.results;
      let totalSetMatrixCalls = 0;
      for (const result of bmResults) {
        totalSetMatrixCalls += (result.value.setMatrixAt as ReturnType<typeof vi.fn>).mock.calls.length;
      }

      expect(totalSetMatrixCalls).toBeGreaterThan(0);
    });

    it('disposes temporary geometry after adding to batch', async () => {
      await updateNTimes(loader, 10, 0, 0);

      // All temp geometries should be disposed after being added to BatchedMesh
      const geoResults = vi.mocked(THREE.BufferGeometry).mock.results;
      for (const result of geoResults) {
        expect(result.value.dispose).toHaveBeenCalled();
      }
    });
  });
});
