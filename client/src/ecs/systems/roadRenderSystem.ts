/**
 * System #15: RoadRenderSystem
 *
 * Delegates to RoadRenderer.update() with camera state from the ECS
 * camera entity. The RoadRenderer handles distance-based visibility
 * for land roads and sea routes.
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';
import type { RoadRenderer } from '../../world/roadRenderer';
import { getCameraHeight, getCameraWorldX, getCameraWorldZ } from './viewportSystem';

let roadRendererRef: RoadRenderer | null = null;

export function setRoadRendererRef(renderer: RoadRenderer): void {
  roadRendererRef = renderer;
}

export function roadRenderSystem(_world: World, _delta: number): void {
  if (!roadRendererRef) return;
  roadRendererRef.update(getCameraHeight(), getCameraWorldX(), getCameraWorldZ());
}
