/**
 * Multi-type agent renderer using InstancedMesh.
 *
 * Renders trade ships, fishing boats, citizens, legions, and caravans
 * as voxel-style models. Uses mock data initially; will be replaced by
 * Supabase Realtime subscriptions later.
 *
 * One InstancedMesh per agent type = 5 draw calls maximum.
 * Agents only visible when camera < 2000 height.
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

// ── Constants ───────────────────────────────────────────────────

const HALF_MAP = MAP_SIZE / 2;
const WATER_Y = WATER_LEVEL - 1;
const MAX_VISIBLE_HEIGHT = 2000;
const CAMERA_MOVE_THRESHOLD = 40;

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

// ── Agent Renderer ──────────────────────────────────────────────

export class AgentRenderer {
  private readonly scene: THREE.Scene;
  private readonly agents: MockAgent[];

  private tradeShipMesh: THREE.InstancedMesh | null = null;
  private fishingBoatMesh: THREE.InstancedMesh | null = null;
  private citizenMesh: THREE.InstancedMesh | null = null;
  private legionMesh: THREE.InstancedMesh | null = null;
  private caravanMesh: THREE.InstancedMesh | null = null;

  private lastCamX = -99999;
  private lastCamZ = -99999;
  private wasVisible = false;

  private readonly _mat4 = new THREE.Matrix4();
  private readonly _pos = new THREE.Vector3();
  private readonly _quat = new THREE.Quaternion();
  private readonly _scale = new THREE.Vector3(1, 1, 1);
  private readonly _euler = new THREE.Euler();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.agents = generateMockAgents();
  }

  /**
   * Per-frame update. Animates agent positions and rebuilds instances
   * when camera moves significantly.
   */
  update(cameraX: number, cameraY: number, cameraZ: number, _elapsed: number): void {
    // Hide at high altitude
    if (cameraY > MAX_VISIBLE_HEIGHT) {
      this.hideAll();
      this.wasVisible = false;
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

    // Check if camera moved enough to rebuild
    const dx = cameraX - this.lastCamX;
    const dz = cameraZ - this.lastCamZ;
    const camMoved = dx * dx + dz * dz > CAMERA_MOVE_THRESHOLD * CAMERA_MOVE_THRESHOLD;

    if (!camMoved && this.wasVisible) {
      // Just update instance matrices for animation
      this.updateInstanceMatrices();
      return;
    }

    this.lastCamX = cameraX;
    this.lastCamZ = cameraZ;

    // Visibility radius based on camera height
    const visRadius = Math.min(600, cameraY * 0.8);
    this.rebuildInstances(cameraX, cameraZ, visRadius);
    this.wasVisible = true;
  }

  dispose(): void {
    this.disposeMeshes();
    disposeAgentModels();
  }

  // ── Internal ──────────────────────────────────────────────────

  private rebuildInstances(camX: number, camZ: number, visRadius: number): void {
    this.disposeMeshes();

    const visRadiusSq = visRadius * visRadius;

    // Filter visible agents by type
    const byType: MockAgent[][] = [[], [], [], [], []];
    for (const agent of this.agents) {
      const dx = agent.x - camX;
      const dz = agent.z - camZ;
      if (dx * dx + dz * dz <= visRadiusSq) {
        byType[agent.type]!.push(agent);
      }
    }

    // Create InstancedMesh per type
    const geoGetters = [
      getTradeShipGeometry,
      getFishingBoatGeometry,
      getCitizenGeometry,
      getLegionGeometry,
      getCaravanGeometry,
    ];

    const meshRefs: (THREE.InstancedMesh | null)[] = [null, null, null, null, null];

    for (let t = 0; t < 5; t++) {
      const agents = byType[t]!;
      if (agents.length === 0) continue;

      const geo = geoGetters[t]!();
      const mesh = new THREE.InstancedMesh(geo, AGENT_MATERIAL, agents.length);
      mesh.frustumCulled = false;

      for (let i = 0; i < agents.length; i++) {
        const a = agents[i]!;
        this._euler.set(0, a.angle, 0);
        this._quat.setFromEuler(this._euler);
        this._pos.set(a.x, a.y || WATER_Y, a.z);
        this._mat4.compose(this._pos, this._quat, this._scale);
        mesh.setMatrixAt(i, this._mat4);
      }

      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
      meshRefs[t] = mesh;
    }

    this.tradeShipMesh = meshRefs[0] ?? null;
    this.fishingBoatMesh = meshRefs[1] ?? null;
    this.citizenMesh = meshRefs[2] ?? null;
    this.legionMesh = meshRefs[3] ?? null;
    this.caravanMesh = meshRefs[4] ?? null;
  }

  private updateInstanceMatrices(): void {
    const meshes = [
      this.tradeShipMesh,
      this.fishingBoatMesh,
      this.citizenMesh,
      this.legionMesh,
      this.caravanMesh,
    ];

    for (const mesh of meshes) {
      if (mesh) {
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  private hideAll(): void {
    const meshes = [
      this.tradeShipMesh,
      this.fishingBoatMesh,
      this.citizenMesh,
      this.legionMesh,
      this.caravanMesh,
    ];
    for (const mesh of meshes) {
      if (mesh) mesh.visible = false;
    }
  }

  private disposeMeshes(): void {
    const meshes = [
      this.tradeShipMesh,
      this.fishingBoatMesh,
      this.citizenMesh,
      this.legionMesh,
      this.caravanMesh,
    ];

    for (const mesh of meshes) {
      if (mesh) {
        this.scene.remove(mesh);
        mesh.dispose();
      }
    }

    this.tradeShipMesh = null;
    this.fishingBoatMesh = null;
    this.citizenMesh = null;
    this.legionMesh = null;
    this.caravanMesh = null;
  }
}
