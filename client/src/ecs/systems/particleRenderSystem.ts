/**
 * System #16: ParticleRenderSystem
 *
 * Delegates to ParticleSystem.update() with camera state from the ECS
 * camera entity. The ParticleSystem handles GPU particle animation
 * via TSL for dust, embers, and mist effects.
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';
import type { ParticleSystem } from '../../world/particleSystem';
import { getCameraWorldX, getCameraHeight, getCameraWorldZ } from './viewportSystem';

let particleSystemRef: ParticleSystem | null = null;
let elapsed = 0;

export function setParticleSystemRef(system: ParticleSystem): void {
  particleSystemRef = system;
}

export function particleRenderSystem(_world: World, delta: number): void {
  if (!particleSystemRef) return;
  elapsed += delta;
  particleSystemRef.update(getCameraWorldX(), getCameraHeight(), getCameraWorldZ(), elapsed);
}
