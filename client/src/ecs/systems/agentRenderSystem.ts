/**
 * System #12: AgentRenderSystem
 *
 * Delegates to AgentRenderer.update() with camera state from the ECS
 * camera entity. The AgentRenderer handles mock agent animation,
 * distance culling, InstancedMesh rebuilds per agent type.
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';
import type { AgentRenderer } from '../../world/agentRenderer';
import { getCameraHeight, getCameraWorldX, getCameraWorldZ } from './viewportSystem';

/** Elapsed time accumulator, updated each frame. */
let elapsed = 0;

/** Set by Engine during init. */
let agentRendererRef: AgentRenderer | null = null;

export function setAgentRendererRef(renderer: AgentRenderer): void {
  agentRendererRef = renderer;
}

export function agentRenderSystem(_world: World, delta: number): void {
  if (!agentRendererRef) return;
  elapsed += delta;
  agentRendererRef.update(getCameraWorldX(), getCameraHeight(), getCameraWorldZ(), elapsed);
}
