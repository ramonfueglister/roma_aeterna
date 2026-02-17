/**
 * System #17: ProvinceOverlaySystem
 *
 * Delegates to ProvinceRenderer.update() with camera height from the
 * ECS camera entity. The ProvinceRenderer handles its own shader
 * uniforms, height-band visibility, and border pulse animation.
 *
 * Frequency: every frame (renderer internally throttles texture uploads)
 */

import type { World } from 'bitecs';
import type { ProvinceRenderer } from '../../world/provinceRenderer';
import { getCameraHeight } from './viewportSystem';

/** Elapsed time accumulator. */
let elapsed = 0;

/** Set by Engine during init. */
let provinceRendererRef: ProvinceRenderer | null = null;

export function setProvinceRendererRef(renderer: ProvinceRenderer): void {
  provinceRendererRef = renderer;
}

export function provinceOverlaySystem(_world: World, delta: number): void {
  if (!provinceRendererRef) return;
  elapsed += delta;
  provinceRendererRef.update(getCameraHeight(), elapsed);
}
