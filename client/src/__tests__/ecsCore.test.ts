/**
 * Tests for ECS core modules: serverEntityMap and archetypes.
 *
 * serverEntityMap isolation strategy:
 *   The module uses two module-level Maps (uuidToEid, eidToUuid) that survive
 *   across imports due to Node.js module caching. We use vi.resetModules()
 *   before each test and a dynamic import() inside the test body to obtain a
 *   fresh module instance with empty Maps, giving each test a clean slate
 *   without requiring a public reset API. vi.resetModules() is the correct
 *   approach for Vitest 3.x (vi.isolateModules was removed in that version).
 *
 * archetypes / components isolation strategy:
 *   Component stores are pre-allocated TypedArrays indexed by eid. A fresh
 *   createWorld() per test produces new eids starting from a low number, and
 *   we write explicit assertions against those specific eid slots. Because
 *   archetypes only read/write the eid they are given and entity IDs are
 *   deterministic within a fresh world, tests remain independent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createWorld, addEntity } from 'bitecs';
import type { World } from 'bitecs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load a fresh, unshared instance of serverEntityMap.
 *
 * vi.resetModules() clears the Vite/Vitest module registry. The subsequent
 * dynamic import() re-executes the module, producing new empty Maps.
 * This must be called inside each test (not in a beforeEach that runs once
 * for the whole suite) to guarantee isolation per individual assertion group.
 */
async function freshServerEntityMap() {
  vi.resetModules();
  return import('../ecs/serverEntityMap');
}

// ---------------------------------------------------------------------------
// serverEntityMap
// ---------------------------------------------------------------------------

describe('serverEntityMap', () => {
  describe('getOrCreateEntity', () => {
    it('creates a new entity and applies the archetype when the uuid is unknown', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      const archetypeSpy = vi.fn();
      const eid = map.getOrCreateEntity(world, 'uuid-001', archetypeSpy);

      expect(typeof eid).toBe('number');
      expect(eid).toBeGreaterThanOrEqual(0);
      expect(archetypeSpy).toHaveBeenCalledOnce();
      expect(archetypeSpy).toHaveBeenCalledWith(world, eid);
    });

    it('returns the same eid on repeated calls for the same uuid (idempotent)', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      const archetypeSpy = vi.fn();
      const first = map.getOrCreateEntity(world, 'uuid-002', archetypeSpy);
      const second = map.getOrCreateEntity(world, 'uuid-002', archetypeSpy);

      expect(second).toBe(first);
      // Archetype must only be applied once, not on subsequent lookups
      expect(archetypeSpy).toHaveBeenCalledOnce();
    });

    it('returns different eids for different uuids', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      const noop = vi.fn();
      const eid1 = map.getOrCreateEntity(world, 'uuid-A', noop);
      const eid2 = map.getOrCreateEntity(world, 'uuid-B', noop);

      expect(eid1).not.toBe(eid2);
    });

    it('registers the mapping so subsequent lookups by uuid succeed', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      const eid = map.getOrCreateEntity(world, 'uuid-003', vi.fn());

      expect(map.getEidForUuid('uuid-003')).toBe(eid);
    });

    it('registers the reverse mapping so subsequent lookups by eid succeed', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      const eid = map.getOrCreateEntity(world, 'uuid-004', vi.fn());

      expect(map.getUuidForEid(eid)).toBe('uuid-004');
    });
  });

  // ---------------------------------------------------------------------------

  describe('getEidForUuid', () => {
    it('returns the correct eid for a registered uuid', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      const eid = map.getOrCreateEntity(world, 'uuid-010', vi.fn());

      expect(map.getEidForUuid('uuid-010')).toBe(eid);
    });

    it('returns undefined for an unknown uuid', async () => {
      const map = await freshServerEntityMap();

      expect(map.getEidForUuid('uuid-does-not-exist')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------

  describe('getUuidForEid', () => {
    it('returns the correct uuid for a registered eid', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      const eid = map.getOrCreateEntity(world, 'uuid-020', vi.fn());

      expect(map.getUuidForEid(eid)).toBe('uuid-020');
    });

    it('returns undefined for an eid that was never registered', async () => {
      const map = await freshServerEntityMap();

      // eid 9999 was never registered in this fresh module instance
      expect(map.getUuidForEid(9999)).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------

  describe('hasServerEntity', () => {
    it('returns true for a uuid that has been registered', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      map.getOrCreateEntity(world, 'uuid-030', vi.fn());

      expect(map.hasServerEntity('uuid-030')).toBe(true);
    });

    it('returns false for a uuid that has not been registered', async () => {
      const map = await freshServerEntityMap();

      expect(map.hasServerEntity('uuid-never-seen')).toBe(false);
    });

    it('returns false after the entity has been removed', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      map.getOrCreateEntity(world, 'uuid-031', vi.fn());
      map.removeServerEntity(world, 'uuid-031');

      expect(map.hasServerEntity('uuid-031')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------

  describe('removeServerEntity', () => {
    it('removes the uuid-to-eid mapping', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      map.getOrCreateEntity(world, 'uuid-040', vi.fn());
      map.removeServerEntity(world, 'uuid-040');

      expect(map.getEidForUuid('uuid-040')).toBeUndefined();
    });

    it('removes the eid-to-uuid mapping', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      const eid = map.getOrCreateEntity(world, 'uuid-041', vi.fn());
      map.removeServerEntity(world, 'uuid-041');

      expect(map.getUuidForEid(eid)).toBeUndefined();
    });

    it('decrements the entity count', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      map.getOrCreateEntity(world, 'uuid-042', vi.fn());
      expect(map.serverEntityCount()).toBe(1);

      map.removeServerEntity(world, 'uuid-042');
      expect(map.serverEntityCount()).toBe(0);
    });

    it('is a no-op for a uuid that was never registered', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      // Must not throw
      expect(() => map.removeServerEntity(world, 'uuid-ghost')).not.toThrow();
      expect(map.serverEntityCount()).toBe(0);
    });

    it('only removes the targeted entity, leaving others intact', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      const eidA = map.getOrCreateEntity(world, 'uuid-A1', vi.fn());
      map.getOrCreateEntity(world, 'uuid-B1', vi.fn());

      map.removeServerEntity(world, 'uuid-A1');

      expect(map.getEidForUuid('uuid-A1')).toBeUndefined();
      expect(map.getUuidForEid(eidA)).toBeUndefined();
      // uuid-B1 must remain
      expect(map.hasServerEntity('uuid-B1')).toBe(true);
      expect(map.serverEntityCount()).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------

  describe('removeServerEntityByEid', () => {
    it('removes the uuid-to-eid mapping when removing by eid', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      const eid = map.getOrCreateEntity(world, 'uuid-050', vi.fn());
      map.removeServerEntityByEid(world, eid);

      expect(map.getEidForUuid('uuid-050')).toBeUndefined();
    });

    it('removes the eid-to-uuid mapping when removing by eid', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      const eid = map.getOrCreateEntity(world, 'uuid-051', vi.fn());
      map.removeServerEntityByEid(world, eid);

      expect(map.getUuidForEid(eid)).toBeUndefined();
    });

    it('decrements the entity count', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      const eid = map.getOrCreateEntity(world, 'uuid-052', vi.fn());
      expect(map.serverEntityCount()).toBe(1);

      map.removeServerEntityByEid(world, eid);
      expect(map.serverEntityCount()).toBe(0);
    });

    it('does not throw when removing an eid that was never in the map', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      // eid 9998 never registered in this fresh instance
      expect(() => map.removeServerEntityByEid(world, 9998)).not.toThrow();
    });

    it('only removes the targeted entity by eid, leaving others intact', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      const eidA = map.getOrCreateEntity(world, 'uuid-A2', vi.fn());
      map.getOrCreateEntity(world, 'uuid-B2', vi.fn());

      map.removeServerEntityByEid(world, eidA);

      expect(map.getEidForUuid('uuid-A2')).toBeUndefined();
      expect(map.hasServerEntity('uuid-B2')).toBe(true);
      expect(map.serverEntityCount()).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------

  describe('serverEntityCount', () => {
    it('starts at zero in a fresh module', async () => {
      const map = await freshServerEntityMap();

      expect(map.serverEntityCount()).toBe(0);
    });

    it('increments by one for each distinct uuid registered', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      map.getOrCreateEntity(world, 'uuid-C1', vi.fn());
      expect(map.serverEntityCount()).toBe(1);

      map.getOrCreateEntity(world, 'uuid-C2', vi.fn());
      expect(map.serverEntityCount()).toBe(2);

      map.getOrCreateEntity(world, 'uuid-C3', vi.fn());
      expect(map.serverEntityCount()).toBe(3);
    });

    it('does not increment when the same uuid is registered twice', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      map.getOrCreateEntity(world, 'uuid-D1', vi.fn());
      map.getOrCreateEntity(world, 'uuid-D1', vi.fn()); // second call, same uuid

      expect(map.serverEntityCount()).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------

  describe('forEachServerEntity', () => {
    it('iterates every uuid-eid pair that has been registered', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      const eid1 = map.getOrCreateEntity(world, 'uuid-E1', vi.fn());
      const eid2 = map.getOrCreateEntity(world, 'uuid-E2', vi.fn());
      const eid3 = map.getOrCreateEntity(world, 'uuid-E3', vi.fn());

      const collected: Array<{ uuid: string; eid: number }> = [];
      map.forEachServerEntity((uuid, eid) => collected.push({ uuid, eid }));

      expect(collected).toHaveLength(3);
      expect(collected).toContainEqual({ uuid: 'uuid-E1', eid: eid1 });
      expect(collected).toContainEqual({ uuid: 'uuid-E2', eid: eid2 });
      expect(collected).toContainEqual({ uuid: 'uuid-E3', eid: eid3 });
    });

    it('calls the callback with correct uuid and eid arguments', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      const eid = map.getOrCreateEntity(world, 'uuid-E4', vi.fn());
      const callback = vi.fn();
      map.forEachServerEntity(callback);

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith('uuid-E4', eid);
    });

    it('does not call the callback when no entities are registered', async () => {
      const map = await freshServerEntityMap();

      const callback = vi.fn();
      map.forEachServerEntity(callback);

      expect(callback).not.toHaveBeenCalled();
    });

    it('does not include entities that have been removed', async () => {
      const world = createWorld();
      const map = await freshServerEntityMap();

      map.getOrCreateEntity(world, 'uuid-F1', vi.fn());
      map.getOrCreateEntity(world, 'uuid-F2', vi.fn());
      map.removeServerEntity(world, 'uuid-F1');

      const uuids: string[] = [];
      map.forEachServerEntity((uuid) => uuids.push(uuid));

      expect(uuids).toHaveLength(1);
      expect(uuids).toContain('uuid-F2');
      expect(uuids).not.toContain('uuid-F1');
    });
  });
});

// ---------------------------------------------------------------------------
// archetypes
// ---------------------------------------------------------------------------

import {
  addChunkArchetype, createChunkEntity,
  addCityArchetype, createCityEntity,
  addAgentArchetype, createAgentEntity,
  addCameraArchetype, createCameraEntity,
  addTreeArchetype, createTreeEntity,
  addProvinceArchetype, createProvinceEntity,
  addResourceArchetype, createResourceEntity,
  addWaterArchetype, createWaterEntity,
} from '../ecs/archetypes';

import {
  MeshRef, InstanceRef, Visible,
  Position, Velocity, Rotation,
  TreeVariant,
} from '../ecs/components';

describe('archetypes', () => {
  // Each test gets a private world so eids are deterministic and component
  // slots are freshly owned by the entities created in that test.
  let world: World;

  beforeEach(() => {
    world = createWorld();
  });

  // ── Shared invariants ─────────────────────────────────────────────────────

  describe('eid validity (all archetypes)', () => {
    it('createChunkEntity returns a non-negative integer eid', () => {
      const eid = createChunkEntity(world);
      expect(Number.isInteger(eid)).toBe(true);
      expect(eid).toBeGreaterThanOrEqual(0);
    });

    it('createCityEntity returns a non-negative integer eid', () => {
      const eid = createCityEntity(world);
      expect(Number.isInteger(eid)).toBe(true);
      expect(eid).toBeGreaterThanOrEqual(0);
    });

    it('createAgentEntity returns a non-negative integer eid', () => {
      const eid = createAgentEntity(world);
      expect(Number.isInteger(eid)).toBe(true);
      expect(eid).toBeGreaterThanOrEqual(0);
    });

    it('createCameraEntity returns a non-negative integer eid', () => {
      const eid = createCameraEntity(world);
      expect(Number.isInteger(eid)).toBe(true);
      expect(eid).toBeGreaterThanOrEqual(0);
    });

    it('createTreeEntity returns a non-negative integer eid', () => {
      const eid = createTreeEntity(world);
      expect(Number.isInteger(eid)).toBe(true);
      expect(eid).toBeGreaterThanOrEqual(0);
    });

    it('createProvinceEntity returns a non-negative integer eid', () => {
      const eid = createProvinceEntity(world);
      expect(Number.isInteger(eid)).toBe(true);
      expect(eid).toBeGreaterThanOrEqual(0);
    });

    it('createResourceEntity returns a non-negative integer eid', () => {
      const eid = createResourceEntity(world);
      expect(Number.isInteger(eid)).toBe(true);
      expect(eid).toBeGreaterThanOrEqual(0);
    });

    it('createWaterEntity returns a non-negative integer eid', () => {
      const eid = createWaterEntity(world);
      expect(Number.isInteger(eid)).toBe(true);
      expect(eid).toBeGreaterThanOrEqual(0);
    });

    it('successive create calls in the same world return unique eids', () => {
      const eids = [
        createChunkEntity(world),
        createCityEntity(world),
        createAgentEntity(world),
        createCameraEntity(world),
        createTreeEntity(world),
        createProvinceEntity(world),
        createResourceEntity(world),
        createWaterEntity(world),
      ];
      const uniqueEids = new Set(eids);
      expect(uniqueEids.size).toBe(eids.length);
    });
  });

  // ── Chunk archetype ───────────────────────────────────────────────────────

  describe('chunk archetype', () => {
    it('sets MeshRef.geometryId to -1 as default sentinel', () => {
      const eid = createChunkEntity(world);
      expect(MeshRef.geometryId[eid]).toBe(-1);
    });

    it('sets MeshRef.instanceId to -1 as default sentinel', () => {
      const eid = createChunkEntity(world);
      expect(MeshRef.instanceId[eid]).toBe(-1);
    });

    it('sets Visible.value to 1 (visible by default)', () => {
      const eid = createChunkEntity(world);
      expect(Visible.value[eid]).toBe(1);
    });

    it('addChunkArchetype applies the same defaults to a manually created entity', () => {
      const eid = addEntity(world);
      addChunkArchetype(world, eid);

      expect(MeshRef.geometryId[eid]).toBe(-1);
      expect(MeshRef.instanceId[eid]).toBe(-1);
      expect(Visible.value[eid]).toBe(1);
    });

    it('creates multiple chunk entities with independent MeshRef slots', () => {
      const eid1 = createChunkEntity(world);
      const eid2 = createChunkEntity(world);

      // Override slot 1 and verify slot 2 is unaffected
      MeshRef.geometryId[eid1] = 42;
      expect(MeshRef.geometryId[eid2]).toBe(-1);
    });
  });

  // ── City archetype ────────────────────────────────────────────────────────

  describe('city archetype', () => {
    it('sets MeshRef.geometryId to -1', () => {
      const eid = createCityEntity(world);
      expect(MeshRef.geometryId[eid]).toBe(-1);
    });

    it('sets MeshRef.instanceId to -1', () => {
      const eid = createCityEntity(world);
      expect(MeshRef.instanceId[eid]).toBe(-1);
    });

    it('sets InstanceRef.instanceId to -1', () => {
      const eid = createCityEntity(world);
      expect(InstanceRef.instanceId[eid]).toBe(-1);
    });

    it('sets Visible.value to 1', () => {
      const eid = createCityEntity(world);
      expect(Visible.value[eid]).toBe(1);
    });

    it('addCityArchetype applies the same defaults to a manually created entity', () => {
      const eid = addEntity(world);
      addCityArchetype(world, eid);

      expect(MeshRef.geometryId[eid]).toBe(-1);
      expect(MeshRef.instanceId[eid]).toBe(-1);
      expect(InstanceRef.instanceId[eid]).toBe(-1);
      expect(Visible.value[eid]).toBe(1);
    });
  });

  // ── Agent archetype ───────────────────────────────────────────────────────

  describe('agent archetype', () => {
    it('sets InstanceRef.instanceId to -1', () => {
      const eid = createAgentEntity(world);
      expect(InstanceRef.instanceId[eid]).toBe(-1);
    });

    it('sets Visible.value to 1', () => {
      const eid = createAgentEntity(world);
      expect(Visible.value[eid]).toBe(1);
    });

    it('addAgentArchetype applies the same defaults to a manually created entity', () => {
      const eid = addEntity(world);
      addAgentArchetype(world, eid);

      expect(InstanceRef.instanceId[eid]).toBe(-1);
      expect(Visible.value[eid]).toBe(1);
    });

    it('creates multiple agent entities with independent InstanceRef slots', () => {
      const eid1 = createAgentEntity(world);
      const eid2 = createAgentEntity(world);

      InstanceRef.instanceId[eid1] = 7;
      expect(InstanceRef.instanceId[eid2]).toBe(-1);
    });
  });

  // ── Camera archetype ──────────────────────────────────────────────────────

  describe('camera archetype', () => {
    it('creates a valid entity', () => {
      const eid = createCameraEntity(world);
      expect(eid).toBeGreaterThanOrEqual(0);
    });

    it('addCameraArchetype does not throw', () => {
      const eid = addEntity(world);
      expect(() => addCameraArchetype(world, eid)).not.toThrow();
    });

    it('Position component slot is accessible after creation', () => {
      const eid = createCameraEntity(world);
      // Default TypedArray value is 0 — verify the slot is reachable and numeric
      expect(typeof Position.x[eid]).toBe('number');
      expect(typeof Position.y[eid]).toBe('number');
      expect(typeof Position.z[eid]).toBe('number');
    });

    it('Rotation component slot is accessible after creation', () => {
      const eid = createCameraEntity(world);
      expect(typeof Rotation.yaw[eid]).toBe('number');
      expect(typeof Rotation.pitch[eid]).toBe('number');
    });

    it('Velocity component slot is accessible after creation', () => {
      const eid = createCameraEntity(world);
      expect(typeof Velocity.x[eid]).toBe('number');
      expect(typeof Velocity.y[eid]).toBe('number');
      expect(typeof Velocity.z[eid]).toBe('number');
    });
  });

  // ── Tree archetype ────────────────────────────────────────────────────────

  describe('tree archetype', () => {
    it('sets InstanceRef.instanceId to -1', () => {
      const eid = createTreeEntity(world);
      expect(InstanceRef.instanceId[eid]).toBe(-1);
    });

    it('sets TreeVariant.scale to 1.0', () => {
      const eid = createTreeEntity(world);
      // Float32 representation of 1.0 is exact
      expect(TreeVariant.scale[eid]).toBe(1.0);
    });

    it('sets Visible.value to 1', () => {
      const eid = createTreeEntity(world);
      expect(Visible.value[eid]).toBe(1);
    });

    it('addTreeArchetype applies the same defaults to a manually created entity', () => {
      const eid = addEntity(world);
      addTreeArchetype(world, eid);

      expect(InstanceRef.instanceId[eid]).toBe(-1);
      expect(TreeVariant.scale[eid]).toBe(1.0);
      expect(Visible.value[eid]).toBe(1);
    });
  });

  // ── Province archetype ────────────────────────────────────────────────────

  describe('province archetype', () => {
    it('sets Visible.value to 1', () => {
      const eid = createProvinceEntity(world);
      expect(Visible.value[eid]).toBe(1);
    });

    it('Position component slot is accessible after creation', () => {
      const eid = createProvinceEntity(world);
      expect(typeof Position.x[eid]).toBe('number');
    });

    it('addProvinceArchetype applies the same defaults to a manually created entity', () => {
      const eid = addEntity(world);
      addProvinceArchetype(world, eid);

      expect(Visible.value[eid]).toBe(1);
    });
  });

  // ── Resource archetype ────────────────────────────────────────────────────

  describe('resource archetype', () => {
    it('sets InstanceRef.instanceId to -1', () => {
      const eid = createResourceEntity(world);
      expect(InstanceRef.instanceId[eid]).toBe(-1);
    });

    it('sets Visible.value to 1', () => {
      const eid = createResourceEntity(world);
      expect(Visible.value[eid]).toBe(1);
    });

    it('addResourceArchetype applies the same defaults to a manually created entity', () => {
      const eid = addEntity(world);
      addResourceArchetype(world, eid);

      expect(InstanceRef.instanceId[eid]).toBe(-1);
      expect(Visible.value[eid]).toBe(1);
    });
  });

  // ── Water archetype ───────────────────────────────────────────────────────

  describe('water archetype', () => {
    it('sets MeshRef.geometryId to -1', () => {
      const eid = createWaterEntity(world);
      expect(MeshRef.geometryId[eid]).toBe(-1);
    });

    it('sets MeshRef.instanceId to -1', () => {
      const eid = createWaterEntity(world);
      expect(MeshRef.instanceId[eid]).toBe(-1);
    });

    it('sets Visible.value to 1', () => {
      const eid = createWaterEntity(world);
      expect(Visible.value[eid]).toBe(1);
    });

    it('addWaterArchetype applies the same defaults to a manually created entity', () => {
      const eid = addEntity(world);
      addWaterArchetype(world, eid);

      expect(MeshRef.geometryId[eid]).toBe(-1);
      expect(MeshRef.instanceId[eid]).toBe(-1);
      expect(Visible.value[eid]).toBe(1);
    });
  });

  // ── Cross-archetype uniqueness ────────────────────────────────────────────

  describe('cross-archetype eid uniqueness', () => {
    it('ten entities of the same type all receive distinct eids', () => {
      const eids = Array.from({ length: 10 }, () => createChunkEntity(world));
      const unique = new Set(eids);
      expect(unique.size).toBe(10);
    });

    it('eid slots for distinct entities do not alias one another in MeshRef', () => {
      const chunk = createChunkEntity(world);
      const city = createCityEntity(world);
      const water = createWaterEntity(world);

      MeshRef.geometryId[chunk] = 100;
      MeshRef.geometryId[city] = 200;
      MeshRef.geometryId[water] = 300;

      expect(MeshRef.geometryId[chunk]).toBe(100);
      expect(MeshRef.geometryId[city]).toBe(200);
      expect(MeshRef.geometryId[water]).toBe(300);
    });

    it('eid slots for distinct entities do not alias one another in Visible', () => {
      const agent = createAgentEntity(world);
      const tree = createTreeEntity(world);

      Visible.value[agent] = 0;
      expect(Visible.value[tree]).toBe(1); // tree must retain its default
    });
  });
});
