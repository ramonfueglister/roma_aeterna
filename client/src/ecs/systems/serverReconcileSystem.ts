/**
 * System #18: ServerReconcileSystem
 *
 * Checks for stale entities (missedPolls >= 3), marks them for removal
 * by adding the PendingRemoval tag. CleanupSystem processes actual disposal.
 *
 * Grace period of 3 polls (6 seconds at 2s agent poll interval) prevents
 * flicker when entities briefly leave and re-enter the viewport boundary.
 *
 * Frequency: every 5s
 */

import type { World } from 'bitecs';
import { query, addComponent } from 'bitecs';
import { ServerSync, PendingRemoval } from '../components';

/** Missed-poll threshold before marking entity for removal. */
const STALE_THRESHOLD = 3;

let _accumulator = 0;

export function serverReconcileSystem(world: World, delta: number): void {
  _accumulator += delta;
  if (_accumulator < 5.0) return;
  _accumulator -= 5.0;

  const eids = query(world, [ServerSync]);
  for (let i = 0; i < eids.length; i++) {
    const eid = eids[i]!;
    if (ServerSync.missedPolls[eid]! >= STALE_THRESHOLD) {
      addComponent(world, eid, PendingRemoval);
    }
  }
}
