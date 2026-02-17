/**
 * Engine: Central game loop and subsystem manager.
 *
 * Each subsystem implements the GameSystem interface and is registered
 * via engine.register(). The engine owns the Three.js renderer, scene,
 * camera, and the render loop. Subsystems receive init/update/dispose
 * calls in registration order.
 *
 * Uses WebGPURenderer which supports both native WebGPU and WebGL2
 * (via forceWebGL fallback). TSL node materials compile to GLSL or WGSL
 * automatically depending on the active backend.
 *
 * The ECS pipeline runs first each frame (via runPipeline), then
 * GameSystems update. During migration, both coexist. Once all
 * GameSystems are migrated, only the ECS pipeline will remain.
 */

import * as THREE from 'three';
import WebGPURenderer from 'three/src/renderers/webgpu/WebGPURenderer.js';
import { APP_NAME, CAMERA_FOV, DEFAULT_CAMERA_HEIGHT, FAR_CLIP, MAX_PIXEL_RATIO, NEAR_CLIP } from '../config';
import { perfMonitor } from '../core/perfMonitor';
import { createLogger } from '../core/logger';
import { world, runPipeline } from '../ecs';

const log = createLogger('Engine');

// ── Subsystem Interface ───────────────────────────────────────────

export interface GameSystem {
  /** Unique name for logging and lookup. */
  readonly name: string;

  /**
   * Called once after the engine is fully constructed.
   * Receives the engine so subsystems can access scene, camera, renderer.
   */
  init(engine: Engine): void;

  /**
   * Called every frame. deltaTime is in seconds, elapsed is total seconds.
   */
  update(deltaTime: number, elapsed: number): void;

  /** Called on window resize. */
  resize?(width: number, height: number): void;

  /** Clean up GPU resources, event listeners, etc. */
  dispose(): void;
}

// ── Engine ────────────────────────────────────────────────────────

export class Engine {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: InstanceType<typeof WebGPURenderer>;
  readonly clock = new THREE.Clock();

  /** DOM element the renderer canvas lives in. */
  readonly container: HTMLDivElement;

  /** Directional sun light (public for shadow target updates). */
  private sun!: THREE.DirectionalLight;

  private systems: GameSystem[] = [];
  private running = false;
  private animationFrameId = 0;

  constructor(mountPoint: HTMLElement) {
    // Canvas container
    this.container = document.createElement('div');
    this.container.style.width = '100%';
    this.container.style.height = '100%';
    mountPoint.appendChild(this.container);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x1a2a3d, 800, 2200);
    this.scene.background = new THREE.Color(0x0e1a2a);

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
    // Hemisphere light: warm sky (sun-lit) + cool ground (shadow fill)
    const hemiLight = new THREE.HemisphereLight(0xd4c5a0, 0x3a4a5e, 0.35);
    this.scene.add(hemiLight);

    // Warm golden-hour directional sun from southwest
    const sun = new THREE.DirectionalLight(0xfff8eb, 1.2);
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
    window.addEventListener('resize', this.onResize);

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

  // ── Subsystem Management ──────────────────────────────────────

  /** Register a subsystem. Call before start(). */
  register(system: GameSystem): void {
    this.systems.push(system);
    system.init(this);
    log.info(`System registered: ${system.name}`);
  }

  /** Get a registered system by name. */
  getSystem<T extends GameSystem>(name: string): T | undefined {
    return this.systems.find((s) => s.name === name) as T | undefined;
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

    for (const system of this.systems) {
      system.dispose();
    }
    this.systems = [];

    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    log.info('Engine stopped');
  }

  // ── Render Loop ───────────────────────────────────────────────

  private animate = (): void => {
    if (!this.running) return;
    this.animationFrameId = requestAnimationFrame(this.animate);

    perfMonitor.beginFrame();

    const deltaTime = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    // Shadow map: follow camera XZ, disable at high altitude for perf
    const camPos = this.camera.position;
    const shadowsNeeded = camPos.y < 1500;
    if (this.sun.castShadow !== shadowsNeeded) {
      this.sun.castShadow = shadowsNeeded;
    }
    if (shadowsNeeded) {
      this.sun.position.set(camPos.x - 300, 600, camPos.z - 240);
      this.sun.target.position.set(camPos.x, 0, camPos.z);
      this.sun.target.updateMatrixWorld();
    }

    // Run ECS pipeline first (camera sync, viewport, visibility, etc.)
    runPipeline(world, deltaTime);

    // Then run GameSystems (renderers that still own their logic)
    for (const system of this.systems) {
      system.update(deltaTime, elapsed);
    }

    perfMonitor.drawCalls = this.renderer.info.render.calls;
    perfMonitor.triangles = this.renderer.info.render.triangles;
    perfMonitor.endFrame();
  };

  // ── Resize ────────────────────────────────────────────────────

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);

    for (const system of this.systems) {
      system.resize?.(w, h);
    }
  };
}
