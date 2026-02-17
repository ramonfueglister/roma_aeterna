/**
 * UUID-to-EID bidirectional map for server entity synchronization.
 *
 * Server entities (cities, agents, resources) have UUID primary keys.
 * ECS entities have numeric EIDs. This map bridges the two.
 */

import type { World } from 'bitecs';
import { addEntity, removeEntity } from 'bitecs';

const uuidToEid = new Map<string, number>();
const eidToUuid = new Map<number, string>();

/**
 * Get or create an ECS entity for a server UUID.
 *
 * If the UUID already has an EID, return it.
 * Otherwise, create a new entity, apply the archetype, and register the mapping.
 */
export function getOrCreateEntity(
  world: World,
  uuid: string,
  archetype: (w: World, eid: number) => void,
): number {
  let eid = uuidToEid.get(uuid);
  if (eid === undefined) {
    eid = addEntity(world);
    archetype(world, eid);
    uuidToEid.set(uuid, eid);
    eidToUuid.set(eid, uuid);
  }
  return eid;
}

/** Look up the EID for a server UUID. Returns undefined if not mapped. */
export function getEidForUuid(uuid: string): number | undefined {
  return uuidToEid.get(uuid);
}

/** Look up the server UUID for an EID. Returns undefined if not mapped. */
export function getUuidForEid(eid: number): string | undefined {
  return eidToUuid.get(eid);
}

/** Remove a server entity: delete ECS entity and clean up both maps. */
export function removeServerEntity(world: World, uuid: string): void {
  const eid = uuidToEid.get(uuid);
  if (eid !== undefined) {
    removeEntity(world, eid);
    uuidToEid.delete(uuid);
    eidToUuid.delete(eid);
  }
}

/** Remove by EID (used by CleanupSystem when it only has the eid). */
export function removeServerEntityByEid(world: World, eid: number): void {
  const uuid = eidToUuid.get(eid);
  if (uuid !== undefined) {
    uuidToEid.delete(uuid);
  }
  eidToUuid.delete(eid);
  removeEntity(world, eid);
}

/** Check if a UUID is already tracked. */
export function hasServerEntity(uuid: string): boolean {
  return uuidToEid.has(uuid);
}

/** Number of tracked server entities. */
export function serverEntityCount(): number {
  return uuidToEid.size;
}

/** Iterate all tracked UUID-EID pairs (for reconciliation). */
export function forEachServerEntity(fn: (uuid: string, eid: number) => void): void {
  uuidToEid.forEach((eid, uuid) => fn(uuid, eid));
}
