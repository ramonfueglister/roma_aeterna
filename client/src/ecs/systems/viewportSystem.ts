/**
 * System #3: ViewportSystem
 *
 * Reads the ECS camera entity's Position to compute the visible
 * chunk rectangle. Stores the result in a module-level singleton
 * that other systems (chunkLoad, visibility, labels) can read.
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';
import { query } from 'bitecs';
import { IsCamera, Position } from '../components';
import { CHUNK_SIZE, MAP_SIZE } from '../../config';
import type { ViewportRect } from '../../types';

const GRID_CHUNKS = MAP_SIZE / CHUNK_SIZE;
const HALF_MAP = MAP_SIZE / 2;

/** Current visible chunk rect, updated every frame. */
let currentViewport: ViewportRect = { minCx: 0, maxCx: 0, minCy: 0, maxCy: 0 };

/** Camera height, updated every frame. */
let cameraHeight = 0;
/** Camera world X, updated every frame. */
let cameraWorldX = 0;
/** Camera world Z, updated every frame. */
let cameraWorldZ = 0;

export function getViewport(): Readonly<ViewportRect> {
  return currentViewport;
}

export function getCameraHeight(): number {
  return cameraHeight;
}

export function getCameraWorldX(): number {
  return cameraWorldX;
}

export function getCameraWorldZ(): number {
  return cameraWorldZ;
}

export function viewportSystem(world: World, _delta: number): void {
  const eids = query(world, [IsCamera]);
  if (eids.length === 0) return;

  const eid = eids[0]!;
  const camX = Position.x[eid]!;
  const camY = Position.y[eid]!;
  const camZ = Position.z[eid]!;

  cameraHeight = camY;
  cameraWorldX = camX;
  cameraWorldZ = camZ;

  // Convert world-space camera to tile space
  const tileX = camX + HALF_MAP;
  const tileZ = camZ + HALF_MAP;
  const centerCx = Math.floor(tileX / CHUNK_SIZE);
  const centerCy = Math.floor(tileZ / CHUNK_SIZE);

  // Estimate visible range from camera height
  // Higher camera = wider viewport
  const viewRange = Math.max(2, Math.ceil(camY / 100));

  const minCx = Math.max(0, centerCx - viewRange);
  const maxCx = Math.min(GRID_CHUNKS - 1, centerCx + viewRange);
  const minCy = Math.max(0, centerCy - viewRange);
  const maxCy = Math.min(GRID_CHUNKS - 1, centerCy + viewRange);

  currentViewport = { minCx, maxCx, minCy, maxCy };
}
