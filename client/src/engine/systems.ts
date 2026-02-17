/**
 * GameSystem implementations wrapping existing renderers/controllers.
 *
 * Each system adapts an existing class (ChunkLoader, WaterRenderer, etc.)
 * to the GameSystem interface so the Engine can manage them uniformly.
 */

import * as THREE from 'three';
import type { Engine, GameSystem } from './Engine';
import { MAP_SIZE } from '../config';
import { gameEvents } from '../core/eventBus';
import { perfMonitor } from '../core/perfMonitor';
import { generateProceduralChunk } from '../world/proceduralChunk';

import { CameraController } from '../camera/cameraController';
import { ChunkLoader } from '../world/chunkLoader';
import { WorkerPool } from '../workers/workerPool';
import { WaterRenderer } from '../world/waterRenderer';
import { ProvinceRenderer } from '../world/provinceRenderer';
import { CityRenderer } from '../world/cityDatabase';
import { TreeRenderer } from '../world/treeRenderer';
import { PostProcessingPipeline } from '../rendering/postProcessing';
import { TextLabelRenderer } from '../world/textLabels';
import { CITY_DATABASE } from '../world/cityDatabase';
import { AgentRenderer } from '../world/agentRenderer';
import { ParticleSystem } from '../world/particleSystem';
import { RoadRenderer } from '../world/roadRenderer';
import { getHeightmapData, hasHeightmap } from '../world/heightmapLoader';

// ── Base ──────────────────────────────────────────────────────────

abstract class BaseSystem implements GameSystem {
  abstract readonly name: string;
  protected engine!: Engine;

  init(engine: Engine): void {
    this.engine = engine;
    this.onInit(engine);
  }

  protected abstract onInit(engine: Engine): void;
  abstract update(deltaTime: number, elapsed: number): void;
  abstract dispose(): void;
}

// ── Camera ────────────────────────────────────────────────────────

export class CameraSystem extends BaseSystem {
  readonly name = 'camera';
  controller!: CameraController;

  protected onInit(engine: Engine): void {
    this.controller = new CameraController(engine.camera, engine.renderer.domElement, engine.scene);
    this.controller.orbitControls.target.set(0, 40, -24);
  }

  update(deltaTime: number): void {
    this.controller.update(deltaTime);
  }

  dispose(): void {
    this.controller.dispose();
  }
}

// ── Terrain ───────────────────────────────────────────────────────

export class TerrainSystem extends BaseSystem {
  readonly name = 'terrain';
  loader!: ChunkLoader;
  workerPool!: WorkerPool;

  private workerCount: number;

  constructor(workerCount = 4) {
    super();
    this.workerCount = workerCount;
  }

  protected onInit(engine: Engine): void {
    this.workerPool = new WorkerPool(this.workerCount);
    this.loader = new ChunkLoader(engine.scene, {
      loadRadius: 6,
      unloadRadius: 10,
      workerPool: this.workerPool,
    });
  }

  update(): void {
    const cam = this.engine.camera.position;
    this.loader.update(cam.x, cam.z);
  }

  dispose(): void {
    this.loader.dispose();
    this.workerPool.dispose();
  }
}

// ── Water ─────────────────────────────────────────────────────────

export class WaterSystem extends BaseSystem {
  readonly name = 'water';
  renderer!: WaterRenderer;

  protected onInit(engine: Engine): void {
    this.renderer = new WaterRenderer(engine.scene);

    // Pass heightmap to water shader for coastal foam detection
    if (hasHeightmap()) {
      const hmData = getHeightmapData();
      if (hmData) {
        const tex = new THREE.DataTexture(
          hmData,
          MAP_SIZE,
          MAP_SIZE,
          THREE.RedFormat,
          THREE.UnsignedByteType,
        );
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;
        this.renderer.setHeightmapTexture(tex);
      }
    }
  }

  update(_dt: number, elapsed: number): void {
    this.renderer.update(elapsed, this.engine.camera.position);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

// ── Provinces ─────────────────────────────────────────────────────

export class ProvinceSystem extends BaseSystem {
  readonly name = 'provinces';
  renderer!: ProvinceRenderer;

  protected onInit(engine: Engine): void {
    this.renderer = new ProvinceRenderer(engine.scene);

    gameEvents.on('chunk_loaded', ({ cx, cy }) => {
      const chunkData = generateProceduralChunk(cx, cy);
      this.renderer.updateChunkProvinces(cx, cy, chunkData.provinces);
    });

    gameEvents.on('toggle_overlay', () => {
      this.renderer.toggleVisible();
    });
  }

  update(_dt: number, elapsed: number): void {
    this.renderer.update(this.engine.camera.position.y, elapsed);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

// ── Cities ────────────────────────────────────────────────────────

export class CitySystem extends BaseSystem {
  readonly name = 'cities';
  renderer!: CityRenderer;

  protected onInit(engine: Engine): void {
    this.renderer = new CityRenderer(engine.scene);
  }

  update(): void {
    const cam = this.engine.camera.position;
    this.renderer.update(cam.y, cam.x, cam.z);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

// ── Trees ─────────────────────────────────────────────────────────

export class TreeSystem extends BaseSystem {
  readonly name = 'trees';
  renderer!: TreeRenderer;

  protected onInit(engine: Engine): void {
    this.renderer = new TreeRenderer(engine.scene);

    gameEvents.on('chunk_loaded', ({ cx, cy }) => {
      const chunkData = generateProceduralChunk(cx, cy);
      this.renderer.updateChunkTrees(cx, cy, chunkData.heights, chunkData.biomes);
    });
  }

  update(): void {
    const cam = this.engine.camera.position;
    this.renderer.update(cam.x, cam.y, cam.z);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

// ── Text Labels ──────────────────────────────────────────────────

export class TextLabelSystem extends BaseSystem {
  readonly name = 'textLabels';
  renderer!: TextLabelRenderer;

  protected onInit(engine: Engine): void {
    this.renderer = new TextLabelRenderer(engine.scene);
    this.renderer.setCities([...CITY_DATABASE]);
  }

  update(): void {
    const cam = this.engine.camera.position;
    this.renderer.update(cam.y, cam.x, cam.z);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

// ── Roads & Trade Routes ─────────────────────────────────────────

export class RoadSystem extends BaseSystem {
  readonly name = 'roads';
  renderer!: RoadRenderer;

  protected onInit(engine: Engine): void {
    this.renderer = new RoadRenderer(engine.scene);
  }

  update(): void {
    const cam = this.engine.camera.position;
    this.renderer.update(cam.y, cam.x, cam.z);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

// ── Agents ───────────────────────────────────────────────────────

export class AgentSystem extends BaseSystem {
  readonly name = 'agents';
  renderer!: AgentRenderer;

  protected onInit(engine: Engine): void {
    this.renderer = new AgentRenderer(engine.scene);
  }

  update(_dt: number, elapsed: number): void {
    const cam = this.engine.camera.position;
    this.renderer.update(cam.x, cam.y, cam.z, elapsed);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

// ── Particles ────────────────────────────────────────────────────

export class ParticleSystemWrapper extends BaseSystem {
  readonly name = 'particles';
  particles!: ParticleSystem;

  protected onInit(engine: Engine): void {
    this.particles = new ParticleSystem(engine.scene);
  }

  update(_dt: number, elapsed: number): void {
    const cam = this.engine.camera.position;
    this.particles.update(cam.x, cam.y, cam.z, elapsed);
  }

  dispose(): void {
    this.particles.dispose();
  }
}

// ── Post-Processing ───────────────────────────────────────────────

export class PostProcessingSystem extends BaseSystem {
  readonly name = 'postprocessing';
  pipeline!: PostProcessingPipeline;

  protected onInit(engine: Engine): void {
    this.pipeline = new PostProcessingPipeline(engine.renderer, engine.scene, engine.camera);
  }

  update(): void {
    this.pipeline.updateCameraHeight(this.engine.camera.position.y);
    this.pipeline.render();
  }

  resize(width: number, height: number): void {
    this.pipeline.setSize(width, height);
  }

  dispose(): void {
    this.pipeline.dispose();
  }
}

// ── HUD ───────────────────────────────────────────────────────────

export class HudSystem extends BaseSystem {
  readonly name = 'hud';

  private fpsNode: HTMLDivElement | null = null;
  private chunksNode: HTMLDivElement | null = null;
  private coordsNode: HTMLDivElement | null = null;
  private hudEl: HTMLDivElement | null = null;
  private toastEl: HTMLDivElement | null = null;
  private toastCleared = false;
  private frameCount = 0;

  protected onInit(engine: Engine): void {
    const mount = engine.container.parentElement;
    if (!mount) return;

    this.hudEl = document.createElement('div');
    this.hudEl.id = 'hud';
    this.hudEl.innerHTML = `
      <h1>Imperium</h1>
      <div class="row" id="status">Loading...</div>
      <div class="row" id="fps">FPS: ...</div>
      <div class="row" id="chunks">Chunks: ...</div>
      <div class="row" id="coords">Camera: x=0, y=0, z=0</div>
    `;
    mount.appendChild(this.hudEl);

    this.toastEl = document.createElement('div');
    this.toastEl.id = 'toast';
    this.toastEl.innerHTML = `<div class="title">Imperium</div><div>Loading terrain...</div>`;
    mount.appendChild(this.toastEl);

    this.fpsNode = document.querySelector('#fps');
    this.chunksNode = document.querySelector('#chunks');
    this.coordsNode = document.querySelector('#coords');
  }

  update(): void {
    this.frameCount++;
    if (this.frameCount % 30 !== 0) return;

    const snap = perfMonitor.snapshot();
    const cam = this.engine.camera.position;

    if (this.fpsNode) {
      this.fpsNode.textContent = `FPS: ${snap.fps} | Draw: ${snap.drawCalls} | Tri: ${snap.triangles}`;
    }

    if (this.coordsNode) {
      this.coordsNode.textContent = `Camera: x=${cam.x.toFixed(0)}, y=${cam.y.toFixed(0)}, z=${cam.z.toFixed(0)}`;
    }

    const terrain = this.engine.getSystem<TerrainSystem>('terrain');
    if (terrain && this.chunksNode) {
      this.chunksNode.textContent = `Chunks: ${terrain.loader.loadedCount} loaded, ${terrain.loader.pendingCount} pending`;
    }

    if (!this.toastCleared && terrain && terrain.loader.loadedCount > 0) {
      this.toastCleared = true;
      this.setToast('Imperium', `${terrain.loader.loadedCount} chunks loaded`);
    }
  }

  setToast(title: string, body: string): void {
    if (this.toastEl) {
      this.toastEl.innerHTML = `<div class="title">${title}</div><div>${body}</div>`;
    }
  }

  dispose(): void {
    this.hudEl?.remove();
    this.toastEl?.remove();
  }
}

// ── Interaction ───────────────────────────────────────────────────

export class InteractionSystem extends BaseSystem {
  readonly name = 'interaction';

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private boundPointerDown: ((e: PointerEvent) => void) | null = null;

  protected onInit(engine: Engine): void {
    this.boundPointerDown = (event: PointerEvent) => {
      const rect = engine.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.pointer, engine.camera);

      const cities = engine.getSystem<CitySystem>('cities');
      if (!cities) return;

      const cityData = cities.renderer.raycast(this.raycaster);
      if (cityData) {
        const hud = engine.getSystem<HudSystem>('hud');
        hud?.setToast(`Selected: ${cityData.name}`, `${cityData.culture}, Tier ${cityData.tier}`);
        gameEvents.emit('city_selected', cityData);

        const camera = engine.getSystem<CameraSystem>('camera');
        if (camera) {
          const worldX = cityData.tileX - MAP_SIZE / 2;
          const worldZ = cityData.tileY - MAP_SIZE / 2;
          camera.controller.jumpToCity(worldX, worldZ, 800);
        }
      }
    };

    engine.renderer.domElement.addEventListener('pointerdown', this.boundPointerDown);

    gameEvents.on('close_panel', () => {
      gameEvents.emit('city_selected', null);
      gameEvents.emit('agent_selected', null);
      gameEvents.emit('province_selected', null);
    });
  }

  update(): void {
    // Event-driven, nothing to poll
  }

  dispose(): void {
    if (this.boundPointerDown) {
      this.engine.renderer.domElement.removeEventListener('pointerdown', this.boundPointerDown);
    }
  }
}
