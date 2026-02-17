/**
 * System #14: WaterRenderSystem
 *
 * Delegates to WaterRenderer.update() with elapsed time and camera
 * position from the ECS camera entity.
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';
import * as THREE from 'three';
import type { WaterRenderer } from '../../world/waterRenderer';
import { getCameraWorldX, getCameraHeight, getCameraWorldZ } from './viewportSystem';

let waterRendererRef: WaterRenderer | null = null;
let elapsed = 0;

/** Reusable Vector3 to avoid per-frame allocations. */
const _camPos = new THREE.Vector3();

export function setWaterRendererRef(renderer: WaterRenderer): void {
  waterRendererRef = renderer;
}

export function waterRenderSystem(_world: World, delta: number): void {
  if (!waterRendererRef) return;
  elapsed += delta;
  _camPos.set(getCameraWorldX(), getCameraHeight(), getCameraWorldZ());
  waterRendererRef.update(elapsed, _camPos);
}
