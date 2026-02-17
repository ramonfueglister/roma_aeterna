/**
 * System #10: AgentSyncSystem
 *
 * Polls Supabase `agents_near_tile` RPC every 2 seconds, creates/updates/despawns
 * agent entities based on server data.
 *
 * For each returned agent row:
 *   - getOrCreateEntity(world, uuid, addAgentArchetype)
 *   - Shift positions: current → prevX/prevZ, server data → nextX/nextZ
 *   - Reset interpT = 0 for interpolation restart
 *   - Update AgentRole (type, role, state) and ServerSync.lastTick
 *   - Reset missedPolls = 0
 *
 * For agents NOT in this poll's results: ServerSync.missedPolls++
 * After 3 missed polls (6s), serverReconcileSystem marks for removal.
 *
 * Blocked by: Supabase connection (task w8bkt)
 *
 * Frequency: every 2s
 */

import type { World } from 'bitecs';
import { query } from 'bitecs';
import { IsAgent, ServerSync } from '../components';

let _accumulator = 0;

export function agentSyncSystem(world: World, delta: number): void {
  _accumulator += delta;
  if (_accumulator < 2.0) return;
  _accumulator -= 2.0;

  // Increment missedPolls for all existing agents (server poll would reset relevant ones)
  const eids = query(world, [IsAgent, ServerSync]);
  for (let i = 0; i < eids.length; i++) {
    const eid = eids[i]!;
    ServerSync.missedPolls[eid] = (ServerSync.missedPolls[eid] ?? 0) + 1;
  }

  // TODO(w8bkt): When Supabase is connected:
  // 1. Call supabase.rpc('agents_near_tile', { center_x, center_y, radius })
  // 2. For each row: getOrCreateEntity → update AgentMovement/AgentRole/ServerSync
  // 3. Reset missedPolls = 0 for returned agents
}
