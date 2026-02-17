/**
 * Road and sea trade route renderer for the Roman Empire voxel world.
 *
 * Renders two types of connections between cities:
 *   1. Land roads  -- warm brown dashed lines connecting nearby cities
 *   2. Sea routes  -- blue dashed lines connecting port cities across water
 *
 * Both use THREE.LineSegments with LineDashedMaterial for efficient rendering.
 * Total draw calls: 2 (one for roads, one for sea routes).
 *
 * Visibility is camera-height dependent:
 *   - Roads visible when camera height < 2000
 *   - Sea routes visible when camera height < 3000
 *
 * Road generation:
 *   - Cities within 200 tile units are connected by land roads
 *   - Port cities within 400 tile units are connected by sea routes
 *   - Duplicate edges are avoided (A->B but not B->A)
 *
 * Land roads sit at y=40 (slightly above average terrain).
 * Sea routes sit at y=WATER_LEVEL (water surface level, spec §5).
 */

import * as THREE from 'three';
import { MAP_SIZE, WATER_LEVEL } from '../config';
import { CITY_DATABASE } from './cityDatabase';
import { sampleHeight, hasHeightmap } from './heightmapLoader';
import type { CityData } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum tile distance between cities to create a road connection. */
const ROAD_MAX_DISTANCE = 200;

/** Maximum tile distance between port cities to create a sea route. */
const SEA_ROUTE_MAX_DISTANCE = 400;

/** Fallback Y for land roads when heightmap is not available. */
const ROAD_Y_FALLBACK = 40;

/** Small offset above terrain to prevent z-fighting. */
const ROAD_HEIGHT_OFFSET = 2;

/** Y position for sea routes (at water surface). */
const SEA_ROUTE_Y = WATER_LEVEL;

/** Camera height below which land roads become visible. */
const ROAD_VISIBILITY_HEIGHT = 2000;

/** Camera height below which sea routes become visible. */
const SEA_ROUTE_VISIBILITY_HEIGHT = 3000;

/** Half the map size for world-space coordinate conversion. */
const HALF_MAP = MAP_SIZE / 2;

/** Road material color -- warm brown reminiscent of Roman stone roads. */
const ROAD_COLOR = 0x8B7355;

/** Sea route material color -- Mediterranean blue. */
const SEA_ROUTE_COLOR = 0x4488CC;

// ---------------------------------------------------------------------------
// Edge types
// ---------------------------------------------------------------------------

interface CityEdge {
  ax: number;
  az: number;
  ay: number;
  bx: number;
  bz: number;
  by: number;
}

// ---------------------------------------------------------------------------
// Road/Route Generation
// ---------------------------------------------------------------------------

/** Get terrain height at tile coordinates, with offset above surface. */
function terrainY(tileX: number, tileY: number): number {
  if (!hasHeightmap()) return ROAD_Y_FALLBACK;
  const h = sampleHeight(tileX, tileY);
  return (h ?? ROAD_Y_FALLBACK) + ROAD_HEIGHT_OFFSET;
}

/**
 * Build land road edges between cities within ROAD_MAX_DISTANCE tile units.
 * Uses squared distance to avoid sqrt per pair.
 * Roads follow terrain height at each endpoint.
 */
function generateRoadEdges(cities: readonly CityData[]): CityEdge[] {
  const edges: CityEdge[] = [];
  const maxDistSq = ROAD_MAX_DISTANCE * ROAD_MAX_DISTANCE;

  for (let i = 0; i < cities.length; i++) {
    const a = cities[i]!;
    for (let j = i + 1; j < cities.length; j++) {
      const b = cities[j]!;
      const dx = a.tileX - b.tileX;
      const dy = a.tileY - b.tileY;
      const distSq = dx * dx + dy * dy;

      if (distSq <= maxDistSq) {
        edges.push({
          ax: a.tileX - HALF_MAP,
          az: a.tileY - HALF_MAP,
          ay: terrainY(a.tileX, a.tileY),
          bx: b.tileX - HALF_MAP,
          bz: b.tileY - HALF_MAP,
          by: terrainY(b.tileX, b.tileY),
        });
      }
    }
  }

  return edges;
}

/**
 * Build sea trade route edges between port cities within
 * SEA_ROUTE_MAX_DISTANCE tile units.
 */
function generateSeaRouteEdges(cities: readonly CityData[]): CityEdge[] {
  const ports = cities.filter((c) => c.isPort);
  const edges: CityEdge[] = [];
  const maxDistSq = SEA_ROUTE_MAX_DISTANCE * SEA_ROUTE_MAX_DISTANCE;

  for (let i = 0; i < ports.length; i++) {
    const a = ports[i]!;
    for (let j = i + 1; j < ports.length; j++) {
      const b = ports[j]!;
      const dx = a.tileX - b.tileX;
      const dy = a.tileY - b.tileY;
      const distSq = dx * dx + dy * dy;

      if (distSq <= maxDistSq) {
        edges.push({
          ax: a.tileX - HALF_MAP,
          az: a.tileY - HALF_MAP,
          ay: SEA_ROUTE_Y,
          bx: b.tileX - HALF_MAP,
          bz: b.tileY - HALF_MAP,
          by: SEA_ROUTE_Y,
        });
      }
    }
  }

  return edges;
}

/**
 * Convert an array of edges into a Float32Array of interleaved line segment
 * vertices (each edge = 2 vertices = 6 floats).
 */
function edgesToPositions(edges: readonly CityEdge[]): Float32Array {
  const positions = new Float32Array(edges.length * 6);
  let offset = 0;

  for (const edge of edges) {
    positions[offset++] = edge.ax;
    positions[offset++] = edge.ay;
    positions[offset++] = edge.az;
    positions[offset++] = edge.bx;
    positions[offset++] = edge.by;
    positions[offset++] = edge.bz;
  }

  return positions;
}

// ---------------------------------------------------------------------------
// RoadRenderer
// ---------------------------------------------------------------------------

export class RoadRenderer {
  private readonly scene: THREE.Scene;
  private readonly group: THREE.Group;

  /** Land road line segments mesh. */
  private roadLines: THREE.LineSegments | null = null;
  /** Sea trade route line segments mesh. */
  private seaLines: THREE.LineSegments | null = null;

  /** Materials (kept for disposal). */
  private roadMaterial: THREE.LineDashedMaterial | null = null;
  private seaMaterial: THREE.LineDashedMaterial | null = null;

  /** Geometries (kept for disposal). */
  private roadGeometry: THREE.BufferGeometry | null = null;
  private seaGeometry: THREE.BufferGeometry | null = null;

  /** Current visibility state to avoid redundant toggling. */
  private roadsVisible = false;
  private seaRoutesVisible = false;

  /** Edge counts for diagnostics. */
  private roadEdgeCount = 0;
  private seaEdgeCount = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'RoadsAndRoutes';
    this.scene.add(this.group);

    this.buildRoads();
    this.buildSeaRoutes();
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Update visibility based on camera height.
   * Roads appear when close enough to see detail; sea routes are visible
   * from slightly higher to give strategic overview of trade networks.
   */
  update(cameraHeight: number, _cameraX: number, _cameraZ: number): void {
    const shouldShowRoads = cameraHeight < ROAD_VISIBILITY_HEIGHT;
    const shouldShowSea = cameraHeight < SEA_ROUTE_VISIBILITY_HEIGHT;

    if (shouldShowRoads !== this.roadsVisible) {
      if (this.roadLines) {
        this.roadLines.visible = shouldShowRoads;
      }
      this.roadsVisible = shouldShowRoads;
    }

    if (shouldShowSea !== this.seaRoutesVisible) {
      if (this.seaLines) {
        this.seaLines.visible = shouldShowSea;
      }
      this.seaRoutesVisible = shouldShowSea;
    }
  }

  /** Number of land road edges. */
  get roadCount(): number {
    return this.roadEdgeCount;
  }

  /** Number of sea trade route edges. */
  get seaRouteCount(): number {
    return this.seaEdgeCount;
  }

  dispose(): void {
    if (this.roadLines) {
      this.group.remove(this.roadLines);
    }
    if (this.seaLines) {
      this.group.remove(this.seaLines);
    }

    this.roadGeometry?.dispose();
    this.seaGeometry?.dispose();
    this.roadMaterial?.dispose();
    this.seaMaterial?.dispose();

    this.roadLines = null;
    this.seaLines = null;
    this.roadGeometry = null;
    this.seaGeometry = null;
    this.roadMaterial = null;
    this.seaMaterial = null;

    this.scene.remove(this.group);
  }

  // ── Internal ────────────────────────────────────────────────────

  private buildRoads(): void {
    const edges = generateRoadEdges(CITY_DATABASE);
    this.roadEdgeCount = edges.length;

    if (edges.length === 0) return;

    const positions = edgesToPositions(edges);

    this.roadGeometry = new THREE.BufferGeometry();
    this.roadGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3),
    );

    this.roadMaterial = new THREE.LineDashedMaterial({
      color: ROAD_COLOR,
      dashSize: 8,
      gapSize: 4,
      linewidth: 1,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });

    this.roadLines = new THREE.LineSegments(this.roadGeometry, this.roadMaterial);
    this.roadLines.computeLineDistances();
    this.roadLines.frustumCulled = false;
    this.roadLines.visible = false;
    this.roadLines.name = 'LandRoads';

    this.group.add(this.roadLines);
  }

  private buildSeaRoutes(): void {
    const edges = generateSeaRouteEdges(CITY_DATABASE);
    this.seaEdgeCount = edges.length;

    if (edges.length === 0) return;

    const positions = edgesToPositions(edges);

    this.seaGeometry = new THREE.BufferGeometry();
    this.seaGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3),
    );

    this.seaMaterial = new THREE.LineDashedMaterial({
      color: SEA_ROUTE_COLOR,
      dashSize: 12,
      gapSize: 8,
      linewidth: 1,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });

    this.seaLines = new THREE.LineSegments(this.seaGeometry, this.seaMaterial);
    this.seaLines.computeLineDistances();
    this.seaLines.frustumCulled = false;
    this.seaLines.visible = false;
    this.seaLines.name = 'SeaTradeRoutes';

    this.group.add(this.seaLines);
  }
}
