/**
 * Multi-type agent renderer using InstancedMesh.
 *
 * Renders trade ships, fishing boats, citizens, legions, and caravans
 * as voxel-style models. Uses mock data initially; will be replaced by
 * Supabase Realtime subscriptions later.
 *
 * One InstancedMesh per agent type = 5 draw calls maximum.
 * Agents only visible when camera < 2000 height.
 *
 * InstancedMesh objects are pre-allocated ONCE in the constructor with
 * fixed max capacity. Per-frame updates write matrices in-place and set
 * mesh.count to control how many instances are drawn. No GPU resource
 * churn on camera movement.
 */

import * as THREE from 'three';
import { MAP_SIZE, WATER_LEVEL } from '../config';
import { CITY_DATABASE } from './cityDatabase';
import { sampleHeight, hasHeightmap } from './heightmapLoader';
import {
  getTradeShipGeometry,
  getFishingBoatGeometry,
  getCitizenGeometry,
  getLegionGeometry,
  getCaravanGeometry,
  disposeAgentModels,
} from './agentModels';
import { registerInstancePool, unregisterInstancePool } from '../ecs/meshRegistry';
import { InstancePool } from '../ecs/enums';

// ── Constants ───────────────────────────────────────────────────

const HALF_MAP = MAP_SIZE / 2;
const WATER_Y = WATER_LEVEL; // spec §5: water at sea level
const MAX_VISIBLE_HEIGHT = 2000; // ships, legions, caravans
const PEOPLE_VISIBLE_HEIGHT = 100; // spec §13: people visible < 100

/** Number of agent model types. */
const TYPE_COUNT = 5;

/** Maps AgentModelType index → InstancePool ID for MeshRegistry. */
const AGENT_POOL_IDS = [
  InstancePool.AGENT_TRADER,   // 0 = TRADE_SHIP
  InstancePool.AGENT_SHIP,     // 1 = FISHING_BOAT
  InstancePool.AGENT_CITIZEN,  // 2 = CITIZEN
  InstancePool.AGENT_LEGION,   // 3 = LEGION
  InstancePool.AGENT_CARAVAN,  // 4 = CARAVAN
] as const;

// ── Shared Material ─────────────────────────────────────────────

const AGENT_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.85,
  metalness: 0.1,
  side: THREE.FrontSide,
});

// ── Mock Agent Data ─────────────────────────────────────────────

interface MockAgent {
  x: number;
  z: number;
  y: number;
  angle: number;
  speed: number;
  type: AgentModelType;
}

const enum AgentModelType {
  TRADE_SHIP = 0,
  FISHING_BOAT = 1,
  CITIZEN = 2,
  LEGION = 3,
  CARAVAN = 4,
}

function deterministicHash(a: number, b: number): number {
  let h = ((a * 374761393 + b * 668265263) | 0);
  h = (h ^ (h >> 13)) | 0;
  h = (h * 1274126177) | 0;
  h = (h ^ (h >> 16)) | 0;
  return (h >>> 0) / 4294967296;
}

/**
 * Generate mock agents for visual development.
 * Ships on trade routes between port cities, people near cities.
 */
function generateMockAgents(): MockAgent[] {
  const agents: MockAgent[] = [];
  const portCities = CITY_DATABASE.filter((c) => c.isPort);
  const allCities = CITY_DATABASE;

  // Trade ships: between port cities
  for (let i = 0; i < Math.min(40, portCities.length); i++) {
    const city = portCities[i];
    if (!city) continue;
    // Place ship near port, slightly offshore
    const angle = deterministicHash(i, 100) * Math.PI * 2;
    const dist = 10 + deterministicHash(i, 200) * 30;
    agents.push({
      x: city.tileX - HALF_MAP + Math.cos(angle) * dist,
      z: city.tileY - HALF_MAP + Math.sin(angle) * dist,
      y: WATER_Y,
      angle: deterministicHash(i, 300) * Math.PI * 2,
      speed: 0.5 + deterministicHash(i, 400) * 1.0,
      type: AgentModelType.TRADE_SHIP,
    });
  }

  // Fishing boats: near coastal cities
  for (let i = 0; i < Math.min(20, portCities.length); i++) {
    const city = portCities[i];
    if (!city) continue;
    const angle = deterministicHash(i + 100, 100) * Math.PI * 2;
    const dist = 5 + deterministicHash(i + 100, 200) * 15;
    agents.push({
      x: city.tileX - HALF_MAP + Math.cos(angle) * dist,
      z: city.tileY - HALF_MAP + Math.sin(angle) * dist,
      y: WATER_Y,
      angle: deterministicHash(i + 100, 300) * Math.PI * 2,
      speed: 0.3 + deterministicHash(i + 100, 400) * 0.5,
      type: AgentModelType.FISHING_BOAT,
    });
  }

  // Citizens: around tier 1-2 cities
  const useHm = hasHeightmap();
  const majorCities = allCities.filter((c) => c.tier <= 2);
  for (let i = 0; i < majorCities.length; i++) {
    const city = majorCities[i];
    if (!city) continue;
    const citizenCount = city.tier === 1 ? 5 : 3;
    for (let j = 0; j < citizenCount; j++) {
      const angle = deterministicHash(i * 10 + j + 200, 100) * Math.PI * 2;
      const dist = 2 + deterministicHash(i * 10 + j + 200, 200) * 8;
      const tx = city.tileX + Math.cos(angle) * dist;
      const tz = city.tileY + Math.sin(angle) * dist;
      agents.push({
        x: tx - HALF_MAP,
        z: tz - HALF_MAP,
        y: useHm ? (sampleHeight(tx, tz) ?? 0) + 1 : 0,
        angle: deterministicHash(i * 10 + j + 200, 300) * Math.PI * 2,
        speed: 0.1 + deterministicHash(i * 10 + j + 200, 400) * 0.3,
        type: AgentModelType.CITIZEN,
      });
    }
  }

  // Legions: near capitals and military cities
  const capitals = allCities.filter((c) => c.isCapital);
  for (let i = 0; i < capitals.length; i++) {
    const city = capitals[i];
    if (!city) continue;
    for (let j = 0; j < 2; j++) {
      const angle = deterministicHash(i * 5 + j + 500, 100) * Math.PI * 2;
      const dist = 5 + deterministicHash(i * 5 + j + 500, 200) * 15;
      const tx = city.tileX + Math.cos(angle) * dist;
      const tz = city.tileY + Math.sin(angle) * dist;
      agents.push({
        x: tx - HALF_MAP,
        z: tz - HALF_MAP,
        y: useHm ? (sampleHeight(tx, tz) ?? 0) + 1 : 0,
        angle: deterministicHash(i * 5 + j + 500, 300) * Math.PI * 2,
        speed: 0.2 + deterministicHash(i * 5 + j + 500, 400) * 0.4,
        type: AgentModelType.LEGION,
      });
    }
  }

  // Caravans: between inland cities
  const inlandCities = allCities.filter((c) => !c.isPort && c.tier <= 2);
  for (let i = 0; i < Math.min(20, inlandCities.length); i++) {
    const city = inlandCities[i];
    if (!city) continue;
    const angle = deterministicHash(i + 800, 100) * Math.PI * 2;
    const dist = 10 + deterministicHash(i + 800, 200) * 20;
    const tx = city.tileX + Math.cos(angle) * dist;
    const tz = city.tileY + Math.sin(angle) * dist;
    agents.push({
      x: tx - HALF_MAP,
      z: tz - HALF_MAP,
      y: useHm ? (sampleHeight(tx, tz) ?? 0) + 1 : 0,
      angle: deterministicHash(i + 800, 300) * Math.PI * 2,
      speed: 0.15 + deterministicHash(i + 800, 400) * 0.2,
      type: AgentModelType.CARAVAN,
    });
  }

  return agents;
}

/**
 * Count agents per type to determine pre-allocation capacity.
 */
function countAgentsByType(agents: MockAgent[]): number[] {
  const counts = new Array<number>(TYPE_COUNT).fill(0);
  for (const agent of agents) {
    counts[agent.type] = (counts[agent.type] ?? 0) + 1;
  }
  return counts;
}

// ── Agent Renderer ──────────────────────────────────────────────

export class AgentRenderer {
  private readonly scene: THREE.Scene;
  private readonly agents: MockAgent[];

  /** Pre-allocated meshes, one per agent type. Created once, never disposed until dispose(). */
  private readonly meshes: (THREE.InstancedMesh | null)[];

  /** Max instance capacity per type (total agents of that type). */
  private readonly maxCounts: number[];

  private readonly _mat4 = new THREE.Matrix4();
  private readonly _pos = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3(1, 1, 1);
  private readonly _euler = new THREE.Euler();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.agents = generateMockAgents();
    this.maxCounts = countAgentsByType(this.agents);
    this.meshes = new Array<THREE.InstancedMesh | null>(TYPE_COUNT).fill(null);

    this.allocateMeshes();
  }

  /**
   * Per-frame update. Animates agent positions and writes visible
   * instance matrices into pre-allocated meshes.
   */
  update(cameraX: number, cameraY: number, cameraZ: number, _elapsed: number): void {
    // Hide at high altitude
    if (cameraY > MAX_VISIBLE_HEIGHT) {
      this.hideAll();
      return;
    }

    // Animate agent positions (simple circular movement)
    for (const agent of this.agents) {
      agent.angle += agent.speed * 0.01;
      const dx = Math.cos(agent.angle) * agent.speed * 0.3;
      const dz = Math.sin(agent.angle) * agent.speed * 0.3;
      agent.x += dx;
      agent.z += dz;
    }

    // Visibility radius based on camera height
    const visRadius = Math.min(600, cameraY * 0.8);
    this.updateInstances(cameraX, cameraZ, visRadius, cameraY);
  }

  dispose(): void {
    this.disposeMeshes();
    disposeAgentModels();
  }

  // ── Internal ──────────────────────────────────────────────────

  /**
   * Pre-allocate one InstancedMesh per agent type with max capacity.
   * Called once from the constructor. Meshes are added to the scene
   * and registered in MeshRegistry here and never removed until dispose().
   */
  private allocateMeshes(): void {
    const geoGetters = [
      getTradeShipGeometry,
      getFishingBoatGeometry,
      getCitizenGeometry,
      getLegionGeometry,
      getCaravanGeometry,
    ];

    for (let t = 0; t < TYPE_COUNT; t++) {
      const maxCount = this.maxCounts[t]!;
      if (maxCount === 0) continue;

      const geo = geoGetters[t]!();
      const mesh = new THREE.InstancedMesh(geo, AGENT_MATERIAL, maxCount);
      mesh.frustumCulled = false;
      mesh.castShadow = true;

      // Start with zero visible instances
      mesh.count = 0;

      this.scene.add(mesh);
      this.meshes[t] = mesh;

      // Register in ECS MeshRegistry once
      registerInstancePool(AGENT_POOL_IDS[t]!, mesh);
    }
  }

  /**
   * Unified per-frame instance update. Filters visible agents by distance,
   * writes their matrices into pre-allocated meshes, and sets mesh.count
   * to the number of visible agents per type.
   *
   * No InstancedMesh creation, disposal, scene.add, or scene.remove.
   */
  private updateInstances(camX: number, camZ: number, visRadius: number, cameraY: number): void {
    const visRadiusSq = visRadius * visRadius;
    // Spec §13: people (citizens) only visible when camera < PEOPLE_VISIBLE_HEIGHT
    const showPeople = cameraY < PEOPLE_VISIBLE_HEIGHT;

    // Per-type write cursors
    const cursors = new Array<number>(TYPE_COUNT).fill(0);

    // Single pass: write matrices for all visible agents
    for (const agent of this.agents) {
      // Per-type height visibility: citizens only at close zoom
      if (agent.type === AgentModelType.CITIZEN && !showPeople) continue;

      const dx = agent.x - camX;
      const dz = agent.z - camZ;
      if (dx * dx + dz * dz > visRadiusSq) continue;

      const mesh = this.meshes[agent.type];
      if (!mesh) continue;

      const idx = cursors[agent.type]!;
      this._euler.set(0, agent.angle, 0);
      this._quat.setFromEuler(this._euler);
      this._pos.set(agent.x, agent.y || WATER_Y, agent.z);
      this._mat4.compose(this._pos, this._quat, this._scale);
      mesh.setMatrixAt(idx, this._mat4);
      cursors[agent.type] = idx + 1;
    }

    // Update counts and mark matrices dirty
    for (let t = 0; t < TYPE_COUNT; t++) {
      const mesh = this.meshes[t];
      if (!mesh) continue;

      const visibleCount = cursors[t]!;
      mesh.count = visibleCount;

      if (visibleCount > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.visible = true;
      } else {
        mesh.visible = false;
      }
    }
  }

  /**
   * Hide all agent meshes by setting count to zero.
   * No scene removal or disposal.
   */
  private hideAll(): void {
    for (let t = 0; t < TYPE_COUNT; t++) {
      const mesh = this.meshes[t];
      if (mesh) {
        mesh.count = 0;
        mesh.visible = false;
      }
    }
  }

  /**
   * Full disposal of meshes. Only called from dispose().
   * Removes from scene, unregisters from MeshRegistry, and disposes GPU resources.
   */
  private disposeMeshes(): void {
    for (let t = 0; t < TYPE_COUNT; t++) {
      const mesh = this.meshes[t];
      if (mesh) {
        unregisterInstancePool(AGENT_POOL_IDS[t]!);
        this.scene.remove(mesh);
        mesh.dispose();
        this.meshes[t] = null;
      }
    }
  }
}
