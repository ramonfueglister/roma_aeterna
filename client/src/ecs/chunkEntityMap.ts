/**
 * Bidirectional map between chunk grid coordinates and ECS entity IDs.
 *
 * Used by chunk ECS systems to look up entities by (cx, cy) and
 * to clean up mappings when entities are removed.
 */

import type { World } from 'bitecs';
import { removeEntity } from 'bitecs';
import { makeChunkKey, type ChunkKey } from '../types';

const chunkToEid = new Map<ChunkKey, number>();
const eidToChunk = new Map<number, ChunkKey>();

/** Get the ECS entity for a chunk, or undefined if none exists. */
export function getChunkEid(cx: number, cy: number): number | undefined {
  return chunkToEid.get(makeChunkKey(cx, cy));
}

/** Register a chunk entity mapping. */
export function setChunkEid(cx: number, cy: number, eid: number): void {
  const key = makeChunkKey(cx, cy);
  chunkToEid.set(key, eid);
  eidToChunk.set(eid, key);
}

/** Check if a chunk entity exists for the given coordinates. */
export function hasChunkEntity(cx: number, cy: number): boolean {
  return chunkToEid.has(makeChunkKey(cx, cy));
}

/**
 * Remove a chunk entity from the map and the ECS world.
 * Returns true if the entity existed and was removed.
 */
export function removeChunkEntity(world: World, cx: number, cy: number): boolean {
  const key = makeChunkKey(cx, cy);
  const eid = chunkToEid.get(key);
  if (eid === undefined) return false;

  chunkToEid.delete(key);
  eidToChunk.delete(eid);
  removeEntity(world, eid);
  return true;
}

/**
 * Remove a chunk entity by its EID.
 * Returns true if the entity existed and was removed.
 */
export function removeChunkEntityByEid(world: World, eid: number): boolean {
  const key = eidToChunk.get(eid);
  if (key === undefined) return false;

  chunkToEid.delete(key);
  eidToChunk.delete(eid);
  removeEntity(world, eid);
  return true;
}

/** Clear all chunk entity mappings. */
export function clearChunkEntityMap(): void {
  chunkToEid.clear();
  eidToChunk.clear();
}

/** Number of tracked chunk entities. */
export function chunkEntityCount(): number {
  return chunkToEid.size;
}
