/**
 * Voxel-style tree instance rendering system.
 *
 * Renders MagicaVoxel-style blocky trees (Mediterranean Pine, Oak, Olive)
 * via InstancedMesh for minimal draw calls. Trees are placed on FOREST,
 * DENSE_FOREST, and OLIVE_GROVE biome tiles using deterministic hashing.
 *
 * Tree positions are accumulated from chunk data as chunks load (same
 * accumulation pattern as ProvinceRenderer). Camera-distance culling and
 * instance caps keep the GPU budget tight.
 *
 * Two InstancedMesh draw calls total: one for trunk boxes, one for canopy
 * boxes -- but we merge trunk+canopy into a single geometry per variant
 * and use a single InstancedMesh with vertex colors, so it is actually
 * one draw call.
 */

import * as THREE from 'three';
import { CHUNK_SIZE, MAP_SIZE, WATER_LEVEL } from '../config';
import { BiomeType } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum terrain height at which trees can grow. */
const MAX_TREE_HEIGHT = 70;

/** Camera movement threshold before triggering a rebuild (world units). */
const CAMERA_MOVE_THRESHOLD = 30;

/** Default maximum visible tree instances. */
const DEFAULT_MAX_INSTANCES = 8000;

// ---------------------------------------------------------------------------
// Tree variant enum
// ---------------------------------------------------------------------------

const enum TreeVariant {
  MEDITERRANEAN_PINE = 0,
  OAK = 1,
  OLIVE = 2,
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const TRUNK_COLOR = new THREE.Color(0x5a3a1a);
const TRUNK_COLOR_ALT = new THREE.Color(0x6a4a2a);
const PINE_CANOPY_COLOR = new THREE.Color(0x2a5420);
const OAK_CANOPY_COLOR = new THREE.Color(0x3d6b2e);
const OLIVE_CANOPY_COLOR = new THREE.Color(0x5a7a3a);

// ---------------------------------------------------------------------------
// Deterministic hash
// ---------------------------------------------------------------------------

/**
 * Simple deterministic integer hash from two tile coordinates.
 * Returns a value in [0, 1).
 */
function tileHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = (h * 1274126177) | 0;
  h = (h ^ (h >> 16)) | 0;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Internal tree position record
// ---------------------------------------------------------------------------

interface TreePosition {
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
  readonly variant: TreeVariant;
}

// ---------------------------------------------------------------------------
// Geometry builders -- merged trunk + canopy with baked vertex colors
// ---------------------------------------------------------------------------

/**
 * Build a merged BoxGeometry (trunk + canopy) with per-vertex colors baked in.
 * Returns a non-indexed BufferGeometry ready for InstancedMesh.
 */
function buildTreeGeometry(
  trunkW: number,
  trunkH: number,
  trunkD: number,
  canopyW: number,
  canopyH: number,
  canopyD: number,
  canopyOffsetY: number,
  trunkColor: THREE.Color,
  canopyColor: THREE.Color,
): THREE.BufferGeometry {
  // Create trunk box at origin, bottom at Y=0
  const trunk = new THREE.BoxGeometry(trunkW, trunkH, trunkD);
  trunk.translate(0, trunkH / 2, 0);

  // Create canopy box offset above trunk
  const canopy = new THREE.BoxGeometry(canopyW, canopyH, canopyD);
  canopy.translate(0, canopyOffsetY + canopyH / 2, 0);

  // Bake vertex colors into each geometry before merging
  const trunkVerts = trunk.getAttribute('position');
  const canopyVerts = canopy.getAttribute('position');

  if (!trunkVerts || !canopyVerts) {
    throw new Error('Failed to create tree geometry attributes');
  }

  const trunkColors = new Float32Array(trunkVerts.count * 3);
  for (let i = 0; i < trunkVerts.count; i++) {
    trunkColors[i * 3] = trunkColor.r;
    trunkColors[i * 3 + 1] = trunkColor.g;
    trunkColors[i * 3 + 2] = trunkColor.b;
  }
  trunk.setAttribute('color', new THREE.BufferAttribute(trunkColors, 3));

  const canopyColors = new Float32Array(canopyVerts.count * 3);
  for (let i = 0; i < canopyVerts.count; i++) {
    canopyColors[i * 3] = canopyColor.r;
    canopyColors[i * 3 + 1] = canopyColor.g;
    canopyColors[i * 3 + 2] = canopyColor.b;
  }
  canopy.setAttribute('color', new THREE.BufferAttribute(canopyColors, 3));

  // Merge into single geometry
  const merged = mergeBufferGeometries(trunk, canopy);

  trunk.dispose();
  canopy.dispose();

  return merged;
}

/**
 * Merge two non-indexed BufferGeometries into one.
 * Both must have position, normal, and color attributes.
 */
function mergeBufferGeometries(
  a: THREE.BufferGeometry,
  b: THREE.BufferGeometry,
): THREE.BufferGeometry {
  // Convert to non-indexed if needed
  const geomA = a.index ? a.toNonIndexed() : a;
  const geomB = b.index ? b.toNonIndexed() : b;

  const posA = geomA.getAttribute('position') as THREE.BufferAttribute;
  const posB = geomB.getAttribute('position') as THREE.BufferAttribute;
  const nrmA = geomA.getAttribute('normal') as THREE.BufferAttribute;
  const nrmB = geomB.getAttribute('normal') as THREE.BufferAttribute;
  const colA = geomA.getAttribute('color') as THREE.BufferAttribute;
  const colB = geomB.getAttribute('color') as THREE.BufferAttribute;

  const totalVerts = posA.count + posB.count;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);

  positions.set(new Float32Array(posA.array), 0);
  positions.set(new Float32Array(posB.array), posA.count * 3);

  normals.set(new Float32Array(nrmA.array), 0);
  normals.set(new Float32Array(nrmB.array), nrmA.count * 3);

  colors.set(new Float32Array(colA.array), 0);
  colors.set(new Float32Array(colB.array), colA.count * 3);

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Dispose intermediate non-indexed copies only if they differ from input
  if (geomA !== a) geomA.dispose();
  if (geomB !== b) geomB.dispose();

  return merged;
}

// ---------------------------------------------------------------------------
// Pre-built variant geometries (lazy-initialized singleton)
// ---------------------------------------------------------------------------

let pineGeometry: THREE.BufferGeometry | null = null;
let oakGeometry: THREE.BufferGeometry | null = null;
let oliveGeometry: THREE.BufferGeometry | null = null;

function getPineGeometry(): THREE.BufferGeometry {
  if (!pineGeometry) {
    // Mediterranean Pine: tall thin trunk (1x4x1) + flat wide canopy (3x1x3)
    pineGeometry = buildTreeGeometry(
      1, 4, 1,     // trunk
      3, 1, 3,     // canopy
      4,           // canopy Y offset (on top of trunk)
      TRUNK_COLOR,
      PINE_CANOPY_COLOR,
    );
  }
  return pineGeometry;
}

function getOakGeometry(): THREE.BufferGeometry {
  if (!oakGeometry) {
    // Oak: short trunk (1x2x1) + rounded-ish canopy (2x2x2)
    oakGeometry = buildTreeGeometry(
      1, 2, 1,     // trunk
      2, 2, 2,     // canopy
      2,           // canopy Y offset
      TRUNK_COLOR_ALT,
      OAK_CANOPY_COLOR,
    );
  }
  return oakGeometry;
}

function getOliveGeometry(): THREE.BufferGeometry {
  if (!oliveGeometry) {
    // Olive: very short trunk (1x1x1) + wide low canopy (3x1x2)
    oliveGeometry = buildTreeGeometry(
      1, 1, 1,     // trunk
      3, 1, 2,     // canopy
      1,           // canopy Y offset
      TRUNK_COLOR,
      OLIVE_CANOPY_COLOR,
    );
  }
  return oliveGeometry;
}

// ---------------------------------------------------------------------------
// Shared material (vertex-colored, flat-shaded, matches chunk material style)
// ---------------------------------------------------------------------------

const TREE_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.95,
  metalness: 0.02,
  side: THREE.FrontSide,
});

// ---------------------------------------------------------------------------
// TreeRenderer
// ---------------------------------------------------------------------------

export class TreeRenderer {
  private readonly scene: THREE.Scene;

  /** All accumulated tree positions from loaded chunks. */
  private readonly allTrees: TreePosition[] = [];

  /** Tracks which chunks have already contributed trees. */
  private readonly loadedChunks: Set<string> = new Set();

  /** Current InstancedMesh instances (one per variant). */
  private pineMesh: THREE.InstancedMesh | null = null;
  private oakMesh: THREE.InstancedMesh | null = null;
  private oliveMesh: THREE.InstancedMesh | null = null;

  /** Maximum visible tree instances (across all variants). */
  private maxInstances: number = DEFAULT_MAX_INSTANCES;

  /** Dirty flag: set when new chunk data arrives or maxInstances changes. */
  private dirty = true;

  /** Last camera position used for the rebuild check. */
  private lastCamX = -99999;
  private lastCamY = -99999;
  private lastCamZ = -99999;

  /** Pre-allocated objects to avoid per-frame GC. */
  private readonly tmpMatrix: THREE.Matrix4 = new THREE.Matrix4();
  private readonly tmpPosition: THREE.Vector3 = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Extract tree positions from chunk tile data and store internally.
   * Call this as each chunk loads (mirrors ProvinceRenderer pattern).
   */
  updateChunkTrees(
    cx: number,
    cy: number,
    heights: Uint8Array,
    biomes: Uint8Array,
  ): void {
    const chunkKey = `${cx},${cy}`;
    if (this.loadedChunks.has(chunkKey)) return;
    this.loadedChunks.add(chunkKey);

    const startTileX = cx * CHUNK_SIZE;
    const startTileY = cy * CHUNK_SIZE;
    const halfMap = MAP_SIZE / 2;

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const localIndex = ly * CHUNK_SIZE + lx;
        const biome = biomes[localIndex];
        const height = heights[localIndex];

        if (biome === undefined || height === undefined) continue;

        // Only place trees on forest biomes
        const isForest = biome === BiomeType.FOREST;
        const isDense = biome === BiomeType.DENSE_FOREST;
        const isOlive = biome === BiomeType.OLIVE_GROVE;

        if (!isForest && !isDense && !isOlive) continue;

        // Height constraints
        if (height < WATER_LEVEL || height > MAX_TREE_HEIGHT) continue;

        // Density: one tree per 2x2 area for normal, 1x1 for dense
        if (!isDense) {
          const tileX = startTileX + lx;
          const tileY = startTileY + ly;
          // Only place on even-grid tiles for 2x2 spacing
          if ((tileX & 1) !== 0 || (tileY & 1) !== 0) continue;
        }

        const tileX = startTileX + lx;
        const tileY = startTileY + ly;

        // Deterministic jitter +/-0.3 tiles from grid center
        const jitterX = (tileHash(tileX, tileY) - 0.5) * 0.6;
        const jitterZ = (tileHash(tileY, tileX) - 0.5) * 0.6;

        // World coordinates (matching chunkLoader.ts positioning)
        const worldX = tileX - halfMap + jitterX;
        const worldZ = tileY - halfMap + jitterZ;
        const worldY = height;

        // Variant selection: olive biome always gets olive trees,
        // otherwise deterministic choice between pine and oak
        let variant: TreeVariant;
        if (isOlive) {
          variant = TreeVariant.OLIVE;
        } else {
          const variantHash = tileHash(tileX * 3, tileY * 7);
          variant = variantHash < 0.5
            ? TreeVariant.MEDITERRANEAN_PINE
            : TreeVariant.OAK;
        }

        this.allTrees.push({ worldX, worldY, worldZ, variant });
      }
    }

    this.dirty = true;
  }

  /**
   * Per-frame update. Culls trees by camera distance and rebuilds
   * InstancedMesh if the camera has moved significantly or data changed.
   */
  update(cameraX: number, cameraY: number, cameraZ: number): void {
    // Camera height > 3000: hide all trees
    if (cameraY > 3000) {
      this.hideAll();
      return;
    }

    // Determine visibility radius based on camera height
    let visRadius: number;
    if (cameraY < 300) {
      visRadius = 200;
    } else if (cameraY < 1500) {
      visRadius = 800;
    } else {
      visRadius = 400;
    }

    // Check if we need to rebuild
    const dx = cameraX - this.lastCamX;
    const dy = cameraY - this.lastCamY;
    const dz = cameraZ - this.lastCamZ;
    const camMoved = dx * dx + dy * dy + dz * dz > CAMERA_MOVE_THRESHOLD * CAMERA_MOVE_THRESHOLD;

    if (!camMoved && !this.dirty) {
      this.showAll();
      return;
    }

    this.lastCamX = cameraX;
    this.lastCamY = cameraY;
    this.lastCamZ = cameraZ;
    this.dirty = false;

    this.rebuildInstances(cameraX, cameraZ, visRadius);
  }

  /**
   * Dispose all GPU resources.
   */
  dispose(): void {
    this.disposeMeshes();
    // Dispose singleton geometries
    if (pineGeometry) { pineGeometry.dispose(); pineGeometry = null; }
    if (oakGeometry) { oakGeometry.dispose(); oakGeometry = null; }
    if (oliveGeometry) { oliveGeometry.dispose(); oliveGeometry = null; }
  }

  // ── Internal ──────────────────────────────────────────────────

  /**
   * Rebuild all three InstancedMesh objects from the tree pool,
   * filtered by distance to camera and capped at maxInstances.
   */
  private rebuildInstances(
    camX: number,
    camZ: number,
    visRadius: number,
  ): void {
    const visRadiusSq = visRadius * visRadius;

    // Collect candidates within visibility radius
    const candidates: Array<{ tree: TreePosition; distSq: number }> = [];

    for (let i = 0; i < this.allTrees.length; i++) {
      const tree = this.allTrees[i];
      if (!tree) continue;

      const dx = tree.worldX - camX;
      const dz = tree.worldZ - camZ;
      const distSq = dx * dx + dz * dz;

      if (distSq <= visRadiusSq) {
        candidates.push({ tree, distSq });
      }
    }

    // Sort by distance (closest first)
    candidates.sort((a, b) => a.distSq - b.distSq);

    // Cap to maxInstances total
    const maxTotal = this.maxInstances;
    const visible = candidates.length > maxTotal
      ? candidates.slice(0, maxTotal)
      : candidates;

    // Count per variant
    let pineCount = 0;
    let oakCount = 0;
    let oliveCount = 0;

    for (let i = 0; i < visible.length; i++) {
      const entry = visible[i];
      if (!entry) continue;
      switch (entry.tree.variant) {
        case TreeVariant.MEDITERRANEAN_PINE: pineCount++; break;
        case TreeVariant.OAK: oakCount++; break;
        case TreeVariant.OLIVE: oliveCount++; break;
      }
    }

    // Dispose old meshes
    this.disposeMeshes();

    // Create new InstancedMesh per variant (only if count > 0)
    if (pineCount > 0) {
      this.pineMesh = new THREE.InstancedMesh(
        getPineGeometry(),
        TREE_MATERIAL,
        pineCount,
      );
      this.pineMesh.frustumCulled = false;
      this.scene.add(this.pineMesh);
    }

    if (oakCount > 0) {
      this.oakMesh = new THREE.InstancedMesh(
        getOakGeometry(),
        TREE_MATERIAL,
        oakCount,
      );
      this.oakMesh.frustumCulled = false;
      this.scene.add(this.oakMesh);
    }

    if (oliveCount > 0) {
      this.oliveMesh = new THREE.InstancedMesh(
        getOliveGeometry(),
        TREE_MATERIAL,
        oliveCount,
      );
      this.oliveMesh.frustumCulled = false;
      this.scene.add(this.oliveMesh);
    }

    // Fill instance matrices
    let pineIdx = 0;
    let oakIdx = 0;
    let oliveIdx = 0;

    for (let i = 0; i < visible.length; i++) {
      const entry = visible[i];
      if (!entry) continue;

      const { tree } = entry;
      this.tmpPosition.set(tree.worldX, tree.worldY, tree.worldZ);
      this.tmpMatrix.makeTranslation(this.tmpPosition.x, this.tmpPosition.y, this.tmpPosition.z);

      switch (tree.variant) {
        case TreeVariant.MEDITERRANEAN_PINE:
          if (this.pineMesh) {
            this.pineMesh.setMatrixAt(pineIdx, this.tmpMatrix);
            pineIdx++;
          }
          break;
        case TreeVariant.OAK:
          if (this.oakMesh) {
            this.oakMesh.setMatrixAt(oakIdx, this.tmpMatrix);
            oakIdx++;
          }
          break;
        case TreeVariant.OLIVE:
          if (this.oliveMesh) {
            this.oliveMesh.setMatrixAt(oliveIdx, this.tmpMatrix);
            oliveIdx++;
          }
          break;
      }
    }

    // Flag instance matrix buffers for upload
    if (this.pineMesh) this.pineMesh.instanceMatrix.needsUpdate = true;
    if (this.oakMesh) this.oakMesh.instanceMatrix.needsUpdate = true;
    if (this.oliveMesh) this.oliveMesh.instanceMatrix.needsUpdate = true;
  }

  /** Remove all InstancedMesh objects from the scene and release GPU resources. */
  private disposeMeshes(): void {
    if (this.pineMesh) {
      this.scene.remove(this.pineMesh);
      this.pineMesh.dispose();
      this.pineMesh = null;
    }
    if (this.oakMesh) {
      this.scene.remove(this.oakMesh);
      this.oakMesh.dispose();
      this.oakMesh = null;
    }
    if (this.oliveMesh) {
      this.scene.remove(this.oliveMesh);
      this.oliveMesh.dispose();
      this.oliveMesh = null;
    }
  }

  /** Hide all tree meshes (camera too high). */
  private hideAll(): void {
    if (this.pineMesh) this.pineMesh.visible = false;
    if (this.oakMesh) this.oakMesh.visible = false;
    if (this.oliveMesh) this.oliveMesh.visible = false;
  }

  /** Show all tree meshes. */
  private showAll(): void {
    if (this.pineMesh) this.pineMesh.visible = true;
    if (this.oakMesh) this.oakMesh.visible = true;
    if (this.oliveMesh) this.oliveMesh.visible = true;
  }
}
