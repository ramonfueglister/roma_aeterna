/**
 * LOD-aware city renderer for the Roman Empire at 117 AD.
 *
 * Uses InstancedMesh per culture group with three view zones:
 *   Strategic (far)  - diamond markers for all cities
 *   Tactical (mid)   - octahedron markers + glow lines for nearby cities
 *   Detail (close)   - scaled octahedrons + glow + building clusters
 *
 * City data is imported from the separate cityData module.
 */

import * as THREE from 'three';
import { MAP_SIZE } from '../config';
import type { CityData, CityTier, CultureType } from '../types';
import { BuildingRenderer, generateCityLayout } from './buildingGenerator';
import type { PlacedBuilding } from './buildingGenerator';
import { sampleHeight, hasHeightmap } from './heightmapLoader';
import { CITY_DATABASE } from './cityData';

// ── Culture color map ───────────────────────────────────────────

const CULTURE_COLORS: Readonly<Record<CultureType, number>> = {
  roman:          0xC2A255,
  greek:          0x6F8BBF,
  egyptian:       0xD4A855,
  eastern:        0x55A5A5,
  celtic:         0x5A8A3C,
  germanic:       0x8A6A4A,
  north_african:  0xD49A61,
  dacian:         0x6A5A4A,
  levantine:      0x7A9AAA,
};

// ── Tier marker sizes (world units) ─────────────────────────────

const TIER_SIZES: Readonly<Record<CityTier, number>> = {
  1: 30,
  2: 20,
  3: 14,
  4: 8,
};

// ── LOD zone thresholds ─────────────────────────────────────────

const STRATEGIC_HEIGHT = 1500;
const TACTICAL_HEIGHT = 300;
const TACTICAL_RANGE = 2000;
const DETAIL_RANGE = 500;
const MARKER_Y = 72;
const HALF_MAP = MAP_SIZE / 2;

// ── View zone enum ──────────────────────────────────────────────

const enum ViewZone {
  Strategic = 0,
  Tactical = 1,
  Detail = 2,
}

// ── Shared geometry builders ────────────────────────────────────

function createDiamondGeometry(size: number): THREE.BufferGeometry {
  const hs = size / 2;
  const verts = new Float32Array([
    0,  hs, 0,    // top
    -hs, 0, 0,    // left
    0,  0,  hs,   // front
    hs,  0, 0,    // right
    0,  0, -hs,   // back
    0, -hs, 0,    // bottom
  ]);
  const indices = new Uint16Array([
    0, 1, 2,   0, 2, 3,   0, 3, 4,   0, 4, 1,
    5, 2, 1,   5, 3, 2,   5, 4, 3,   5, 1, 4,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

function createOctahedronGeometry(size: number): THREE.BufferGeometry {
  return new THREE.OctahedronGeometry(size / 2, 0);
}

// ── Per-culture instanced mesh set ──────────────────────────────

interface CultureMeshSet {
  readonly culture: CultureType;
  readonly color: THREE.Color;
  readonly cities: readonly CityData[];
  strategicMesh: THREE.InstancedMesh | null;
  tacticalMesh: THREE.InstancedMesh | null;
  glowLines: THREE.InstancedMesh | null;
}

// ── CityRenderer ────────────────────────────────────────────────

export class CityRenderer {
  private readonly group: THREE.Group;
  private readonly scene: THREE.Scene;
  private readonly cultureSets: ReadonlyMap<CultureType, CultureMeshSet>;
  private readonly cityWorldPositions: ReadonlyMap<string, THREE.Vector3>;
  private readonly allCities: readonly CityData[];

  /** Building renderer for detail view. */
  private readonly buildingRenderer: BuildingRenderer;
  /** Cached building layouts per city (generated once). */
  private readonly buildingLayouts: Map<string, PlacedBuilding[]> = new Map();
  /** Whether buildings are currently shown. */
  private buildingsVisible = false;

  /** Reusable objects to avoid per-frame allocation. */
  private readonly _mat4 = new THREE.Matrix4();
  private readonly _vec3 = new THREE.Vector3();

  /** Tracks which view zone we last built meshes for. */
  private currentZone: ViewZone | null = null;
  private lastCameraX = Number.NaN;
  private lastCameraZ = Number.NaN;

  /** Shared geometries (created once, reused). */
  private readonly diamondGeos: ReadonlyMap<CityTier, THREE.BufferGeometry>;
  private readonly octaGeos: ReadonlyMap<CityTier, THREE.BufferGeometry>;
  private readonly glowGeo: THREE.BufferGeometry;
  private readonly strategicMaterial: THREE.MeshBasicMaterial;
  private readonly tacticalMaterial: THREE.MeshStandardMaterial;
  private readonly glowMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'CityMarkers';
    this.scene.add(this.group);

    this.allCities = CITY_DATABASE;
    this.buildingRenderer = new BuildingRenderer(scene);

    // Pre-compute world positions (terrain-aware Y when heightmap available)
    const useHeightmap = hasHeightmap();
    const positions = new Map<string, THREE.Vector3>();
    for (const c of this.allCities) {
      const y = useHeightmap
        ? (sampleHeight(c.tileX, c.tileY) ?? MARKER_Y) + 2
        : MARKER_Y;
      positions.set(c.id, new THREE.Vector3(
        c.tileX - HALF_MAP,
        y,
        c.tileY - HALF_MAP,
      ));
    }
    this.cityWorldPositions = positions;

    // Build per-culture city groupings
    const cultureMap = new Map<CultureType, CityData[]>();
    for (const c of this.allCities) {
      const arr = cultureMap.get(c.culture);
      if (arr) {
        arr.push(c);
      } else {
        cultureMap.set(c.culture, [c]);
      }
    }

    const sets = new Map<CultureType, CultureMeshSet>();
    for (const [culture, cities] of cultureMap) {
      const colorHex = CULTURE_COLORS[culture];
      sets.set(culture, {
        culture,
        color: new THREE.Color(colorHex),
        cities,
        strategicMesh: null,
        tacticalMesh: null,
        glowLines: null,
      });
    }
    this.cultureSets = sets;

    // Create shared geometries per tier
    const dGeos = new Map<CityTier, THREE.BufferGeometry>();
    const oGeos = new Map<CityTier, THREE.BufferGeometry>();
    const tiers: readonly CityTier[] = [1, 2, 3, 4];
    for (const t of tiers) {
      const size = TIER_SIZES[t];
      dGeos.set(t, createDiamondGeometry(size));
      oGeos.set(t, createOctahedronGeometry(size));
    }
    this.diamondGeos = dGeos;
    this.octaGeos = oGeos;

    // Glow line geometry (thin tall cylinder)
    this.glowGeo = new THREE.CylinderGeometry(0.8, 0.8, 60, 4);

    // Materials
    this.strategicMaterial = new THREE.MeshBasicMaterial({
      vertexColors: false,
      transparent: true,
      opacity: 0.9,
      depthWrite: true,
    });

    this.tacticalMaterial = new THREE.MeshStandardMaterial({
      vertexColors: false,
      metalness: 0.3,
      roughness: 0.5,
      transparent: true,
      opacity: 0.95,
      depthWrite: true,
    });

    this.glowMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  // ── Public API ──────────────────────────────────────────────

  update(cameraHeight: number, cameraX: number, cameraZ: number): void {
    const zone = cameraHeight > STRATEGIC_HEIGHT
      ? ViewZone.Strategic
      : cameraHeight > TACTICAL_HEIGHT
        ? ViewZone.Tactical
        : ViewZone.Detail;

    const cameraMoved = Math.abs(cameraX - this.lastCameraX) > 50
      || Math.abs(cameraZ - this.lastCameraZ) > 50;

    if (zone !== this.currentZone) {
      this.rebuildMeshes(zone, cameraX, cameraZ);
      this.updateBuildings(zone, cameraX, cameraZ);
      this.currentZone = zone;
      this.lastCameraX = cameraX;
      this.lastCameraZ = cameraZ;
    } else if (zone !== ViewZone.Strategic && cameraMoved) {
      this.updateInstanceVisibility(zone, cameraX, cameraZ);
      if (zone === ViewZone.Detail) {
        this.updateBuildings(zone, cameraX, cameraZ);
      }
      this.lastCameraX = cameraX;
      this.lastCameraZ = cameraZ;
    }
  }

  /**
   * Show/hide building clusters based on zoom level and camera position.
   */
  private updateBuildings(zone: ViewZone, cameraX: number, cameraZ: number): void {
    if (zone !== ViewZone.Detail) {
      if (this.buildingsVisible) {
        this.buildingRenderer.setVisible(false);
        this.buildingsVisible = false;
      }
      return;
    }

    // Collect buildings for nearby cities
    const allBuildings: PlacedBuilding[] = [];
    const rangeSq = DETAIL_RANGE * DETAIL_RANGE;

    for (const c of this.allCities) {
      const pos = this.cityWorldPositions.get(c.id);
      if (!pos) continue;
      const dx = pos.x - cameraX;
      const dz = pos.z - cameraZ;
      if (dx * dx + dz * dz > rangeSq) continue;

      // Get or generate layout
      let layout = this.buildingLayouts.get(c.id);
      if (!layout) {
        layout = generateCityLayout(
          c.id, c.tier, c.culture,
          pos.x, pos.z, MARKER_Y,
        );
        this.buildingLayouts.set(c.id, layout);
      }

      allBuildings.push(...layout);
    }

    this.buildingRenderer.rebuild(allBuildings);
    this.buildingRenderer.setVisible(true);
    this.buildingsVisible = true;
  }

  raycast(raycaster: THREE.Raycaster): CityData | null {
    const intersections: THREE.Intersection[] = [];
    this.group.raycast(raycaster, intersections);

    if (intersections.length === 0) {
      return null;
    }

    // Find closest intersection
    let closest: THREE.Intersection | undefined;
    for (const hit of intersections) {
      if (!closest || hit.distance < closest.distance) {
        closest = hit;
      }
    }

    if (!closest) {
      return null;
    }

    // Walk up to find the InstancedMesh and get instance ID
    const mesh = closest.object;
    if (mesh instanceof THREE.InstancedMesh && closest.instanceId !== undefined) {
      const cityData = mesh.userData['cityMap'] as Record<number, CityData> | undefined;
      if (cityData) {
        const city = cityData[closest.instanceId];
        return city ?? null;
      }
    }

    return null;
  }

  dispose(): void {
    this.clearAllMeshes();
    this.buildingRenderer.dispose();

    // Dispose shared geometries
    for (const [, geo] of this.diamondGeos) {
      geo.dispose();
    }
    for (const [, geo] of this.octaGeos) {
      geo.dispose();
    }
    this.glowGeo.dispose();

    // Dispose shared materials
    this.strategicMaterial.dispose();
    this.tacticalMaterial.dispose();
    this.glowMaterial.dispose();

    this.scene.remove(this.group);
  }

  // ── Internal mesh management ────────────────────────────────

  private clearAllMeshes(): void {
    for (const [, set] of this.cultureSets) {
      this.disposeInstancedMesh(set.strategicMesh);
      this.disposeInstancedMesh(set.tacticalMesh);
      this.disposeInstancedMesh(set.glowLines);
      (set as { strategicMesh: THREE.InstancedMesh | null }).strategicMesh = null;
      (set as { tacticalMesh: THREE.InstancedMesh | null }).tacticalMesh = null;
      (set as { glowLines: THREE.InstancedMesh | null }).glowLines = null;
    }
    // Remove all children from group
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      if (child) {
        this.group.remove(child);
      }
    }
  }

  private disposeInstancedMesh(mesh: THREE.InstancedMesh | null): void {
    if (mesh) {
      // Geometry is shared, don't dispose it here
      // Material is shared, don't dispose it here
      if (mesh.parent) {
        mesh.parent.remove(mesh);
      }
    }
  }

  private rebuildMeshes(zone: ViewZone, cameraX: number, cameraZ: number): void {
    this.clearAllMeshes();

    for (const [, set] of this.cultureSets) {
      const filteredCities = this.filterCitiesByZone(set.cities, zone, cameraX, cameraZ);
      if (filteredCities.length === 0) continue;

      switch (zone) {
        case ViewZone.Strategic:
          this.buildStrategicMeshes(set, filteredCities);
          break;
        case ViewZone.Tactical:
          this.buildTacticalMeshes(set, filteredCities);
          break;
        case ViewZone.Detail:
          this.buildDetailMeshes(set, filteredCities);
          break;
      }
    }
  }

  private filterCitiesByZone(
    cities: readonly CityData[],
    zone: ViewZone,
    cameraX: number,
    cameraZ: number,
  ): CityData[] {
    if (zone === ViewZone.Strategic) {
      // Show all cities at strategic zoom
      return [...cities];
    }

    const range = zone === ViewZone.Tactical ? TACTICAL_RANGE : DETAIL_RANGE;
    const rangeSq = range * range;

    const result: CityData[] = [];
    for (const c of cities) {
      const pos = this.cityWorldPositions.get(c.id);
      if (!pos) continue;
      const dx = pos.x - cameraX;
      const dz = pos.z - cameraZ;
      if (dx * dx + dz * dz <= rangeSq) {
        result.push(c);
      }
    }
    return result;
  }

  private buildStrategicMeshes(set: CultureMeshSet, cities: readonly CityData[]): void {
    // Group cities by tier for correct geometry sizing
    const byTier = this.groupByTier(cities);

    for (const [tier, tierCities] of byTier) {
      if (tierCities.length === 0) continue;

      const geo = this.diamondGeos.get(tier);
      if (!geo) continue;

      const mat = this.strategicMaterial.clone();
      mat.color.copy(set.color);

      const mesh = new THREE.InstancedMesh(geo, mat, tierCities.length);
      mesh.frustumCulled = false;

      const cityMap: Record<number, CityData> = {};

      for (let i = 0; i < tierCities.length; i++) {
        const c = tierCities[i];
        if (!c) continue;
        const pos = this.cityWorldPositions.get(c.id);
        if (!pos) continue;

        this._mat4.makeTranslation(pos.x, pos.y, pos.z);
        mesh.setMatrixAt(i, this._mat4);
        cityMap[i] = c;
      }

      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData['cityMap'] = cityMap;
      mesh.userData['culture'] = set.culture;

      this.group.add(mesh);

      // Store only the last tier mesh reference (the renderer mainly
      // needs the group for raycasting; individual references are
      // for potential future optimisations).
      (set as { strategicMesh: THREE.InstancedMesh | null }).strategicMesh = mesh;
    }
  }

  private buildTacticalMeshes(set: CultureMeshSet, cities: readonly CityData[]): void {
    const byTier = this.groupByTier(cities);

    for (const [tier, tierCities] of byTier) {
      if (tierCities.length === 0) continue;

      const geo = this.octaGeos.get(tier);
      if (!geo) continue;

      // Octahedron marker mesh
      const markerMat = this.tacticalMaterial.clone();
      markerMat.color.copy(set.color);

      const mesh = new THREE.InstancedMesh(geo, markerMat, tierCities.length);
      mesh.frustumCulled = false;

      const cityMap: Record<number, CityData> = {};

      for (let i = 0; i < tierCities.length; i++) {
        const c = tierCities[i];
        if (!c) continue;
        const pos = this.cityWorldPositions.get(c.id);
        if (!pos) continue;

        this._mat4.makeTranslation(pos.x, pos.y, pos.z);
        mesh.setMatrixAt(i, this._mat4);
        cityMap[i] = c;
      }

      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData['cityMap'] = cityMap;
      mesh.userData['culture'] = set.culture;

      this.group.add(mesh);
      (set as { tacticalMesh: THREE.InstancedMesh | null }).tacticalMesh = mesh;
    }

    // Glow lines for all cities in this culture set
    if (cities.length > 0) {
      const glowMat = this.glowMaterial.clone();
      glowMat.color.copy(set.color);

      const glowMesh = new THREE.InstancedMesh(this.glowGeo, glowMat, cities.length);
      glowMesh.frustumCulled = false;
      glowMesh.raycast = () => { /* glow lines are not pickable */ };

      for (let i = 0; i < cities.length; i++) {
        const c = cities[i];
        if (!c) continue;
        const pos = this.cityWorldPositions.get(c.id);
        if (!pos) continue;

        this._mat4.makeTranslation(pos.x, pos.y + 30, pos.z);
        glowMesh.setMatrixAt(i, this._mat4);
      }

      glowMesh.instanceMatrix.needsUpdate = true;
      this.group.add(glowMesh);
      (set as { glowLines: THREE.InstancedMesh | null }).glowLines = glowMesh;
    }
  }

  private buildDetailMeshes(set: CultureMeshSet, cities: readonly CityData[]): void {
    // In detail view use the octahedron geometry scaled up slightly
    const byTier = this.groupByTier(cities);

    for (const [tier, tierCities] of byTier) {
      if (tierCities.length === 0) continue;

      const geo = this.octaGeos.get(tier);
      if (!geo) continue;

      const mat = this.tacticalMaterial.clone();
      mat.color.copy(set.color);
      mat.opacity = 1.0;

      const mesh = new THREE.InstancedMesh(geo, mat, tierCities.length);
      mesh.frustumCulled = false;

      const cityMap: Record<number, CityData> = {};
      const scaleFactor = 1.5;

      for (let i = 0; i < tierCities.length; i++) {
        const c = tierCities[i];
        if (!c) continue;
        const pos = this.cityWorldPositions.get(c.id);
        if (!pos) continue;

        this._mat4.makeTranslation(pos.x, pos.y, pos.z);
        this._mat4.scale(this._vec3.set(scaleFactor, scaleFactor, scaleFactor));
        mesh.setMatrixAt(i, this._mat4);
        cityMap[i] = c;
      }

      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData['cityMap'] = cityMap;
      mesh.userData['culture'] = set.culture;

      this.group.add(mesh);
      (set as { tacticalMesh: THREE.InstancedMesh | null }).tacticalMesh = mesh;
    }

    // Glow lines in detail view too
    if (cities.length > 0) {
      const glowMat = this.glowMaterial.clone();
      glowMat.color.copy(set.color);
      glowMat.opacity = 0.6;

      const glowMesh = new THREE.InstancedMesh(this.glowGeo, glowMat, cities.length);
      glowMesh.frustumCulled = false;
      glowMesh.raycast = () => { /* not pickable */ };

      for (let i = 0; i < cities.length; i++) {
        const c = cities[i];
        if (!c) continue;
        const pos = this.cityWorldPositions.get(c.id);
        if (!pos) continue;

        this._mat4.makeTranslation(pos.x, pos.y + 30, pos.z);
        glowMesh.setMatrixAt(i, this._mat4);
      }

      glowMesh.instanceMatrix.needsUpdate = true;
      this.group.add(glowMesh);
      (set as { glowLines: THREE.InstancedMesh | null }).glowLines = glowMesh;
    }
  }

  private updateInstanceVisibility(
    zone: ViewZone,
    cameraX: number,
    cameraZ: number,
  ): void {
    // Rebuild meshes with new camera position for range filtering
    this.rebuildMeshes(zone, cameraX, cameraZ);
  }

  // ── Utilities ───────────────────────────────────────────────

  private groupByTier(cities: readonly CityData[]): Map<CityTier, CityData[]> {
    const map = new Map<CityTier, CityData[]>();
    for (const c of cities) {
      const arr = map.get(c.tier);
      if (arr) {
        arr.push(c);
      } else {
        map.set(c.tier, [c]);
      }
    }
    return map;
  }
}
