/**
 * System #13: TreeRenderSystem
 *
 * Delegates to TreeRenderer.update() with camera state from the ECS
 * camera entity. The TreeRenderer handles distance culling, instance
 * cap, per-variant InstancedMesh rebuilds, and scale variation.
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';
import type { TreeRenderer } from '../../world/treeRenderer';
import { getCameraHeight, getCameraWorldX, getCameraWorldZ } from './viewportSystem';

/** Set by Engine during init. */
let treeRendererRef: TreeRenderer | null = null;

export function setTreeRendererRef(renderer: TreeRenderer): void {
  treeRendererRef = renderer;
}

export function treeRenderSystem(_world: World, _delta: number): void {
  if (!treeRendererRef) return;
  treeRendererRef.update(getCameraWorldX(), getCameraHeight(), getCameraWorldZ());
}
