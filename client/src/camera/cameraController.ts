/**
 * CameraController: Enhanced camera system for strategic/tactical voxel world navigation.
 *
 * Features:
 * - Dynamic zoom levels with adaptive viewing angles (strategic overhead -> tactical angled)
 * - Keyboard controls (WASD/arrows pan, Q/E rotate, R/F zoom) with smooth acceleration
 * - Optional edge scrolling (mouse near screen edges)
 * - Map boundary enforcement (soft spring-back + hard clamp)
 * - Viewport frustum tracking for chunk visibility
 * - Debounced event emission (camera_moved, viewport_changed)
 * - Camera presets with smooth animation
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  MAP_SIZE,
  CHUNK_SIZE,
  MIN_ZOOM,
  MAX_ZOOM,
  DEFAULT_CAMERA_HEIGHT,
} from '../config';
import { gameEvents } from '../core/eventBus';
import { clamp, lerp } from '../core/math';
import type { ViewportRect } from '../types';

// ── Constants ───────────────────────────────────────────────────────

const EDGE_SCROLL_ZONE = 40;
const BASE_PAN_SPEED = 50;
const BASE_ROTATION_SPEED = Math.PI / 2;
const BASE_ZOOM_SPEED = 200;
const ACCELERATION_TIME = 0.3;
const DECELERATION_TIME = 0.2;
const EVENT_DEBOUNCE_MS = 100;
const BOUNDARY_SPRING_K = 0.15;
const BOUNDARY_HARD_LIMIT = 100;
const STRATEGIC_POLAR_ANGLE = Math.PI * 0.35;
const TACTICAL_POLAR_ANGLE = Math.PI * 0.48;
const STRATEGIC_HEIGHT = 2000;
const TACTICAL_HEIGHT = 500;
const PRESET_ANIMATION_DURATION = 1.5;
const GRID_CHUNKS = MAP_SIZE / CHUNK_SIZE;

// Keyboard zoom-level presets (keys 1-4)
const ZOOM_LEVEL_STRATEGIC = 4000;
const ZOOM_LEVEL_REGIONAL = 2000;
const ZOOM_LEVEL_TACTICAL = 600;
const ZOOM_LEVEL_DETAIL = 150;

// ── Input State ─────────────────────────────────────────────────────

interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
  zoomIn: boolean;
  zoomOut: boolean;
  edgeX: number;
  edgeY: number;
  panVelocity: THREE.Vector2;
  rotateVelocity: number;
  zoomVelocity: number;
}

interface CameraAnimation {
  active: boolean;
  startPosition: THREE.Vector3;
  endPosition: THREE.Vector3;
  startTarget: THREE.Vector3;
  endTarget: THREE.Vector3;
  startTime: number;
  duration: number;
}

// ── CameraController Class ──────────────────────────────────────────

export class CameraController {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly domElement: HTMLElement;

  private readonly input: InputState;
  private edgeScrollEnabled: boolean;

  private readonly lastCameraPosition: THREE.Vector3;
  private lastViewportRect: ViewportRect | null;
  private lastEventTime: number;

  private readonly animation: CameraAnimation;

  private readonly frustum: THREE.Frustum;
  private readonly projScreenMatrix: THREE.Matrix4;

  private readonly boundKeyDown: (e: KeyboardEvent) => void;
  private readonly boundKeyUp: (e: KeyboardEvent) => void;
  private readonly boundMouseMove: (e: MouseEvent) => void;

  // Scratch vectors to avoid per-frame allocations
  private readonly _forward = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _offset = new THREE.Vector3();
  private readonly _testPoint = new THREE.Vector3();

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    _scene: THREE.Scene,
  ) {
    this.camera = camera;
    this.domElement = domElement;

    // Initialize OrbitControls
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = MIN_ZOOM;
    this.controls.maxDistance = MAX_ZOOM;
    this.controls.maxPolarAngle = TACTICAL_POLAR_ANGLE;
    this.controls.enablePan = false; // We handle panning manually
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    this.input = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      rotateLeft: false,
      rotateRight: false,
      zoomIn: false,
      zoomOut: false,
      edgeX: 0,
      edgeY: 0,
      panVelocity: new THREE.Vector2(0, 0),
      rotateVelocity: 0,
      zoomVelocity: 0,
    };

    this.edgeScrollEnabled = true;

    this.lastCameraPosition = camera.position.clone();
    this.lastViewportRect = null;
    this.lastEventTime = 0;

    this.animation = {
      active: false,
      startPosition: new THREE.Vector3(),
      endPosition: new THREE.Vector3(),
      startTarget: new THREE.Vector3(),
      endTarget: new THREE.Vector3(),
      startTime: 0,
      duration: 0,
    };

    this.frustum = new THREE.Frustum();
    this.projScreenMatrix = new THREE.Matrix4();

    this.boundKeyDown = this.onKeyDown.bind(this);
    this.boundKeyUp = this.onKeyUp.bind(this);
    this.boundMouseMove = this.onMouseMove.bind(this);

    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    this.domElement.addEventListener('mousemove', this.boundMouseMove);
  }

  /** Access underlying OrbitControls (for target manipulation). */
  get orbitControls(): OrbitControls {
    return this.controls;
  }

  // ── Public API ────────────────────────────────────────────────────

  update(deltaTime: number): void {
    if (this.animation.active) {
      this.updateAnimation();
    } else {
      this.updateInput(deltaTime);
      this.updatePolarAngleLimits();
    }

    this.controls.update();
    this.enforceBoundaries();
    this.checkAndEmitEvents();
  }

  jumpToCity(worldX: number, worldZ: number, height?: number): void {
    const targetHeight = height ?? DEFAULT_CAMERA_HEIGHT;

    this.animation.active = true;
    this.animation.startPosition.copy(this.camera.position);
    this.animation.endPosition.set(worldX, targetHeight, worldZ);
    this.animation.startTarget.copy(this.controls.target);
    this.animation.endTarget.set(worldX, 0, worldZ);
    this.animation.startTime = performance.now() / 1000;
    this.animation.duration = PRESET_ANIMATION_DURATION;
  }

  setStrategicView(): void {
    const t = this.controls.target;
    this.jumpToCity(t.x, t.z, STRATEGIC_HEIGHT);
  }

  setTacticalView(): void {
    const t = this.controls.target;
    this.jumpToCity(t.x, t.z, TACTICAL_HEIGHT);
  }

  setEdgeScrollEnabled(enabled: boolean): void {
    this.edgeScrollEnabled = enabled;
    if (!enabled) {
      this.input.edgeX = 0;
      this.input.edgeY = 0;
    }
  }

  getViewportRect(): ViewportRect {
    this.updateFrustum();

    const halfMap = MAP_SIZE / 2;
    const testRadius = 20;
    const centerCx = Math.floor((this.controls.target.x + halfMap) / CHUNK_SIZE);
    const centerCy = Math.floor((this.controls.target.z + halfMap) / CHUNK_SIZE);

    let minCx = centerCx;
    let maxCx = centerCx;
    let minCy = centerCy;
    let maxCy = centerCy;

    for (let dx = -testRadius; dx <= testRadius; dx++) {
      for (let dy = -testRadius; dy <= testRadius; dy++) {
        const cx = centerCx + dx;
        const cy = centerCy + dy;

        if (cx < 0 || cy < 0 || cx >= GRID_CHUNKS || cy >= GRID_CHUNKS) {
          continue;
        }

        const worldX = cx * CHUNK_SIZE - halfMap + CHUNK_SIZE / 2;
        const worldZ = cy * CHUNK_SIZE - halfMap + CHUNK_SIZE / 2;
        this._testPoint.set(worldX, 0, worldZ);

        if (this.frustum.containsPoint(this._testPoint)) {
          minCx = Math.min(minCx, cx);
          maxCx = Math.max(maxCx, cx);
          minCy = Math.min(minCy, cy);
          maxCy = Math.max(maxCy, cy);
        }
      }
    }

    // 1-chunk padding
    minCx = Math.max(0, minCx - 1);
    maxCx = Math.min(GRID_CHUNKS - 1, maxCx + 1);
    minCy = Math.max(0, minCy - 1);
    maxCy = Math.min(GRID_CHUNKS - 1, maxCy + 1);

    return { minCx, maxCx, minCy, maxCy };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    this.domElement.removeEventListener('mousemove', this.boundMouseMove);
    this.controls.dispose();
  }

  // ── Private Methods ───────────────────────────────────────────────

  private updateInput(deltaTime: number): void {
    const heightFactor = this.camera.position.y / DEFAULT_CAMERA_HEIGHT;
    const panSpeed = BASE_PAN_SPEED * Math.max(0.5, heightFactor);
    const zoomSpeed = BASE_ZOOM_SPEED * Math.max(0.5, heightFactor);

    // Pan acceleration/deceleration
    const panActive =
      this.input.forward || this.input.backward || this.input.left || this.input.right;
    const edgeActive =
      this.edgeScrollEnabled && (this.input.edgeX !== 0 || this.input.edgeY !== 0);

    if (panActive || edgeActive) {
      const desiredX =
        (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0) + this.input.edgeX;
      const desiredY =
        (this.input.backward ? 1 : 0) - (this.input.forward ? 1 : 0) + this.input.edgeY;
      const accel = deltaTime / ACCELERATION_TIME;
      this.input.panVelocity.x = lerp(this.input.panVelocity.x, desiredX, accel);
      this.input.panVelocity.y = lerp(this.input.panVelocity.y, desiredY, accel);
    } else {
      const decel = deltaTime / DECELERATION_TIME;
      this.input.panVelocity.x = lerp(this.input.panVelocity.x, 0, decel);
      this.input.panVelocity.y = lerp(this.input.panVelocity.y, 0, decel);
    }

    if (this.input.panVelocity.lengthSq() > 0.001) {
      this._forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this._forward.y = 0;
      this._forward.normalize();

      this._right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      this._right.y = 0;
      this._right.normalize();

      this._offset.set(0, 0, 0);
      this._offset.addScaledVector(this._right, this.input.panVelocity.x * panSpeed * deltaTime);
      this._offset.addScaledVector(
        this._forward,
        -this.input.panVelocity.y * panSpeed * deltaTime,
      );

      this.camera.position.add(this._offset);
      this.controls.target.add(this._offset);
    }

    // Rotation
    const rotateActive = this.input.rotateLeft || this.input.rotateRight;
    if (rotateActive) {
      const desiredRotate =
        (this.input.rotateRight ? 1 : 0) - (this.input.rotateLeft ? 1 : 0);
      const accel = deltaTime / ACCELERATION_TIME;
      this.input.rotateVelocity = lerp(this.input.rotateVelocity, desiredRotate, accel);
    } else {
      const decel = deltaTime / DECELERATION_TIME;
      this.input.rotateVelocity = lerp(this.input.rotateVelocity, 0, decel);
    }

    if (Math.abs(this.input.rotateVelocity) > 0.001) {
      const angle = this.input.rotateVelocity * BASE_ROTATION_SPEED * deltaTime;
      this._offset.subVectors(this.camera.position, this.controls.target);
      this._offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      this.camera.position.copy(this.controls.target).add(this._offset);
    }

    // Zoom
    const zoomActive = this.input.zoomIn || this.input.zoomOut;
    if (zoomActive) {
      const desiredZoom = (this.input.zoomIn ? -1 : 0) + (this.input.zoomOut ? 1 : 0);
      const accel = deltaTime / ACCELERATION_TIME;
      this.input.zoomVelocity = lerp(this.input.zoomVelocity, desiredZoom, accel);
    } else {
      const decel = deltaTime / DECELERATION_TIME;
      this.input.zoomVelocity = lerp(this.input.zoomVelocity, 0, decel);
    }

    if (Math.abs(this.input.zoomVelocity) > 0.001) {
      this._offset.subVectors(this.camera.position, this.controls.target);
      const dist = this._offset.length();
      const dir = this._offset.normalize();

      const newDist = clamp(
        dist + this.input.zoomVelocity * zoomSpeed * deltaTime,
        MIN_ZOOM,
        MAX_ZOOM,
      );

      this.camera.position.copy(this.controls.target).addScaledVector(dir, newDist);
    }
  }

  private updatePolarAngleLimits(): void {
    const height = this.camera.position.y;
    let maxPolar: number;
    if (height > STRATEGIC_HEIGHT) {
      maxPolar = STRATEGIC_POLAR_ANGLE;
    } else if (height < TACTICAL_HEIGHT) {
      maxPolar = TACTICAL_POLAR_ANGLE;
    } else {
      const t = (height - TACTICAL_HEIGHT) / (STRATEGIC_HEIGHT - TACTICAL_HEIGHT);
      maxPolar = lerp(TACTICAL_POLAR_ANGLE, STRATEGIC_POLAR_ANGLE, t);
    }
    this.controls.maxPolarAngle = maxPolar;
  }

  private enforceBoundaries(): void {
    const halfMap = MAP_SIZE / 2;
    const target = this.controls.target;
    const cam = this.camera.position;

    const overX = Math.max(0, Math.abs(target.x) - halfMap);
    const overZ = Math.max(0, Math.abs(target.z) - halfMap);

    if (overX > 0 && overX < BOUNDARY_HARD_LIMIT) {
      const springForce = -Math.sign(target.x) * overX * BOUNDARY_SPRING_K;
      target.x += springForce;
      cam.x += springForce;
    }

    if (overZ > 0 && overZ < BOUNDARY_HARD_LIMIT) {
      const springForce = -Math.sign(target.z) * overZ * BOUNDARY_SPRING_K;
      target.z += springForce;
      cam.z += springForce;
    }

    const maxBoundary = halfMap + BOUNDARY_HARD_LIMIT;

    if (Math.abs(target.x) > maxBoundary) {
      const dx = clamp(target.x, -maxBoundary, maxBoundary) - target.x;
      target.x += dx;
      cam.x += dx;
    }

    if (Math.abs(target.z) > maxBoundary) {
      const dz = clamp(target.z, -maxBoundary, maxBoundary) - target.z;
      target.z += dz;
      cam.z += dz;
    }
  }

  private updateAnimation(): void {
    const now = performance.now() / 1000;
    const elapsed = now - this.animation.startTime;
    const t = Math.min(elapsed / this.animation.duration, 1);

    // Ease-in-out cubic
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    this.camera.position.lerpVectors(
      this.animation.startPosition,
      this.animation.endPosition,
      eased,
    );

    this.controls.target.lerpVectors(
      this.animation.startTarget,
      this.animation.endTarget,
      eased,
    );

    if (t >= 1) {
      this.animation.active = false;
    }
  }

  private updateFrustum(): void {
    this.camera.updateMatrixWorld();
    this.projScreenMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);
  }

  private checkAndEmitEvents(): void {
    const now = performance.now();
    if (now - this.lastEventTime < EVENT_DEBOUNCE_MS) {
      return;
    }

    const cameraMoved =
      this.camera.position.distanceToSquared(this.lastCameraPosition) > 0.01;

    if (cameraMoved) {
      this.lastCameraPosition.copy(this.camera.position);
      this.lastEventTime = now;

      gameEvents.emit('camera_moved', {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
      });
    }

    const vp = this.getViewportRect();
    const vpChanged =
      !this.lastViewportRect ||
      vp.minCx !== this.lastViewportRect.minCx ||
      vp.maxCx !== this.lastViewportRect.maxCx ||
      vp.minCy !== this.lastViewportRect.minCy ||
      vp.maxCy !== this.lastViewportRect.maxCy;

    if (vpChanged) {
      this.lastViewportRect = vp;
      this.lastEventTime = now;
      gameEvents.emit('viewport_changed', vp);
    }
  }

  // ── Event Handlers ────────────────────────────────────────────────

  private onKeyDown(event: KeyboardEvent): void {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement
    ) {
      return;
    }

    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.input.forward = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.input.backward = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.input.left = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.input.right = true;
        break;
      case 'KeyQ':
        this.input.rotateLeft = true;
        break;
      case 'KeyE':
        this.input.rotateRight = true;
        break;
      case 'KeyR':
      case 'Equal': // + key
        this.input.zoomIn = true;
        break;
      case 'KeyF':
      case 'Minus': // - key
        this.input.zoomOut = true;
        break;
      case 'Space':
        event.preventDefault();
        this.jumpToCity(0, 0, DEFAULT_CAMERA_HEIGHT);
        break;
      case 'Digit1':
        this.jumpToCity(this.controls.target.x, this.controls.target.z, ZOOM_LEVEL_STRATEGIC);
        break;
      case 'Digit2':
        this.jumpToCity(this.controls.target.x, this.controls.target.z, ZOOM_LEVEL_REGIONAL);
        break;
      case 'Digit3':
        this.jumpToCity(this.controls.target.x, this.controls.target.z, ZOOM_LEVEL_TACTICAL);
        break;
      case 'Digit4':
        this.jumpToCity(this.controls.target.x, this.controls.target.z, ZOOM_LEVEL_DETAIL);
        break;
      case 'KeyP':
        gameEvents.emit('toggle_overlay', undefined as void);
        break;
      case 'Escape':
        gameEvents.emit('close_panel', undefined as void);
        break;
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.input.forward = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.input.backward = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.input.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.input.right = false;
        break;
      case 'KeyQ':
        this.input.rotateLeft = false;
        break;
      case 'KeyE':
        this.input.rotateRight = false;
        break;
      case 'KeyR':
      case 'Equal':
        this.input.zoomIn = false;
        break;
      case 'KeyF':
      case 'Minus':
        this.input.zoomOut = false;
        break;
    }
  }

  private onMouseMove(event: MouseEvent): void {
    if (!this.edgeScrollEnabled) {
      return;
    }

    const rect = this.domElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (x < EDGE_SCROLL_ZONE) {
      this.input.edgeX = -1 + x / EDGE_SCROLL_ZONE;
    } else if (x > rect.width - EDGE_SCROLL_ZONE) {
      this.input.edgeX = (x - (rect.width - EDGE_SCROLL_ZONE)) / EDGE_SCROLL_ZONE;
    } else {
      this.input.edgeX = 0;
    }

    if (y < EDGE_SCROLL_ZONE) {
      this.input.edgeY = -1 + y / EDGE_SCROLL_ZONE;
    } else if (y > rect.height - EDGE_SCROLL_ZONE) {
      this.input.edgeY = (y - (rect.height - EDGE_SCROLL_ZONE)) / EDGE_SCROLL_ZONE;
    } else {
      this.input.edgeY = 0;
    }
  }
}
