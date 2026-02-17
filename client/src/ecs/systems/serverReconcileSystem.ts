/**
 * System #18: ServerReconcileSystem
 *
 * Checks for stale entities (missedPolls >= 3), marks them for removal.
 * Grace period of 3 polls (6 seconds) prevents flicker.
 *
 * Frequency: every 5s
 */

import type { World } from 'bitecs';

let _accumulator = 0;

export function serverReconcileSystem(_world: World, delta: number): void {
  _accumulator += delta;
  if (_accumulator < 5.0) return;
  _accumulator -= 5.0;

  // Stub: will check missedPolls >= 3, mark entities for despawn.
  // CleanupSystem processes the actual removal.
  // Implementation in Phase 2 (data layer).
}
