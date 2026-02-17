/**
 * ECS system pipeline.
 *
 * All systems execute in fixed order on the main thread.
 * The Engine calls `runPipeline(world, delta)` once per frame.
 * This is the SOLE update path — no GameSystem loop exists.
 *
 * Systems that run at reduced frequency use internal accumulators.
 * PostProcessingRenderSystem MUST be last (it produces the final frame).
 */

import type { World } from 'bitecs';

import { cameraInputSystem } from './systems/cameraInputSystem';
import { cameraMovementSystem } from './systems/cameraMovementSystem';
import { viewportSystem } from './systems/viewportSystem';
import { chunkLODSystem } from './systems/chunkLODSystem';
import { chunkLoadSystem } from './systems/chunkLoadSystem';
import { chunkMeshSystem } from './systems/chunkMeshSystem';
import { chunkUnloadSystem } from './systems/chunkUnloadSystem';
import { cityLODSystem } from './systems/cityLODSystem';
import { cityMeshSystem } from './systems/cityMeshSystem';
import { agentSyncSystem } from './systems/agentSyncSystem';
import { agentInterpolationSystem } from './systems/agentInterpolationSystem';
import { agentRenderSystem } from './systems/agentRenderSystem';
import { treeRenderSystem } from './systems/treeRenderSystem';
import { waterRenderSystem } from './systems/waterRenderSystem';
import { roadRenderSystem } from './systems/roadRenderSystem';
import { particleRenderSystem } from './systems/particleRenderSystem';
import { resourceStateSystem } from './systems/resourceStateSystem';
import { visibilitySystem } from './systems/visibilitySystem';
import { labelSystem } from './systems/labelSystem';
import { provinceOverlaySystem } from './systems/provinceOverlaySystem';
import { serverReconcileSystem } from './systems/serverReconcileSystem';
import { cleanupSystem } from './systems/cleanupSystem';
import { hudSystem } from './systems/hudSystem';
import { postProcessingRenderSystem } from './systems/postProcessingRenderSystem';

type ECSSystem = (world: World, delta: number) => void;

/**
 * Ordered system list. Index = execution priority.
 * See ECS.md Section 5 for the core execution order.
 *
 * Systems 1-13:  Input, viewport, chunk lifecycle, city/agent/tree render
 * Systems 14-16: Water, road, particle render
 * System  17:    Resource state machine
 * Systems 18-21: Visibility, labels, province overlay
 * Systems 22-23: Server reconcile, cleanup
 * System  24:    HUD (DOM)
 * System  25:    Post-processing render (MUST BE LAST — produces final frame)
 */
const systems: ECSSystem[] = [
  /*  1 */ cameraInputSystem,
  /*  2 */ cameraMovementSystem,
  /*  3 */ viewportSystem,
  /*  4 */ chunkLODSystem,
  /*  5 */ chunkLoadSystem,
  /*  6 */ chunkMeshSystem,
  /*  7 */ chunkUnloadSystem,
  /*  8 */ cityLODSystem,
  /*  9 */ cityMeshSystem,
  /* 10 */ agentSyncSystem,
  /* 11 */ agentInterpolationSystem,
  /* 12 */ agentRenderSystem,
  /* 13 */ treeRenderSystem,
  /* 14 */ waterRenderSystem,
  /* 15 */ roadRenderSystem,
  /* 16 */ particleRenderSystem,
  /* 17 */ resourceStateSystem,
  /* 18 */ visibilitySystem,
  /* 19 */ labelSystem,
  /* 20 */ provinceOverlaySystem,
  /* 21 */ serverReconcileSystem,
  /* 22 */ cleanupSystem,
  /* 23 */ hudSystem,
  /* 24 */ postProcessingRenderSystem,
];

/**
 * Run all ECS systems in order.
 * Called once per frame by the Engine's render loop.
 */
export function runPipeline(world: World, delta: number): void {
  for (let i = 0; i < systems.length; i++) {
    systems[i]!(world, delta);
  }
}
