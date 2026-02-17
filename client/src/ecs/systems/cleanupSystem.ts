/**
 * System #19: CleanupSystem
 *
 * Removes entities tagged with PendingRemoval. For each:
 *   - Releases InstanceRef slot back to MeshRegistry pool
 *   - Cleans up UUID↔EID mapping (server-synced entities)
 *   - Removes the ECS entity from the world
 *
 * Must run AFTER all systems that may add PendingRemoval tags.
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';
import { query } from 'bitecs';
import { PendingRemoval, InstanceRef } from '../components';
import { releaseInstance } from '../meshRegistry';
import { removeServerEntityByEid } from '../serverEntityMap';

export function cleanupSystem(world: World, _delta: number): void {
  const eids = query(world, [PendingRemoval]);
  for (let i = 0; i < eids.length; i++) {
    const eid = eids[i]!;

    // Recycle InstancedMesh slot if allocated
    const instanceId = InstanceRef.instanceId[eid];
    if (instanceId !== undefined && instanceId >= 0) {
      const poolId = InstanceRef.poolId[eid]!;
      releaseInstance(poolId, instanceId);
      InstanceRef.instanceId[eid] = -1;
    }

    // Remove entity + clean up UUID map
    removeServerEntityByEid(world, eid);
  }
}
