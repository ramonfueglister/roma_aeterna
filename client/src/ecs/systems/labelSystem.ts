/**
 * System #16: LabelSystem
 *
 * Delegates to TextLabelRenderer.update() with camera state from
 * the ECS camera entity. The TextLabelRenderer handles label pool
 * management, importance sorting, font sizing, and opacity fading.
 *
 * Frequency: every 200ms (throttled)
 */

import type { World } from 'bitecs';
import type { TextLabelRenderer } from '../../world/textLabels';
import { getCameraHeight, getCameraWorldX, getCameraWorldZ } from './viewportSystem';

let _accumulator = 0;

/** Set by Engine during init. */
let labelRendererRef: TextLabelRenderer | null = null;

export function setLabelRendererRef(renderer: TextLabelRenderer): void {
  labelRendererRef = renderer;
}

export function labelSystem(_world: World, delta: number): void {
  _accumulator += delta;
  if (_accumulator < 0.2) return;
  _accumulator -= 0.2;

  if (!labelRendererRef) return;
  labelRendererRef.update(getCameraHeight(), getCameraWorldX(), getCameraWorldZ());
}
