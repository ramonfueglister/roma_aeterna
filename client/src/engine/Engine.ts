/**
 * Engine: Central game loop and rendering infrastructure.
 *
 * Owns the Three.js renderer, scene, camera, and the frame loop.
 * The ECS pipeline (runPipeline) is the SOLE update path — all game
 * logic runs through ECS systems. No GameSystem class hierarchy.
 *
 * Renderer creation and ECS ref wiring happen in main.ts during
 * bootstrap. The Engine handles only:
 *   - Scene, camera, renderer setup
 *   - Lighting (ambient + directional sun with contact shadows)
 *   - The frame loop (requestAnimationFrame)
 *   - Window resize propagation
 *   - Dispose callback management
 *
 * Uses WebGPURenderer which supports both native WebGPU and WebGL2
 * (via forceWebGL fallback). TSL node materials compile to GLSL or WGSL
 * automatically depending on the active backend.
 */

import * as THREE from 'three';
// Import from three/webgpu (NOT the deep path three/src/renderers/webgpu/WebGPURenderer.js).
// Deep-path imports cause Vite to split Three.js into separate pre-bundled chunks,
// duplicating module-level singletons like TSL's currentStack. This duplication
// makes positionLocal.assign() crash with "Cannot read properties of null".
import { WebGPURenderer } from 'three/webgpu';
import { APP_NAME, CAMERA_FOV, DEFAULT_CAMERA_HEIGHT, FAR_CLIP, MAX_PIXEL_RATIO, NEAR_CLIP } from '../config';
import { perfMonitor } from '../core/perfMonitor';
import { createLogger } from '../core/logger';
import { world, runPipeline } from '../ecs';

const log = createLogger('Engine');

// ── Engine ────────────────────────────────────────────────────────

export class Engine {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: InstanceType<typeof WebGPURenderer>;
  readonly clock = new THREE.Clock();

  /** DOM element the renderer canvas lives in. */
  readonly container: HTMLDivElement;

  /** Directional sun light (contact shadows at close zoom). */
  private sun!: THREE.DirectionalLight;

  private running = false;
  private animationFrameId = 0;
  private disposeCallbacks: (() => void)[] = [];
  private resizeCallbacks: ((width: number, height: number) => void)[] = [];

  constructor(mountPoint: HTMLElement) {
    // Canvas container
    this.container = document.createElement('div');
    this.container.style.width = '100%';
    this.container.style.height = '100%';
    mountPoint.appendChild(this.container);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a1120, 800, 2000);
    this.scene.background = new THREE.Color(0x07111b);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      window.innerWidth / window.innerHeight,
      NEAR_CLIP,
      FAR_CLIP,
    );
    this.camera.position.set(0, DEFAULT_CAMERA_HEIGHT, -24);

    // Renderer: WebGPURenderer with WebGL2 fallback
    this.renderer = new WebGPURenderer({
      antialias: true,
      forceWebGL: !navigator.gpu,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // Lighting (spec section 22)
    // Ambient: cool sky blue (RGB 140, 155, 180), intensity 0.4
    const ambientLight = new THREE.AmbientLight(0x8c9bb4, 0.4);
    this.scene.add(ambientLight);

    // Warm golden-hour directional sun from southwest (spec: RGB 255,248,235, intensity 1.0)
    const sun = new THREE.DirectionalLight(0xfff8eb, 1.0);
    sun.position.set(-1500, 3000, -1200);

    // Shadow map: covers a 600x600 area around the camera target
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 100;
    sun.shadow.camera.far = 6000;
    sun.shadow.camera.left = -300;
    sun.shadow.camera.right = 300;
    sun.shadow.camera.top = 300;
    sun.shadow.camera.bottom = -300;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.5;
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(sun.target);

    // Resize
    window.addEventListener('resize', this.handleResize);

    const backend = navigator.gpu ? 'WebGPU' : 'WebGL2';
    log.info(`${APP_NAME} engine created (${backend} backend)`);
  }

  /**
   * Initialize the renderer backend. Must be called before start().
   * WebGPURenderer requires async initialization for both backends.
   */
  async init(): Promise<void> {
    await this.renderer.init();
    log.info('Renderer initialized');
  }

  // ── Lifecycle Callbacks ─────────────────────────────────────────

  /** Register a callback to run on engine dispose. */
  onDispose(fn: () => void): void {
    this.disposeCallbacks.push(fn);
  }

  /** Register a callback to run on window resize. */
  onResize(fn: (width: number, height: number) => void): void {
    this.resizeCallbacks.push(fn);
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  /** Start the render loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.animate();
    log.info('Render loop started');
  }

  /** Stop the render loop and dispose everything. */
  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.animationFrameId);

    for (const fn of this.disposeCallbacks) {
      fn();
    }
    this.disposeCallbacks = [];
    this.resizeCallbacks = [];

    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
    log.info('Engine stopped');
  }

  // ── Render Loop ───────────────────────────────────────────────

  private animate = (): void => {
    if (!this.running) return;
    this.animationFrameId = requestAnimationFrame(this.animate);

    perfMonitor.beginFrame();

    const deltaTime = this.clock.getDelta();

    // Contact shadows: only at close zoom (< 500) per spec section 22
    const camPos = this.camera.position;
    const shadowsNeeded = camPos.y < 500;
    if (this.sun.castShadow !== shadowsNeeded) {
      this.sun.castShadow = shadowsNeeded;
    }
    if (shadowsNeeded) {
      this.sun.position.set(camPos.x - 300, 600, camPos.z - 240);
      this.sun.target.position.set(camPos.x, 0, camPos.z);
      this.sun.target.updateMatrixWorld();
    }

    // ECS pipeline is the sole update path
    runPipeline(world, deltaTime);

    perfMonitor.drawCalls = this.renderer.info.render.calls;
    perfMonitor.triangles = this.renderer.info.render.triangles;
    perfMonitor.endFrame();
  };

  // ── Resize ────────────────────────────────────────────────────

  private handleResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);

    for (const fn of this.resizeCallbacks) {
      fn(w, h);
    }
  };
}
