/**
 * System #24: PostProcessingRenderSystem
 *
 * MUST be the last system in the pipeline. Calls PostProcessingPipeline.render()
 * which produces the final rendered frame via TSL node composition.
 *
 * Updates camera height uniform for parchment overlay and tilt-shift DOF.
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';
import type { PostProcessingPipeline } from '../../rendering/postProcessing';
import { getCameraHeight } from './viewportSystem';

let postProcessingRef: PostProcessingPipeline | null = null;

export function setPostProcessingRef(pipeline: PostProcessingPipeline): void {
  postProcessingRef = pipeline;
}

export function postProcessingRenderSystem(_world: World, _delta: number): void {
  if (!postProcessingRef) return;
  postProcessingRef.updateCameraHeight(getCameraHeight());
  postProcessingRef.render();
}
