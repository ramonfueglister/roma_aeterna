/**
 * Voxel-style tree instance rendering system.
 *
 * Renders MagicaVoxel-style blocky trees (7 variants: Mediterranean Pine,
 * Oak, Olive, Cypress, Umbrella Pine, Date Palm, Cedar) via InstancedMesh
 * for minimal draw calls. Trees are placed on FOREST, DENSE_FOREST, and
 * OLIVE_GROVE biome tiles using deterministic hashing.
 *
 * Tree positions are accumulated from chunk data as chunks load (same
 * accumulation pattern as ProvinceRenderer). Camera-distance culling and
 * instance caps keep the GPU budget tight.
 *
 * Regional variant selection uses world Y coordinate as a latitude proxy
 * (low Y = northern Europe, high Y = southern Africa/Egypt) combined with
 * altitude for mountain cedar placement. Per-instance scale variation
 * (0.8-1.2x) adds visual diversity without additional draw calls.
 *
 * One InstancedMesh per variant (7 draw calls max), each with merged
 * trunk + canopy geometry and baked vertex colors.
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
  CYPRESS = 3,
  UMBRELLA_PINE = 4,
  DATE_PALM = 5,
  CEDAR = 6,
}

/** Total number of tree variants. */
const VARIANT_COUNT = 7;

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const TRUNK_COLOR = new THREE.Color(0x5a3a1a);
const TRUNK_COLOR_ALT = new THREE.Color(0x6a4a2a);
const TRUNK_COLOR_PALM = new THREE.Color(0x7a5a2a);
const PINE_CANOPY_COLOR = new THREE.Color(0x2a5420);
const OAK_CANOPY_COLOR = new THREE.Color(0x3d6b2e);
const OLIVE_CANOPY_COLOR = new THREE.Color(0x5a7a3a);
const CYPRESS_CANOPY_COLOR = new THREE.Color(0x1a4420);
const UMBRELLA_PINE_CANOPY_COLOR = new THREE.Color(0x2d5a1f);
const DATE_PALM_CANOPY_COLOR = new THREE.Color(0x4a7a2a);
const CEDAR_CANOPY_COLOR = new THREE.Color(0x1a4a30);

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
  readonly tileX: number;
  readonly tileY: number;
  readonly variant: TreeVariant;
}

// ---------------------------------------------------------------------------
// Geometry builders -- merged trunk + canopy with baked vertex colors
// ---------------------------------------------------------------------------

/**
 * Create a single box with baked vertex colors, translated to the given offset.
 */
function makeColoredBox(
  w: number,
  h: number,
  d: number,
  offsetY: number,
  color: THREE.Color,
): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(w, h, d);
  box.translate(0, offsetY + h / 2, 0);

  const verts = box.getAttribute('position');
  if (!verts) throw new Error('Failed to create box geometry attributes');

  const colors = new Float32Array(verts.count * 3);
  for (let i = 0; i < verts.count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  box.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  return box;
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

/**
 * Merge an array of BufferGeometries into a single geometry.
 * All inputs must have position, normal, and color attributes.
 */
function mergeGeometryArray(
  geometries: THREE.BufferGeometry[],
): THREE.BufferGeometry {
  if (geometries.length === 0) {
    throw new Error('Cannot merge zero geometries');
  }
  if (geometries.length === 1) {
    return geometries[0]!;
  }

  let result = mergeBufferGeometries(geometries[0]!, geometries[1]!);
  for (let i = 2; i < geometries.length; i++) {
    const prev = result;
    result = mergeBufferGeometries(prev, geometries[i]!);
    prev.dispose();
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pre-built variant geometries (lazy-initialized singletons)
// ---------------------------------------------------------------------------

const variantGeometries: Array<THREE.BufferGeometry | null> = new Array(VARIANT_COUNT).fill(null);

function getVariantGeometry(variant: TreeVariant): THREE.BufferGeometry {
  const cached = variantGeometries[variant];
  if (cached) return cached;

  const geom = buildVariantGeometry(variant);
  variantGeometries[variant] = geom;
  return geom;
}

function buildVariantGeometry(variant: TreeVariant): THREE.BufferGeometry {
  let parts: THREE.BufferGeometry[];

  switch (variant) {
    case TreeVariant.MEDITERRANEAN_PINE: {
      // Improved: Trunk 1x3x1, Canopy 3x4x3, additional tip box 2x2x2 on top
      const trunk = makeColoredBox(1, 3, 1, 0, TRUNK_COLOR);
      const canopy = makeColoredBox(3, 4, 3, 3, PINE_CANOPY_COLOR);
      const tip = makeColoredBox(2, 2, 2, 7, PINE_CANOPY_COLOR);
      parts = [trunk, canopy, tip];
      break;
    }
    case TreeVariant.OAK: {
      // Improved: Trunk 1x2x1, Canopy 4x3x4 (wider, more lush)
      const trunk = makeColoredBox(1, 2, 1, 0, TRUNK_COLOR_ALT);
      const canopy = makeColoredBox(4, 3, 4, 2, OAK_CANOPY_COLOR);
      parts = [trunk, canopy];
      break;
    }
    case TreeVariant.OLIVE: {
      // Improved: Trunk 1x2x1, Canopy asymmetric 3x2x4
      const trunk = makeColoredBox(1, 2, 1, 0, TRUNK_COLOR);
      const canopy = makeColoredBox(3, 2, 4, 2, OLIVE_CANOPY_COLOR);
      parts = [trunk, canopy];
      break;
    }
    case TreeVariant.CYPRESS: {
      // Narrow and tall - Italian/Greek signature tree
      // Trunk: 0.6x5x0.6, Canopy: 1.2x6x1.2 (tall columnar shape)
      const trunk = makeColoredBox(0.6, 5, 0.6, 0, TRUNK_COLOR);
      const canopy = makeColoredBox(1.2, 6, 1.2, 5, CYPRESS_CANOPY_COLOR);
      parts = [trunk, canopy];
      break;
    }
    case TreeVariant.UMBRELLA_PINE: {
      // Flat wide canopy on long trunk - Roman iconic tree
      // Trunk: 0.8x5x0.8, Canopy disk: 4x1.2x4 (flat wide disk on top)
      const trunk = makeColoredBox(0.8, 5, 0.8, 0, TRUNK_COLOR);
      const canopy = makeColoredBox(4, 1.2, 4, 5, UMBRELLA_PINE_CANOPY_COLOR);
      parts = [trunk, canopy];
      break;
    }
    case TreeVariant.DATE_PALM: {
      // Thin trunk + fan-like top - Egyptian/Levantine
      // Trunk: 0.6x6x0.6, Canopy: 3x2x3 (wider spread on top)
      const trunk = makeColoredBox(0.6, 6, 0.6, 0, TRUNK_COLOR_PALM);
      const canopy = makeColoredBox(3, 2, 3, 6, DATE_PALM_CANOPY_COLOR);
      parts = [trunk, canopy];
      break;
    }
    case TreeVariant.CEDAR: {
      // Stepped/tiered shape - mountain forests
      // Trunk: 0.8x2x0.8
      // Bottom tier: 4x1.5x4 at Y=2
      // Middle tier: 3x1.5x3 at Y=3.5
      // Top tier: 2x1.5x2 at Y=5
      const trunk = makeColoredBox(0.8, 2, 0.8, 0, TRUNK_COLOR);
      const bottom = makeColoredBox(4, 1.5, 4, 2, CEDAR_CANOPY_COLOR);
      const middle = makeColoredBox(3, 1.5, 3, 3.5, CEDAR_CANOPY_COLOR);
      const top = makeColoredBox(2, 1.5, 2, 5, CEDAR_CANOPY_COLOR);
      parts = [trunk, bottom, middle, top];
      break;
    }
    default:
      throw new Error(`Unknown tree variant: ${variant}`);
  }

  const merged = mergeGeometryArray(parts);

  // Dispose individual parts (mergeGeometryArray does not dispose all inputs)
  for (const part of parts) {
    if (part !== merged) {
      part.dispose();
    }
  }

  return merged;
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
  private variantMeshes: Array<THREE.InstancedMesh | null> = new Array(VARIANT_COUNT).fill(null);

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
  private readonly tmpScale: THREE.Vector3 = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  // -- Public API ----------------------------------------------------------

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

        // World Y (tileY) as latitude proxy for regional variant selection
        // Low tileY = north (Europe), High tileY = south (Africa/Egypt)
        const wy = tileY;
        const latFactor = wy / 2048; // 0=north, 1=south
        const regionHash = tileHash(tileX * 5, tileY * 11);

        let variant: TreeVariant;
        if (isOlive) {
          variant = TreeVariant.OLIVE;
        } else if (height > 55) {
          // Mountain forests get cedar
          variant = TreeVariant.CEDAR;
        } else if (latFactor > 0.65) {
          // Southern regions: date palms
          variant = TreeVariant.DATE_PALM;
        } else if (latFactor > 0.4) {
          // Mediterranean core: cypress, umbrella pine, standard pine
          if (regionHash < 0.3) variant = TreeVariant.CYPRESS;
          else if (regionHash < 0.55) variant = TreeVariant.UMBRELLA_PINE;
          else variant = TreeVariant.MEDITERRANEAN_PINE;
        } else {
          // Northern regions: oak, pine
          variant = regionHash < 0.4 ? TreeVariant.OAK : TreeVariant.MEDITERRANEAN_PINE;
        }

        this.allTrees.push({ worldX, worldY, worldZ, tileX, tileY, variant });
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
    for (let i = 0; i < VARIANT_COUNT; i++) {
      const geom = variantGeometries[i];
      if (geom) {
        geom.dispose();
        variantGeometries[i] = null;
      }
    }
  }

  // -- Internal ------------------------------------------------------------

  /**
   * Rebuild all InstancedMesh objects from the tree pool,
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
    const variantCounts = new Uint32Array(VARIANT_COUNT);

    for (let i = 0; i < visible.length; i++) {
      const entry = visible[i];
      if (!entry) continue;
      variantCounts[entry.tree.variant] = (variantCounts[entry.tree.variant] ?? 0) + 1;
    }

    // Dispose old meshes
    this.disposeMeshes();

    // Create new InstancedMesh per variant (only if count > 0)
    for (let v = 0; v < VARIANT_COUNT; v++) {
      const count = variantCounts[v]!;
      if (count > 0) {
        const mesh = new THREE.InstancedMesh(
          getVariantGeometry(v as TreeVariant),
          TREE_MATERIAL,
          count,
        );
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.variantMeshes[v] = mesh;
      }
    }

    // Fill instance matrices with per-instance scale variation
    const variantIndices = new Uint32Array(VARIANT_COUNT);

    for (let i = 0; i < visible.length; i++) {
      const entry = visible[i];
      if (!entry) continue;

      const { tree } = entry;
      const mesh = this.variantMeshes[tree.variant];
      if (!mesh) continue;

      // Per-instance scale variation: 0.8 - 1.2x based on tile hash
      const scaleFactor = 0.8 + tileHash(Math.floor(tree.worldX * 7), Math.floor(tree.worldZ * 13)) * 0.4;

      this.tmpMatrix.makeTranslation(tree.worldX, tree.worldY, tree.worldZ);
      this.tmpMatrix.scale(this.tmpScale.set(scaleFactor, scaleFactor, scaleFactor));

      const idx = variantIndices[tree.variant]!;
      mesh.setMatrixAt(idx, this.tmpMatrix);
      variantIndices[tree.variant] = (variantIndices[tree.variant] ?? 0) + 1;
    }

    // Flag instance matrix buffers for upload
    for (let v = 0; v < VARIANT_COUNT; v++) {
      const mesh = this.variantMeshes[v];
      if (mesh) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Remove all InstancedMesh objects from the scene and release GPU resources. */
  private disposeMeshes(): void {
    for (let v = 0; v < VARIANT_COUNT; v++) {
      const mesh = this.variantMeshes[v];
      if (mesh) {
        this.scene.remove(mesh);
        mesh.dispose();
        this.variantMeshes[v] = null;
      }
    }
  }

  /** Hide all tree meshes (camera too high). */
  private hideAll(): void {
    for (let v = 0; v < VARIANT_COUNT; v++) {
      const mesh = this.variantMeshes[v];
      if (mesh) mesh.visible = false;
    }
  }

  /** Show all tree meshes. */
  private showAll(): void {
    for (let v = 0; v < VARIANT_COUNT; v++) {
      const mesh = this.variantMeshes[v];
      if (mesh) mesh.visible = true;
    }
  }
}
