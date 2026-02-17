/**
 * LOD-aware city renderer for the Roman Empire at 117 AD.
 *
 * Uses InstancedMesh per culture group with three view zones:
 *   Strategic (far)  - diamond markers for all cities
 *   Tactical (mid)   - octahedron markers + glow lines for nearby cities
 *   Detail (close)   - scaled octahedrons + glow + building clusters
 *
 * City data is imported from the separate cityData module.
 *
 * Performance: All InstancedMesh objects are pre-allocated once and kept alive.
 * Zone changes toggle mesh.visible. Camera movement within a zone updates
 * mesh.count and instance matrices in-place -- no teardown/rebuild.
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

// ── All valid tiers ─────────────────────────────────────────────

const ALL_TIERS: readonly CityTier[] = [1, 2, 3, 4];

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

// ── Mesh key for culture+tier combination ───────────────────────

function meshKey(culture: CultureType, tier: CityTier): string {
  return `${culture}:${tier}`;
}

// ── Pre-allocated mesh pair (strategic diamond + tactical/detail octahedron) ─

interface PreallocatedTierMesh {
  /** Diamond InstancedMesh for strategic view. */
  readonly strategic: THREE.InstancedMesh;
  /** Octahedron InstancedMesh for tactical view. */
  readonly tactical: THREE.InstancedMesh;
  /** Octahedron InstancedMesh for detail view (scaled 1.5x). */
  readonly detail: THREE.InstancedMesh;
  /** Cities of this culture+tier (fixed, known at init). */
  readonly cities: readonly CityData[];
  /** Max instance count (= cities.length). */
  readonly maxCount: number;
}

/** Pre-allocated glow lines mesh per culture. */
interface PreallocatedGlowMesh {
  /** Glow InstancedMesh for tactical view. */
  readonly tactical: THREE.InstancedMesh;
  /** Glow InstancedMesh for detail view (higher opacity). */
  readonly detail: THREE.InstancedMesh;
  /** All cities of this culture (flat, not per-tier). */
  readonly cities: readonly CityData[];
  /** Max instance count (= cities.length). */
  readonly maxCount: number;
}

// ── Per-culture set (kept for backward compat with CultureMeshSet fields) ───

interface CultureMeshSet {
  readonly culture: CultureType;
  readonly color: THREE.Color;
  readonly cities: readonly CityData[];
  // Legacy fields kept for reference; actual meshes live in preallocated maps.
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

  /** Pre-allocated InstancedMesh objects: one per culture+tier for strategic/tactical/detail. */
  private readonly tierMeshes: ReadonlyMap<string, PreallocatedTierMesh>;
  /** Pre-allocated glow line meshes: one per culture for tactical, one for detail. */
  private readonly glowMeshes: ReadonlyMap<CultureType, PreallocatedGlowMesh>;
  /** Cloned materials kept alive for the lifetime of the renderer. */
  private readonly clonedMaterials: THREE.Material[] = [];

  /** Whether lazy init of meshes has been performed. */
  private meshesInitialized = false;

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
    for (const t of ALL_TIERS) {
      const size = TIER_SIZES[t];
      dGeos.set(t, createDiamondGeometry(size));
      oGeos.set(t, createOctahedronGeometry(size));
    }
    this.diamondGeos = dGeos;
    this.octaGeos = oGeos;

    // Glow line geometry (thin tall cylinder)
    this.glowGeo = new THREE.CylinderGeometry(0.8, 0.8, 60, 4);

    // Base materials (cloned per culture during mesh allocation)
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

    // Pre-allocate all meshes (deferred to first update so the constructor stays fast;
    // the maps are assigned here with empty placeholders to satisfy readonly).
    this.tierMeshes = new Map();
    this.glowMeshes = new Map();
  }

  // ── Lazy mesh pre-allocation ──────────────────────────────────

  /**
   * Creates all InstancedMesh objects once and adds them to the group.
   * Called on first update(). After this, meshes are never destroyed until dispose().
   */
  private initMeshes(): void {
    if (this.meshesInitialized) return;
    this.meshesInitialized = true;

    const tierMeshes = this.tierMeshes as Map<string, PreallocatedTierMesh>;
    const glowMeshes = this.glowMeshes as Map<CultureType, PreallocatedGlowMesh>;

    for (const [culture, set] of this.cultureSets) {
      // Group cities by tier for this culture
      const byTier = this.groupByTier(set.cities);

      // --- Tier meshes (strategic diamond + tactical/detail octahedron) ---
      for (const tier of ALL_TIERS) {
        const tierCities = byTier.get(tier);
        if (!tierCities || tierCities.length === 0) continue;

        const maxCount = tierCities.length;
        const key = meshKey(culture, tier);

        const diamondGeo = this.diamondGeos.get(tier);
        const octaGeo = this.octaGeos.get(tier);
        if (!diamondGeo || !octaGeo) continue;

        // Clone materials once per culture+tier
        const strategicMat = this.strategicMaterial.clone();
        strategicMat.color.copy(set.color);
        this.clonedMaterials.push(strategicMat);

        const tacticalMat = this.tacticalMaterial.clone();
        tacticalMat.color.copy(set.color);
        this.clonedMaterials.push(tacticalMat);

        const detailMat = this.tacticalMaterial.clone();
        detailMat.color.copy(set.color);
        detailMat.opacity = 1.0;
        this.clonedMaterials.push(detailMat);

        // Strategic InstancedMesh (diamond geometry)
        const strategicIM = new THREE.InstancedMesh(diamondGeo, strategicMat, maxCount);
        strategicIM.frustumCulled = false;
        strategicIM.count = 0;
        strategicIM.visible = false;
        strategicIM.userData['culture'] = culture;

        // Tactical InstancedMesh (octahedron geometry)
        const tacticalIM = new THREE.InstancedMesh(octaGeo, tacticalMat, maxCount);
        tacticalIM.frustumCulled = false;
        tacticalIM.count = 0;
        tacticalIM.visible = false;
        tacticalIM.userData['culture'] = culture;

        // Detail InstancedMesh (octahedron geometry, scaled 1.5x)
        const detailIM = new THREE.InstancedMesh(octaGeo, detailMat, maxCount);
        detailIM.frustumCulled = false;
        detailIM.count = 0;
        detailIM.visible = false;
        detailIM.userData['culture'] = culture;

        this.group.add(strategicIM);
        this.group.add(tacticalIM);
        this.group.add(detailIM);

        tierMeshes.set(key, {
          strategic: strategicIM,
          tactical: tacticalIM,
          detail: detailIM,
          cities: tierCities,
          maxCount,
        });
      }

      // --- Glow line meshes (one per culture, not per tier) ---
      if (set.cities.length > 0) {
        const maxGlowCount = set.cities.length;

        const tacticalGlowMat = this.glowMaterial.clone();
        tacticalGlowMat.color.copy(set.color);
        this.clonedMaterials.push(tacticalGlowMat);

        const detailGlowMat = this.glowMaterial.clone();
        detailGlowMat.color.copy(set.color);
        detailGlowMat.opacity = 0.6;
        this.clonedMaterials.push(detailGlowMat);

        const tacticalGlowIM = new THREE.InstancedMesh(
          this.glowGeo, tacticalGlowMat, maxGlowCount,
        );
        tacticalGlowIM.frustumCulled = false;
        tacticalGlowIM.count = 0;
        tacticalGlowIM.visible = false;
        tacticalGlowIM.raycast = () => { /* glow lines are not pickable */ };

        const detailGlowIM = new THREE.InstancedMesh(
          this.glowGeo, detailGlowMat, maxGlowCount,
        );
        detailGlowIM.frustumCulled = false;
        detailGlowIM.count = 0;
        detailGlowIM.visible = false;
        detailGlowIM.raycast = () => { /* glow lines are not pickable */ };

        this.group.add(tacticalGlowIM);
        this.group.add(detailGlowIM);

        glowMeshes.set(culture, {
          tactical: tacticalGlowIM,
          detail: detailGlowIM,
          cities: set.cities,
          maxCount: maxGlowCount,
        });
      }
    }

    // Populate strategic meshes immediately (all cities, never changes)
    this.populateStrategicMeshes();
  }

  /**
   * Write instance matrices for ALL cities into strategic meshes.
   * This only runs once at init since strategic view shows every city.
   */
  private populateStrategicMeshes(): void {
    for (const [, entry] of this.tierMeshes) {
      const cityMap: Record<number, CityData> = {};

      for (let i = 0; i < entry.cities.length; i++) {
        const c = entry.cities[i];
        if (!c) continue;
        const pos = this.cityWorldPositions.get(c.id);
        if (!pos) continue;

        this._mat4.makeTranslation(pos.x, pos.y, pos.z);
        entry.strategic.setMatrixAt(i, this._mat4);
        cityMap[i] = c;
      }

      entry.strategic.count = entry.cities.length;
      entry.strategic.instanceMatrix.needsUpdate = true;
      entry.strategic.userData['cityMap'] = cityMap;
    }
  }

  // ── Public API ──────────────────────────────────────────────

  update(cameraHeight: number, cameraX: number, cameraZ: number): void {
    // Lazy init on first call
    if (!this.meshesInitialized) {
      this.initMeshes();
    }

    const zone = cameraHeight > STRATEGIC_HEIGHT
      ? ViewZone.Strategic
      : cameraHeight > TACTICAL_HEIGHT
        ? ViewZone.Tactical
        : ViewZone.Detail;

    const cameraMoved = Math.abs(cameraX - this.lastCameraX) > 50
      || Math.abs(cameraZ - this.lastCameraZ) > 50;

    if (zone !== this.currentZone) {
      // Zone changed: toggle mesh visibility, repopulate range-filtered meshes
      this.activateZone(zone, cameraX, cameraZ);
      this.updateBuildings(zone, cameraX, cameraZ);
      this.currentZone = zone;
      this.lastCameraX = cameraX;
      this.lastCameraZ = cameraZ;
    } else if (zone !== ViewZone.Strategic && cameraMoved) {
      // Camera moved within tactical/detail: update instance counts in-place
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

    // Dispose shared base materials
    this.strategicMaterial.dispose();
    this.tacticalMaterial.dispose();
    this.glowMaterial.dispose();

    // Dispose cloned materials
    for (const mat of this.clonedMaterials) {
      mat.dispose();
    }
    this.clonedMaterials.length = 0;

    this.scene.remove(this.group);
  }

  // ── Internal: zone activation (visibility toggling) ───────────

  /**
   * Activate a zone by toggling mesh.visible flags and populating
   * range-filtered instances for tactical/detail zones.
   * No InstancedMesh objects are created or destroyed.
   */
  private activateZone(zone: ViewZone, cameraX: number, cameraZ: number): void {
    // First hide everything
    this.hideAllMeshes();

    switch (zone) {
      case ViewZone.Strategic:
        this.showStrategicMeshes();
        break;
      case ViewZone.Tactical:
        this.populateTacticalMeshes(cameraX, cameraZ);
        this.showTacticalMeshes();
        break;
      case ViewZone.Detail:
        this.populateDetailMeshes(cameraX, cameraZ);
        this.showDetailMeshes();
        break;
    }
  }

  /**
   * Hide all pre-allocated meshes by setting visible = false.
   */
  private hideAllMeshes(): void {
    for (const [, entry] of this.tierMeshes) {
      entry.strategic.visible = false;
      entry.tactical.visible = false;
      entry.detail.visible = false;
    }
    for (const [, entry] of this.glowMeshes) {
      entry.tactical.visible = false;
      entry.detail.visible = false;
    }
  }

  private showStrategicMeshes(): void {
    for (const [, entry] of this.tierMeshes) {
      if (entry.strategic.count > 0) {
        entry.strategic.visible = true;
      }
    }
  }

  private showTacticalMeshes(): void {
    for (const [, entry] of this.tierMeshes) {
      if (entry.tactical.count > 0) {
        entry.tactical.visible = true;
      }
    }
    for (const [, entry] of this.glowMeshes) {
      if (entry.tactical.count > 0) {
        entry.tactical.visible = true;
      }
    }
  }

  private showDetailMeshes(): void {
    for (const [, entry] of this.tierMeshes) {
      if (entry.detail.count > 0) {
        entry.detail.visible = true;
      }
    }
    for (const [, entry] of this.glowMeshes) {
      if (entry.detail.count > 0) {
        entry.detail.visible = true;
      }
    }
  }

  // ── Internal: range-filtered mesh population ──────────────────

  /**
   * Populate tactical InstancedMesh instances for cities within TACTICAL_RANGE.
   * Updates mesh.count and cityMap in-place.
   */
  private populateTacticalMeshes(cameraX: number, cameraZ: number): void {
    const rangeSq = TACTICAL_RANGE * TACTICAL_RANGE;

    for (const [, entry] of this.tierMeshes) {
      const cityMap: Record<number, CityData> = {};
      let idx = 0;

      for (let i = 0; i < entry.cities.length; i++) {
        const c = entry.cities[i];
        if (!c) continue;
        const pos = this.cityWorldPositions.get(c.id);
        if (!pos) continue;

        const dx = pos.x - cameraX;
        const dz = pos.z - cameraZ;
        if (dx * dx + dz * dz > rangeSq) continue;

        this._mat4.makeTranslation(pos.x, pos.y, pos.z);
        entry.tactical.setMatrixAt(idx, this._mat4);
        cityMap[idx] = c;
        idx++;
      }

      entry.tactical.count = idx;
      if (idx > 0) {
        entry.tactical.instanceMatrix.needsUpdate = true;
      }
      entry.tactical.userData['cityMap'] = cityMap;
    }

    // Glow lines for tactical view
    for (const [, entry] of this.glowMeshes) {
      let idx = 0;

      for (let i = 0; i < entry.cities.length; i++) {
        const c = entry.cities[i];
        if (!c) continue;
        const pos = this.cityWorldPositions.get(c.id);
        if (!pos) continue;

        const dx = pos.x - cameraX;
        const dz = pos.z - cameraZ;
        if (dx * dx + dz * dz > rangeSq) continue;

        this._mat4.makeTranslation(pos.x, pos.y + 30, pos.z);
        entry.tactical.setMatrixAt(idx, this._mat4);
        idx++;
      }

      entry.tactical.count = idx;
      if (idx > 0) {
        entry.tactical.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /**
   * Populate detail InstancedMesh instances for cities within DETAIL_RANGE.
   * Uses 1.5x scale on octahedrons.
   */
  private populateDetailMeshes(cameraX: number, cameraZ: number): void {
    const rangeSq = DETAIL_RANGE * DETAIL_RANGE;
    const scaleFactor = 1.5;

    for (const [, entry] of this.tierMeshes) {
      const cityMap: Record<number, CityData> = {};
      let idx = 0;

      for (let i = 0; i < entry.cities.length; i++) {
        const c = entry.cities[i];
        if (!c) continue;
        const pos = this.cityWorldPositions.get(c.id);
        if (!pos) continue;

        const dx = pos.x - cameraX;
        const dz = pos.z - cameraZ;
        if (dx * dx + dz * dz > rangeSq) continue;

        this._mat4.makeTranslation(pos.x, pos.y, pos.z);
        this._mat4.scale(this._vec3.set(scaleFactor, scaleFactor, scaleFactor));
        entry.detail.setMatrixAt(idx, this._mat4);
        cityMap[idx] = c;
        idx++;
      }

      entry.detail.count = idx;
      if (idx > 0) {
        entry.detail.instanceMatrix.needsUpdate = true;
      }
      entry.detail.userData['cityMap'] = cityMap;
    }

    // Glow lines for detail view
    for (const [, entry] of this.glowMeshes) {
      let idx = 0;

      for (let i = 0; i < entry.cities.length; i++) {
        const c = entry.cities[i];
        if (!c) continue;
        const pos = this.cityWorldPositions.get(c.id);
        if (!pos) continue;

        const dx = pos.x - cameraX;
        const dz = pos.z - cameraZ;
        if (dx * dx + dz * dz > rangeSq) continue;

        this._mat4.makeTranslation(pos.x, pos.y + 30, pos.z);
        entry.detail.setMatrixAt(idx, this._mat4);
        idx++;
      }

      entry.detail.count = idx;
      if (idx > 0) {
        entry.detail.instanceMatrix.needsUpdate = true;
      }
    }
  }

  // ── Internal: in-place visibility update (hot path) ───────────

  /**
   * Called when the camera moves within tactical or detail zone.
   * Updates instance matrices and counts in-place without creating
   * or destroying any InstancedMesh objects.
   */
  private updateInstanceVisibility(
    zone: ViewZone,
    cameraX: number,
    cameraZ: number,
  ): void {
    if (zone === ViewZone.Tactical) {
      this.populateTacticalMeshes(cameraX, cameraZ);
      // Re-toggle visibility in case counts changed from 0 to >0 or vice versa
      for (const [, entry] of this.tierMeshes) {
        entry.tactical.visible = entry.tactical.count > 0;
      }
      for (const [, entry] of this.glowMeshes) {
        entry.tactical.visible = entry.tactical.count > 0;
      }
    } else if (zone === ViewZone.Detail) {
      this.populateDetailMeshes(cameraX, cameraZ);
      for (const [, entry] of this.tierMeshes) {
        entry.detail.visible = entry.detail.count > 0;
      }
      for (const [, entry] of this.glowMeshes) {
        entry.detail.visible = entry.detail.count > 0;
      }
    }
  }

  // ── Internal: cleanup (only for dispose) ──────────────────────

  /**
   * Removes all pre-allocated meshes from the group.
   * Only called from dispose() -- never during normal operation.
   */
  private clearAllMeshes(): void {
    // Remove all children from group
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      if (child) {
        this.group.remove(child);
      }
    }

    // Clear maps (mutable cast for cleanup)
    (this.tierMeshes as Map<string, PreallocatedTierMesh>).clear();
    (this.glowMeshes as Map<CultureType, PreallocatedGlowMesh>).clear();

    this.meshesInitialized = false;
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
