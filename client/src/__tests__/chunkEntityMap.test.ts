/**
 * Tests for the chunkEntityMap module.
 *
 * The module maintains two module-level Maps that persist across calls, so
 * every test suite resets state via clearChunkEntityMap() in beforeEach.
 *
 * removeEntity from bitecs is mocked so we can assert it is called with the
 * correct arguments without touching real ECS internals.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock bitecs: spread the real module so createWorld still works, but replace
// removeEntity with a spy so we can observe calls.
vi.mock('bitecs', async () => {
  const actual = await vi.importActual<typeof import('bitecs')>('bitecs');
  return {
    ...actual,
    removeEntity: vi.fn(),
  };
});

import { createWorld } from 'bitecs';
import { removeEntity } from 'bitecs';
import {
  getChunkEid,
  setChunkEid,
  hasChunkEntity,
  removeChunkEntity,
  removeChunkEntityByEid,
  clearChunkEntityMap,
  chunkEntityCount,
} from '../ecs/chunkEntityMap';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convenience alias so tests read clearly. */
const mockRemoveEntity = vi.mocked(removeEntity);

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('chunkEntityMap', () => {
  let world: ReturnType<typeof createWorld>;

  beforeEach(() => {
    // Reset module-level map state and the spy call history before each test.
    clearChunkEntityMap();
    vi.clearAllMocks();
    world = createWorld();
  });

  // ── setChunkEid / getChunkEid ─────────────────────────────────────────────

  describe('setChunkEid / getChunkEid', () => {
    it('retrieves the eid that was set for given coordinates', () => {
      setChunkEid(5, 10, 42);

      expect(getChunkEid(5, 10)).toBe(42);
    });

    it('returns undefined for coordinates that have never been set', () => {
      expect(getChunkEid(0, 0)).toBeUndefined();
    });

    it('returns undefined for coordinates that differ from what was set', () => {
      setChunkEid(1, 2, 99);

      expect(getChunkEid(1, 3)).toBeUndefined();
      expect(getChunkEid(2, 2)).toBeUndefined();
    });

    it('handles coordinate (0, 0) correctly', () => {
      setChunkEid(0, 0, 1);

      expect(getChunkEid(0, 0)).toBe(1);
    });

    it('handles large coordinate values', () => {
      setChunkEid(2047, 2047, 9999);

      expect(getChunkEid(2047, 2047)).toBe(9999);
    });

    it('handles negative coordinate values', () => {
      setChunkEid(-1, -5, 7);

      expect(getChunkEid(-1, -5)).toBe(7);
    });

    it('overwrites an existing mapping when the same coordinates are set again', () => {
      setChunkEid(3, 3, 10);
      setChunkEid(3, 3, 20); // overwrite

      expect(getChunkEid(3, 3)).toBe(20);
    });

    it('updates the forward mapping to the new eid after an overwrite', () => {
      setChunkEid(3, 3, 10);
      setChunkEid(3, 3, 20);

      // The forward lookup must return the newest eid.
      expect(getChunkEid(3, 3)).toBe(20);
    });

    it('leaves a stale reverse entry for the old eid after an overwrite (known limitation)', () => {
      // NOTE: setChunkEid does not purge the previous eid from the eidToChunk
      // reverse map.  After overwriting eid 10 with eid 20 at (3,3), eid 10
      // still has a dangling eidToChunk entry pointing at "3,3".
      // This test documents the current behavior so any future fix is visible
      // as a deliberate change rather than an accidental regression.
      setChunkEid(3, 3, 10);
      setChunkEid(3, 3, 20);

      // Stale entry: eid 10 still resolves in the reverse map.
      expect(removeChunkEntityByEid(world, 10)).toBe(true);
    });
  });

  // ── hasChunkEntity ────────────────────────────────────────────────────────

  describe('hasChunkEntity', () => {
    it('returns true after a mapping has been registered', () => {
      setChunkEid(1, 1, 5);

      expect(hasChunkEntity(1, 1)).toBe(true);
    });

    it('returns false for coordinates that have never been set', () => {
      expect(hasChunkEntity(0, 0)).toBe(false);
    });

    it('returns false after the mapping has been removed', () => {
      setChunkEid(2, 2, 8);
      removeChunkEntity(world, 2, 2);

      expect(hasChunkEntity(2, 2)).toBe(false);
    });

    it('returns false after the mapping has been removed by eid', () => {
      setChunkEid(4, 4, 15);
      removeChunkEntityByEid(world, 15);

      expect(hasChunkEntity(4, 4)).toBe(false);
    });

    it('returns false after clearChunkEntityMap', () => {
      setChunkEid(6, 6, 30);
      clearChunkEntityMap();

      expect(hasChunkEntity(6, 6)).toBe(false);
    });
  });

  // ── removeChunkEntity ─────────────────────────────────────────────────────

  describe('removeChunkEntity', () => {
    it('returns true when the chunk entity exists and is removed', () => {
      setChunkEid(5, 5, 100);

      expect(removeChunkEntity(world, 5, 5)).toBe(true);
    });

    it('returns false when no entity exists for the given coordinates', () => {
      expect(removeChunkEntity(world, 9, 9)).toBe(false);
    });

    it('calls removeEntity with the correct world and eid', () => {
      setChunkEid(7, 8, 55);
      removeChunkEntity(world, 7, 8);

      expect(mockRemoveEntity).toHaveBeenCalledTimes(1);
      expect(mockRemoveEntity).toHaveBeenCalledWith(world, 55);
    });

    it('does not call removeEntity when the chunk does not exist', () => {
      removeChunkEntity(world, 0, 0);

      expect(mockRemoveEntity).not.toHaveBeenCalled();
    });

    it('removes the chunk→eid forward mapping so getChunkEid returns undefined', () => {
      setChunkEid(10, 10, 77);
      removeChunkEntity(world, 10, 10);

      expect(getChunkEid(10, 10)).toBeUndefined();
    });

    it('removes the eid→chunk reverse mapping so a subsequent removeByEid returns false', () => {
      setChunkEid(11, 11, 88);
      removeChunkEntity(world, 11, 11);

      expect(removeChunkEntityByEid(world, 88)).toBe(false);
    });

    it('decrements chunkEntityCount by 1', () => {
      setChunkEid(12, 12, 200);
      expect(chunkEntityCount()).toBe(1);

      removeChunkEntity(world, 12, 12);

      expect(chunkEntityCount()).toBe(0);
    });
  });

  // ── removeChunkEntityByEid ────────────────────────────────────────────────

  describe('removeChunkEntityByEid', () => {
    it('returns true when an entity with the given eid exists and is removed', () => {
      setChunkEid(1, 2, 300);

      expect(removeChunkEntityByEid(world, 300)).toBe(true);
    });

    it('returns false when no entity with the given eid exists', () => {
      expect(removeChunkEntityByEid(world, 9999)).toBe(false);
    });

    it('calls removeEntity with the correct world and eid', () => {
      setChunkEid(3, 4, 400);
      removeChunkEntityByEid(world, 400);

      expect(mockRemoveEntity).toHaveBeenCalledTimes(1);
      expect(mockRemoveEntity).toHaveBeenCalledWith(world, 400);
    });

    it('does not call removeEntity when eid is not tracked', () => {
      removeChunkEntityByEid(world, 1234);

      expect(mockRemoveEntity).not.toHaveBeenCalled();
    });

    it('removes the chunk→eid forward mapping so hasChunkEntity returns false', () => {
      setChunkEid(5, 6, 500);
      removeChunkEntityByEid(world, 500);

      expect(hasChunkEntity(5, 6)).toBe(false);
    });

    it('removes the chunk→eid forward mapping so getChunkEid returns undefined', () => {
      setChunkEid(7, 8, 600);
      removeChunkEntityByEid(world, 600);

      expect(getChunkEid(7, 8)).toBeUndefined();
    });

    it('decrements chunkEntityCount by 1', () => {
      setChunkEid(9, 10, 700);
      removeChunkEntityByEid(world, 700);

      expect(chunkEntityCount()).toBe(0);
    });
  });

  // ── clearChunkEntityMap ───────────────────────────────────────────────────

  describe('clearChunkEntityMap', () => {
    it('reduces chunkEntityCount to zero', () => {
      setChunkEid(0, 0, 1);
      setChunkEid(1, 1, 2);
      setChunkEid(2, 2, 3);
      clearChunkEntityMap();

      expect(chunkEntityCount()).toBe(0);
    });

    it('makes all previously registered chunks invisible to getChunkEid', () => {
      setChunkEid(0, 0, 10);
      setChunkEid(1, 1, 11);
      clearChunkEntityMap();

      expect(getChunkEid(0, 0)).toBeUndefined();
      expect(getChunkEid(1, 1)).toBeUndefined();
    });

    it('makes all previously registered chunks invisible to hasChunkEntity', () => {
      setChunkEid(3, 3, 20);
      clearChunkEntityMap();

      expect(hasChunkEntity(3, 3)).toBe(false);
    });

    it('invalidates reverse eid→chunk lookup so removeByEid returns false', () => {
      setChunkEid(4, 4, 30);
      clearChunkEntityMap();

      expect(removeChunkEntityByEid(world, 30)).toBe(false);
    });

    it('does not call removeEntity on any entity', () => {
      setChunkEid(5, 5, 40);
      clearChunkEntityMap();

      expect(mockRemoveEntity).not.toHaveBeenCalled();
    });

    it('is safe to call on an already-empty map', () => {
      expect(() => clearChunkEntityMap()).not.toThrow();
    });

    it('is idempotent when called multiple times', () => {
      setChunkEid(6, 6, 50);
      clearChunkEntityMap();
      clearChunkEntityMap();

      expect(chunkEntityCount()).toBe(0);
    });
  });

  // ── chunkEntityCount ──────────────────────────────────────────────────────

  describe('chunkEntityCount', () => {
    it('returns 0 on a freshly cleared map', () => {
      expect(chunkEntityCount()).toBe(0);
    });

    it('returns 1 after a single entry is added', () => {
      setChunkEid(0, 0, 1);

      expect(chunkEntityCount()).toBe(1);
    });

    it('increments by 1 for each unique coordinate pair added', () => {
      setChunkEid(0, 0, 1);
      setChunkEid(1, 0, 2);
      setChunkEid(0, 1, 3);

      expect(chunkEntityCount()).toBe(3);
    });

    it('does not increment when the same coordinates are set a second time', () => {
      setChunkEid(0, 0, 1);
      setChunkEid(0, 0, 2); // overwrite, not a new entry

      expect(chunkEntityCount()).toBe(1);
    });

    it('decrements after removeChunkEntity', () => {
      setChunkEid(0, 0, 1);
      setChunkEid(1, 1, 2);
      removeChunkEntity(world, 0, 0);

      expect(chunkEntityCount()).toBe(1);
    });

    it('decrements after removeChunkEntityByEid', () => {
      setChunkEid(0, 0, 1);
      setChunkEid(1, 1, 2);
      removeChunkEntityByEid(world, 1);

      expect(chunkEntityCount()).toBe(1);
    });

    it('returns 0 after all entries are individually removed', () => {
      setChunkEid(0, 0, 1);
      setChunkEid(1, 1, 2);
      removeChunkEntity(world, 0, 0);
      removeChunkEntity(world, 1, 1);

      expect(chunkEntityCount()).toBe(0);
    });
  });

  // ── Multiple independent entries ──────────────────────────────────────────

  describe('multiple independent entries', () => {
    it('tracks several chunks without cross-contamination', () => {
      setChunkEid(0, 0, 10);
      setChunkEid(1, 0, 11);
      setChunkEid(0, 1, 12);
      setChunkEid(1, 1, 13);

      expect(getChunkEid(0, 0)).toBe(10);
      expect(getChunkEid(1, 0)).toBe(11);
      expect(getChunkEid(0, 1)).toBe(12);
      expect(getChunkEid(1, 1)).toBe(13);
    });

    it('removing one entry does not affect the others', () => {
      setChunkEid(0, 0, 10);
      setChunkEid(1, 0, 11);
      setChunkEid(0, 1, 12);

      removeChunkEntity(world, 1, 0);

      expect(getChunkEid(0, 0)).toBe(10);
      expect(getChunkEid(1, 0)).toBeUndefined();
      expect(getChunkEid(0, 1)).toBe(12);
      expect(chunkEntityCount()).toBe(2);
    });

    it('removing by eid does not affect other entries', () => {
      setChunkEid(2, 2, 20);
      setChunkEid(3, 3, 21);

      removeChunkEntityByEid(world, 20);

      expect(getChunkEid(3, 3)).toBe(21);
      expect(hasChunkEntity(3, 3)).toBe(true);
    });

    it('each entry has an independent eid', () => {
      setChunkEid(0, 0, 100);
      setChunkEid(1, 1, 101);

      expect(getChunkEid(0, 0)).not.toBe(getChunkEid(1, 1));
    });

    it('calls removeEntity once per removeChunkEntity call in a multi-entry scenario', () => {
      setChunkEid(0, 0, 50);
      setChunkEid(1, 1, 51);

      removeChunkEntity(world, 0, 0);
      removeChunkEntity(world, 1, 1);

      expect(mockRemoveEntity).toHaveBeenCalledTimes(2);
      expect(mockRemoveEntity).toHaveBeenNthCalledWith(1, world, 50);
      expect(mockRemoveEntity).toHaveBeenNthCalledWith(2, world, 51);
    });
  });

  // ── makeChunkKey uniqueness (coordinate boundary checks) ──────────────────

  describe('coordinate key uniqueness', () => {
    it('distinguishes (cx=1, cy=23) from (cx=12, cy=3)', () => {
      // Both would produce different keys: "1,23" vs "12,3"
      setChunkEid(1, 23, 500);
      setChunkEid(12, 3, 501);

      expect(getChunkEid(1, 23)).toBe(500);
      expect(getChunkEid(12, 3)).toBe(501);
    });

    it('distinguishes (cx=0, cy=10) from (cx=1, cy=0)', () => {
      setChunkEid(0, 10, 600);
      setChunkEid(1, 0, 601);

      expect(getChunkEid(0, 10)).toBe(600);
      expect(getChunkEid(1, 0)).toBe(601);
    });
  });
});
