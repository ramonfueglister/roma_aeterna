/**
 * System #10: AgentSyncSystem
 *
 * Polls `agents_near_tile` RPC every 2 seconds, creates/updates/despawns
 * agent entities based on server data.
 *
 * Frequency: every 2s
 */

import type { World } from 'bitecs';

let _accumulator = 0;

export function agentSyncSystem(_world: World, delta: number): void {
  _accumulator += delta;
  if (_accumulator < 2.0) return;
  _accumulator -= 2.0;

  // Stub: will call supabase.rpc('agents_near_tile', {...}),
  // getOrCreateEntity for each row, update AgentMovement/AgentRole/ServerSync.
  // Implementation in Phase 2 (data layer).
}
