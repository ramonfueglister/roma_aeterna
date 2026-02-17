/**
 * System #11: AgentInterpolationSystem
 *
 * Interpolates agent positions between prev/next server positions.
 * Updates heading from movement direction.
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';
import { query } from 'bitecs';
import { IsAgent, Position, AgentMovement, Rotation } from '../components';

export function agentInterpolationSystem(world: World, delta: number): void {
  const eids = query(world, [IsAgent, Position, AgentMovement, Rotation]);
  for (let i = 0; i < eids.length; i++) {
    const eid = eids[i]!;
    const t = AgentMovement.interpT[eid]!;

    // Lerp between previous and next server positions
    Position.x[eid] = AgentMovement.prevX[eid]! + (AgentMovement.nextX[eid]! - AgentMovement.prevX[eid]!) * t;
    Position.y[eid] = AgentMovement.prevY[eid]! + (AgentMovement.nextY[eid]! - AgentMovement.prevY[eid]!) * t;

    // Advance interpolation factor
    AgentMovement.interpT[eid] = Math.min(1.0, t + AgentMovement.speed[eid]! * delta * 0.5);

    // Update heading from movement direction
    const dx = AgentMovement.nextX[eid]! - AgentMovement.prevX[eid]!;
    const dy = AgentMovement.nextY[eid]! - AgentMovement.prevY[eid]!;
    if (dx !== 0 || dy !== 0) {
      Rotation.yaw[eid] = Math.atan2(dy, dx);
    }
  }
}
