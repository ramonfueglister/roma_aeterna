/**
 * System #11: AgentInterpolationSystem
 *
 * Interpolates agent positions on the XZ plane between prev/next
 * server positions. Y (terrain height) is NOT interpolated here —
 * it is set by agentSyncSystem from the heightmap.
 *
 * Updates heading (yaw) from movement direction on the XZ plane.
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

    // Lerp X (east-west) and Z (north-south) between server positions
    Position.x[eid] = AgentMovement.prevX[eid]! + (AgentMovement.nextX[eid]! - AgentMovement.prevX[eid]!) * t;
    Position.z[eid] = AgentMovement.prevZ[eid]! + (AgentMovement.nextZ[eid]! - AgentMovement.prevZ[eid]!) * t;

    // Advance interpolation factor
    AgentMovement.interpT[eid] = Math.min(1.0, t + AgentMovement.speed[eid]! * delta * 0.5);

    // Update heading from movement direction on XZ plane
    const dx = AgentMovement.nextX[eid]! - AgentMovement.prevX[eid]!;
    const dz = AgentMovement.nextZ[eid]! - AgentMovement.prevZ[eid]!;
    if (dx !== 0 || dz !== 0) {
      Rotation.yaw[eid] = Math.atan2(dz, dx);
    }
  }
}
