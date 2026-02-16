/**
 * Math utilities for coordinate conversions and interpolation.
 * Zero allocations - all functions return primitives or mutate provided targets.
 */

import { CHUNK_SIZE, GRID_SIZE, MAP_SIZE } from '../config';

/** Clamp value between min and max inclusive. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Linear interpolation between a and b. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth Hermite interpolation (0-1 range). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Convert world tile coordinate to chunk coordinate. */
export function worldToChunk(tileX: number, tileY: number): { cx: number; cy: number } {
  return {
    cx: clamp(Math.floor(tileX / CHUNK_SIZE), 0, GRID_SIZE - 1),
    cy: clamp(Math.floor(tileY / CHUNK_SIZE), 0, GRID_SIZE - 1),
  };
}

/** Convert chunk coordinate to world tile origin (top-left corner). */
export function chunkToWorld(cx: number, cy: number): { tileX: number; tileY: number } {
  return {
    tileX: cx * CHUNK_SIZE,
    tileY: cy * CHUNK_SIZE,
  };
}

/** Convert tile coordinate to local index within a chunk (0-1023). */
export function tileToIndex(localX: number, localY: number): number {
  return localY * CHUNK_SIZE + localX;
}

/** Convert local index to local tile coordinates within a chunk. */
export function indexToTile(index: number): { x: number; y: number } {
  return {
    x: index % CHUNK_SIZE,
    y: Math.floor(index / CHUNK_SIZE),
  };
}

/** Compute unique string key for a chunk coordinate pair. */
export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** Manhattan distance between two chunk coordinates. */
export function chunkManhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/** Euclidean distance between two points. */
export function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Squared distance (avoid sqrt when only comparing). */
export function distanceSq(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

/** Check if a tile coordinate is within map bounds. */
export function isInBounds(tileX: number, tileY: number): boolean {
  return tileX >= 0 && tileX < MAP_SIZE && tileY >= 0 && tileY < MAP_SIZE;
}

/** Check if a chunk coordinate is within grid bounds. */
export function isChunkInBounds(cx: number, cy: number): boolean {
  return cx >= 0 && cx < GRID_SIZE && cy >= 0 && cy < GRID_SIZE;
}

/**
 * Generate spiral order offsets from center outward.
 * Returns array of [dx, dy] pairs up to given radius.
 */
export function spiralOrder(radius: number): Array<[number, number]> {
  const result: Array<[number, number]> = [[0, 0]];
  for (let r = 1; r <= radius; r++) {
    for (let i = -r; i < r; i++) result.push([i, -r]);   // top
    for (let i = -r; i < r; i++) result.push([r, i]);     // right
    for (let i = r; i > -r; i--) result.push([i, r]);     // bottom
    for (let i = r; i > -r; i--) result.push([-r, i]);    // left
  }
  return result;
}
