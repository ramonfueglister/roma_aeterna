/**
 * System #14: ResourceStateSystem
 *
 * Advances harvest state machine timers for visible resource sites.
 * Transitions: idle → work → haul → recover → idle.
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';
import { query } from 'bitecs';
import { IsResource, ResourceSite, Visible } from '../components';
import { HarvestState } from '../enums';

/** Duration ranges (seconds) for each harvest state. */
const STATE_DURATIONS: Record<number, [number, number]> = {
  [HarvestState.IDLE]: [6, 15],
  [HarvestState.WORK]: [10, 25],
  [HarvestState.HAUL]: [5, 12],
  [HarvestState.RECOVER]: [4, 10],
};

/** Deterministic next state. */
const NEXT_STATE: Record<number, number> = {
  [HarvestState.IDLE]: HarvestState.WORK,
  [HarvestState.WORK]: HarvestState.HAUL,
  [HarvestState.HAUL]: HarvestState.RECOVER,
  [HarvestState.RECOVER]: HarvestState.IDLE,
};

export function resourceStateSystem(world: World, delta: number): void {
  const eids = query(world, [IsResource, ResourceSite, Visible]);
  for (let i = 0; i < eids.length; i++) {
    const eid = eids[i]!;
    if (Visible.value[eid] === 0) continue;

    ResourceSite.stateTimer[eid] = ResourceSite.stateTimer[eid]! - delta;
    if (ResourceSite.stateTimer[eid]! <= 0) {
      const current = ResourceSite.harvestState[eid]!;
      const next = NEXT_STATE[current] ?? HarvestState.IDLE;
      ResourceSite.harvestState[eid] = next;

      // Deterministic duration based on eid (no Math.random in hot path)
      const range = STATE_DURATIONS[next] ?? [6, 15];
      const seed = (eid * 2654435761) >>> 0; // Knuth multiplicative hash
      const t = (seed % 1000) / 1000;
      ResourceSite.stateTimer[eid] = range[0]! + t * (range[1]! - range[0]!);
    }
  }
}
