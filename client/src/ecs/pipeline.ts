/**
 * ECS system pipeline.
 *
 * All 19 systems execute in fixed order on the main thread.
 * The Engine calls `runPipeline(world, delta)` once per frame.
 * Systems that run at reduced frequency use internal accumulators.
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
import { resourceStateSystem } from './systems/resourceStateSystem';
import { visibilitySystem } from './systems/visibilitySystem';
import { labelSystem } from './systems/labelSystem';
import { provinceOverlaySystem } from './systems/provinceOverlaySystem';
import { serverReconcileSystem } from './systems/serverReconcileSystem';
import { cleanupSystem } from './systems/cleanupSystem';

type ECSSystem = (world: World, delta: number) => void;

/**
 * Ordered system list. Index = execution priority.
 * See ECS.md Section 5 for the full execution order table.
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
  /* 14 */ resourceStateSystem,
  /* 15 */ visibilitySystem,
  /* 16 */ labelSystem,
  /* 17 */ provinceOverlaySystem,
  /* 18 */ serverReconcileSystem,
  /* 19 */ cleanupSystem,
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
