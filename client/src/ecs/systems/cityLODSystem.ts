/**
 * System #8: CityLODSystem
 *
 * Delegates to CityRenderer.update() with camera state from the ECS
 * camera entity. The CityRenderer handles LOD zone switching (strategic/
 * tactical/detail), InstancedMesh rebuilds, and building visibility.
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';
import type { CityRenderer } from '../../world/cityDatabase';
import { getCameraHeight, getCameraWorldX, getCameraWorldZ } from './viewportSystem';

/** Set by Engine during init. */
let cityRendererRef: CityRenderer | null = null;

export function setCityRendererRef(renderer: CityRenderer): void {
  cityRendererRef = renderer;
}

export function cityLODSystem(_world: World, _delta: number): void {
  if (!cityRendererRef) return;
  cityRendererRef.update(getCameraHeight(), getCameraWorldX(), getCameraWorldZ());
}
