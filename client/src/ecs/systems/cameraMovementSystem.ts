/**
 * System #2: CameraMovementSystem
 *
 * Currently a no-op pass-through. Camera movement is handled by
 * CameraController + OrbitControls (Three.js native). The ECS camera
 * entity's Position/Rotation are set by cameraInputSystem each frame.
 *
 * This system exists as a placeholder for future ECS-native camera
 * movement (e.g., integrating Velocity components, boundary clamping).
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';

export function cameraMovementSystem(_world: World, _delta: number): void {
  // CameraController handles all movement. ECS camera entity is
  // updated by cameraInputSystem. No additional work needed here.
}
