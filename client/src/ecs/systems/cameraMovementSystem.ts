/**
 * System #2: CameraMovementSystem
 *
 * Delegates to CameraController.update() which drives OrbitControls,
 * WASD input, edge scrolling, and zoom animation.
 *
 * The CameraController remains the authority for actual camera
 * manipulation. cameraInputSystem (system #1) mirrors the resulting
 * Three.js camera state back into ECS components each frame.
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';
import type { CameraController } from '../../camera/cameraController';

let controllerRef: CameraController | null = null;

export function setControllerRef(controller: CameraController): void {
  controllerRef = controller;
}

export function getControllerRef(): CameraController | null {
  return controllerRef;
}

export function cameraMovementSystem(_world: World, delta: number): void {
  if (!controllerRef) return;
  controllerRef.update(delta);
}
