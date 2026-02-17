/**
 * System #1: CameraInputSystem
 *
 * Mirrors the Three.js camera state into the ECS camera entity.
 * The CameraController + OrbitControls remain the authority for
 * actual camera manipulation (keyboard, mouse, edge scroll).
 * This system reads the Three.js camera and writes Position/Rotation
 * on the ECS camera entity so other ECS systems can read it.
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';
import { query } from 'bitecs';
import { IsCamera, Position, Rotation } from '../components';

/** Set by Engine during init. */
let threeCamera: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number } } | null = null;

export function setCameraRef(camera: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number } }): void {
  threeCamera = camera;
}

export function cameraInputSystem(world: World, _delta: number): void {
  if (!threeCamera) return;

  const eids = query(world, [IsCamera]);
  for (let i = 0; i < eids.length; i++) {
    const eid = eids[i]!;
    Position.x[eid] = threeCamera.position.x;
    Position.y[eid] = threeCamera.position.y;
    Position.z[eid] = threeCamera.position.z;
    Rotation.yaw[eid] = threeCamera.rotation.y;
    Rotation.pitch[eid] = threeCamera.rotation.x;
  }
}
