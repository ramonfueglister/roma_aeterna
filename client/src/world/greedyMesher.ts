/**
 * Greedy meshing algorithm for voxel terrain chunks.
 *
 * Each tile column (x, z) in a 32x32 chunk has a solid block stack from y=0
 * up to its height value.  The mesher produces merged quads for every exposed
 * face, with biome-based vertex colors, deterministic per-vertex color noise,
 * and directional face-shading baked in.
 *
 * LOD levels downsample the grid:
 *   LOD 0 -- full 32x32 resolution
 *   LOD 1 -- 16x16 (sample every 2nd tile)
 *   LOD 2 -- 8x8  (sample every 4th tile)
 *   LOD 3 -- single quad covering the whole chunk
 *
 * No THREE.js dependency -- pure TypeScript arrays for Web Worker usage.
 */

import { CHUNK_SIZE, FACE_SHADE } from '../config';
import type { ChunkData, ChunkMeshData, LODLevel } from '../types';
import { BiomeType } from '../types';
import {
  biomeColorRGB,
  applyColorNoise,
  applyEmpireBorderFog,
  applyMapEdgeFade,
  distToBarbarianInChunk,
} from '../core/biomeColors';

// ── Constants ──────────────────────────────────────────────────────

const VERTICES_PER_QUAD = 4;

/** LOD step sizes: LOD 0 = 1, LOD 1 = 2, LOD 2 = 4, LOD 3 = 32 (entire chunk). */
const LOD_STEPS = [1, 2, 4, 32] as const;

/** Face direction enum for internal bookkeeping. */
const enum FaceDir {
  TOP = 0,
  BOTTOM = 1,
  NORTH = 2,  // +Z face
  SOUTH = 3,  // -Z face
  EAST = 4,   // +X face
  WEST = 5,   // -X face
}

/**
 * Normal vectors per face direction (x, y, z).
 * Indexed by FaceDir.  Typed as a 6-element tuple so const-enum
 * indexing satisfies noUncheckedIndexedAccess.
 */
type Vec3Tuple = readonly [number, number, number];
type FaceNormalTable = readonly [Vec3Tuple, Vec3Tuple, Vec3Tuple, Vec3Tuple, Vec3Tuple, Vec3Tuple];

const FACE_NORMALS: FaceNormalTable = [
  [0, 1, 0],   // TOP
  [0, -1, 0],  // BOTTOM
  [0, 0, 1],   // NORTH (+Z)
  [0, 0, -1],  // SOUTH (-Z)
  [1, 0, 0],   // EAST  (+X)
  [-1, 0, 0],  // WEST  (-X)
];

/** Shade multiplier indexed by FaceDir. */
type FaceShadeTable = readonly [number, number, number, number, number, number];

const FACE_SHADE_LUT: FaceShadeTable = [
  FACE_SHADE.TOP,
  FACE_SHADE.BOTTOM,
  FACE_SHADE.NORTH,
  FACE_SHADE.SOUTH,
  FACE_SHADE.EAST,
  FACE_SHADE.WEST,
];

// ── Scratch Buffers ────────────────────────────────────────────────
// Pre-allocated growable arrays that are reused across calls within the
// same worker.  This avoids repeated allocation for the push-phase.

/** Dynamic typed array that grows by doubling, avoids per-element GC pressure. */
class GrowableFloat32 {
  data: Float32Array;
  length: number;

  constructor(initialCapacity: number) {
    this.data = new Float32Array(initialCapacity);
    this.length = 0;
  }

  push3(a: number, b: number, c: number): void {
    if (this.length + 3 > this.data.length) {
      this.grow();
    }
    this.data[this.length++] = a;
    this.data[this.length++] = b;
    this.data[this.length++] = c;
  }

  /** Return a trimmed copy of the underlying buffer. */
  toFloat32Array(): Float32Array {
    return this.data.slice(0, this.length);
  }

  reset(): void {
    this.length = 0;
  }

  private grow(): void {
    const next = new Float32Array(this.data.length * 2);
    next.set(this.data);
    this.data = next;
  }
}

class GrowableUint32 {
  data: Uint32Array;
  length: number;

  constructor(initialCapacity: number) {
    this.data = new Uint32Array(initialCapacity);
    this.length = 0;
  }

  push6(a: number, b: number, c: number, d: number, e: number, f: number): void {
    if (this.length + 6 > this.data.length) {
      this.grow();
    }
    this.data[this.length++] = a;
    this.data[this.length++] = b;
    this.data[this.length++] = c;
    this.data[this.length++] = d;
    this.data[this.length++] = e;
    this.data[this.length++] = f;
  }

  toUint32Array(): Uint32Array {
    return this.data.slice(0, this.length);
  }

  reset(): void {
    this.length = 0;
  }

  private grow(): void {
    const next = new Uint32Array(this.data.length * 2);
    next.set(this.data);
    this.data = next;
  }
}

// Module-level scratch buffers -- one set per worker (workers are single-threaded).
// Sized for a reasonable worst-case at LOD 0.
const scratchPositions = new GrowableFloat32(32768);
const scratchNormals = new GrowableFloat32(32768);
const scratchColors = new GrowableFloat32(32768);
const scratchIndices = new GrowableUint32(49152);

// Reusable mask array for greedy merge (max 32x32 = 1024).
const greedyMask = new Int32Array(CHUNK_SIZE * CHUNK_SIZE);

/** Read from greedyMask with fallback for noUncheckedIndexedAccess. */
function maskAt(idx: number): number {
  return greedyMask[idx] ?? 0;
}

// ── Height Lookup Helpers ──────────────────────────────────────────

/**
 * Get height at (lx, lz) in chunk-local coordinates.
 * Returns 0 for out-of-bounds (chunk edges treated as height 0, exposing
 * side faces at borders -- neighboring chunk stitching is handled at a
 * higher level).
 */
function getHeight(heights: Uint8Array, lx: number, lz: number): number {
  if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) {
    return 0;
  }
  return heights[lz * CHUNK_SIZE + lx] ?? 0;
}

function getBiome(biomes: Uint8Array, lx: number, lz: number): number {
  return biomes[lz * CHUNK_SIZE + lx] ?? 0;
}

function getProvince(provinces: Uint8Array, lx: number, lz: number): number {
  return provinces[lz * CHUNK_SIZE + lx] ?? 0;
}

// ── Ambient Occlusion ──────────────────────────────────────────────

/**
 * AO darkening factor for per-vertex ambient occlusion.
 * 1.0 = no occlusion, lower = darker.  The factor is multiplied into
 * vertex color after face shading.
 */
const AO_STRENGTH = 0.78;

/**
 * Compute per-vertex AO for a top-face corner.
 *
 * For a corner at local (lx, lz), check the 3 neighboring columns
 * that share this corner: side1, side2, and the diagonal.  If any
 * neighbor is taller than the current column height, that neighbor
 * occludes the corner.
 *
 * Returns a multiplier in [AO_STRENGTH, 1.0] where lower = more
 * occluded.
 *
 * See: https://0fps.net/2013/07/03/ambient-occlusion-for-minecraft-like-worlds/
 */
function computeTopFaceAO(
  heights: Uint8Array,
  lx: number, lz: number,
  cornerHeight: number,
  dxSide1: number, dzSide1: number,
  dxSide2: number, dzSide2: number,
): number {
  const s1 = getHeight(heights, lx + dxSide1, lz + dzSide1) > cornerHeight ? 1 : 0;
  const s2 = getHeight(heights, lx + dxSide2, lz + dzSide2) > cornerHeight ? 1 : 0;
  // If both sides occlude, the diagonal is irrelevant (fully occluded corner)
  const corner = s1 === 1 && s2 === 1
    ? 1
    : (getHeight(heights, lx + dxSide1 + dxSide2, lz + dzSide1 + dzSide2) > cornerHeight ? 1 : 0);

  const occluders = s1 + s2 + corner; // 0..3
  // Map 0 → 1.0, 1 → lerp, 2 → lerp, 3 → AO_STRENGTH
  return 1.0 - (occluders / 3) * (1.0 - AO_STRENGTH);
}

// ── Quad Emitter ───────────────────────────────────────────────────

/** Current vertex count tracker -- reset per mesh build. */
let vertexCount = 0;

/**
 * Emit a single quad (two triangles) with the given corner positions,
 * face normal, and vertex color.  Wind counter-clockwise for front-face.
 *
 * Corners are specified as:
 *   v0 ---- v1
 *   |       |
 *   v3 ---- v2
 *
 * Triangles: (v0, v3, v1), (v1, v3, v2)  -- CCW when viewed from outside.
 *
 * ao0..ao3 are per-vertex AO multipliers (1.0 = no occlusion).
 */
function emitQuad(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  x3: number, y3: number, z3: number,
  nx: number, ny: number, nz: number,
  shade: number,
  biome: number,
  provinceId: number,
  distToBorder: number,
  ao0 = 1.0, ao1 = 1.0, ao2 = 1.0, ao3 = 1.0,
): void {
  const base = vertexCount;

  // Fetch biome base color once
  const [br, bg, bb] = biomeColorRGB(biome as BiomeType);
  const sr = br * shade;
  const sg = bg * shade;
  const sb = bb * shade;

  // Per-vertex: AO -> noise -> empire border fog -> map edge fade

  // Vertex 0
  let [r0, g0, b0] = applyColorNoise(sr * ao0, sg * ao0, sb * ao0, x0, y0, z0);
  [r0, g0, b0] = applyEmpireBorderFog(r0, g0, b0, provinceId, distToBorder);
  [r0, g0, b0] = applyMapEdgeFade(r0, g0, b0, x0, z0);
  scratchPositions.push3(x0, y0, z0);
  scratchNormals.push3(nx, ny, nz);
  scratchColors.push3(r0, g0, b0);

  // Vertex 1
  let [r1, g1, b1] = applyColorNoise(sr * ao1, sg * ao1, sb * ao1, x1, y1, z1);
  [r1, g1, b1] = applyEmpireBorderFog(r1, g1, b1, provinceId, distToBorder);
  [r1, g1, b1] = applyMapEdgeFade(r1, g1, b1, x1, z1);
  scratchPositions.push3(x1, y1, z1);
  scratchNormals.push3(nx, ny, nz);
  scratchColors.push3(r1, g1, b1);

  // Vertex 2
  let [r2, g2, b2] = applyColorNoise(sr * ao2, sg * ao2, sb * ao2, x2, y2, z2);
  [r2, g2, b2] = applyEmpireBorderFog(r2, g2, b2, provinceId, distToBorder);
  [r2, g2, b2] = applyMapEdgeFade(r2, g2, b2, x2, z2);
  scratchPositions.push3(x2, y2, z2);
  scratchNormals.push3(nx, ny, nz);
  scratchColors.push3(r2, g2, b2);

  // Vertex 3
  let [r3, g3, b3] = applyColorNoise(sr * ao3, sg * ao3, sb * ao3, x3, y3, z3);
  [r3, g3, b3] = applyEmpireBorderFog(r3, g3, b3, provinceId, distToBorder);
  [r3, g3, b3] = applyMapEdgeFade(r3, g3, b3, x3, z3);
  scratchPositions.push3(x3, y3, z3);
  scratchNormals.push3(nx, ny, nz);
  scratchColors.push3(r3, g3, b3);

  // Two triangles: (0, 3, 1), (1, 3, 2) -- CCW winding
  scratchIndices.push6(
    base, base + 3, base + 1,
    base + 1, base + 3, base + 2,
  );

  vertexCount += VERTICES_PER_QUAD;
}

// ── Greedy Top-Face Merge ──────────────────────────────────────────

/**
 * Greedy-merge top faces for a given downsampled grid.
 *
 * For each cell in the grid, the "mask" stores a composite key encoding
 * both biome and height so two cells merge only when both match.
 * 0 means "already merged" or "no face".
 */
function mergeTopFaces(
  heights: Uint8Array,
  biomes: Uint8Array,
  provinces: Uint8Array,
  step: number,
  gridSize: number,
  worldOffsetX: number,
  worldOffsetZ: number,
): void {
  const shade = FACE_SHADE_LUT[FaceDir.TOP];
  const normal = FACE_NORMALS[FaceDir.TOP];
  const nx = normal[0];
  const ny = normal[1];
  const nz = normal[2];

  // Build the mask: encode biome + height into a single integer for fast
  // comparison.  Use (biome << 8 | height) so two cells merge only when
  // both biome and height match.  0 means "skip" -- height 0 columns
  // are skipped since they have no visible top face.
  for (let gz = 0; gz < gridSize; gz++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const lx = gx * step;
      const lz = gz * step;
      const h = getHeight(heights, lx, lz);
      if (h === 0) {
        greedyMask[gz * gridSize + gx] = 0;
      } else {
        const b = getBiome(biomes, lx, lz);
        greedyMask[gz * gridSize + gx] = (b << 8) | h;
      }
    }
  }

  // Greedy scan
  for (let gz = 0; gz < gridSize; gz++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const key = maskAt(gz * gridSize + gx);
      if (key === 0) continue;

      const biome = key >> 8;
      const height = key & 0xff;

      // Extend width (along x)
      let w = 1;
      while (gx + w < gridSize && maskAt(gz * gridSize + gx + w) === key) {
        w++;
      }

      // Extend depth (along z)
      let d = 1;
      let canExtend = true;
      while (gz + d < gridSize && canExtend) {
        for (let dx = 0; dx < w; dx++) {
          if (maskAt((gz + d) * gridSize + gx + dx) !== key) {
            canExtend = false;
            break;
          }
        }
        if (canExtend) d++;
      }

      // Clear mask for merged cells
      for (let dz = 0; dz < d; dz++) {
        for (let dx = 0; dx < w; dx++) {
          greedyMask[(gz + dz) * gridSize + gx + dx] = 0;
        }
      }

      // Emit merged quad in world coordinates
      const wx = worldOffsetX + gx * step;
      const wz = worldOffsetZ + gz * step;
      const wy = height;
      const qw = w * step; // quad width in world units
      const qd = d * step; // quad depth in world units

      // Province info from the origin tile of this merged quad
      const lx = gx * step;
      const lz = gz * step;
      const pid = getProvince(provinces, lx, lz);
      const dBorder = distToBarbarianInChunk(provinces, lx, lz);

      // Per-vertex AO for top face corners.
      // For each corner, check the 3 neighbors that meet at that corner.
      // Tile coords of the 4 corners of the merged quad:
      const nwX = gx * step;              // NW corner tile X
      const nwZ = gz * step;              // NW corner tile Z
      const neX = (gx + w - 1) * step;    // NE corner tile X
      const neZ = gz * step;              // NE corner tile Z
      const seX = (gx + w - 1) * step;    // SE corner tile X
      const seZ = (gz + d - 1) * step;    // SE corner tile Z
      const swX = gx * step;              // SW corner tile X
      const swZ = (gz + d - 1) * step;    // SW corner tile Z

      // v0 (NW): side1=(-step,0), side2=(0,-step)
      const ao0 = computeTopFaceAO(heights, nwX, nwZ, height, -step, 0, 0, -step);
      // v1 (NE): side1=(+step,0), side2=(0,-step)
      const ao1 = computeTopFaceAO(heights, neX, neZ, height, step, 0, 0, -step);
      // v2 (SE): side1=(+step,0), side2=(0,+step)
      const ao2 = computeTopFaceAO(heights, seX, seZ, height, step, 0, 0, step);
      // v3 (SW): side1=(-step,0), side2=(0,+step)
      const ao3 = computeTopFaceAO(heights, swX, swZ, height, -step, 0, 0, step);

      // Top face: Y-up, corners at height wy
      // v0=NW, v1=NE, v2=SE, v3=SW  (viewed from above, CCW)
      emitQuad(
        wx,      wy, wz,        // v0 (NW)
        wx + qw, wy, wz,        // v1 (NE)
        wx + qw, wy, wz + qd,   // v2 (SE)
        wx,      wy, wz + qd,   // v3 (SW)
        nx, ny, nz,
        shade,
        biome,
        pid,
        dBorder,
        ao0, ao1, ao2, ao3,
      );
    }
  }
}

// ── Side Face Generation ───────────────────────────────────────────

/**
 * Generate side faces for exposed vertical surfaces.
 *
 * A side face is exposed when a neighbor column has a lower height.  The
 * face spans from the neighbor's height up to this column's height.
 *
 * Side faces are also greedy-merged along the face axis: adjacent columns
 * along the face edge that share the same biome AND the same height
 * differential are merged into a single tall+wide quad.
 */
function mergeSideFaces(
  heights: Uint8Array,
  biomes: Uint8Array,
  provinces: Uint8Array,
  step: number,
  gridSize: number,
  worldOffsetX: number,
  worldOffsetZ: number,
): void {
  // NORTH faces (+Z direction) -- face visible when neighbor at z+1 is lower
  mergeSideDirection(
    heights, biomes, provinces, step, gridSize,
    worldOffsetX, worldOffsetZ,
    FaceDir.NORTH, 0, 1,
  );

  // SOUTH faces (-Z direction) -- face visible when neighbor at z-1 is lower
  mergeSideDirection(
    heights, biomes, provinces, step, gridSize,
    worldOffsetX, worldOffsetZ,
    FaceDir.SOUTH, 0, -1,
  );

  // EAST faces (+X direction) -- face visible when neighbor at x+1 is lower
  mergeSideDirection(
    heights, biomes, provinces, step, gridSize,
    worldOffsetX, worldOffsetZ,
    FaceDir.EAST, 1, 0,
  );

  // WEST faces (-X direction) -- face visible when neighbor at x-1 is lower
  mergeSideDirection(
    heights, biomes, provinces, step, gridSize,
    worldOffsetX, worldOffsetZ,
    FaceDir.WEST, -1, 0,
  );
}

/**
 * Greedy-merge side faces along one direction.
 *
 * The mask for side faces encodes: biome(8) | thisHeight(8) | neighborHeight(8).
 * Two cells merge when all three match.
 */
function mergeSideDirection(
  heights: Uint8Array,
  biomes: Uint8Array,
  provinces: Uint8Array,
  step: number,
  gridSize: number,
  worldOffsetX: number,
  worldOffsetZ: number,
  face: FaceDir,
  ndx: number,
  ndz: number,
): void {
  const shade = FACE_SHADE_LUT[face];
  const normal = FACE_NORMALS[face];
  const nx = normal[0];
  const ny = normal[1];
  const nz = normal[2];

  // For NORTH/SOUTH: primary axis = X (inner), secondary = Z (outer).
  // For EAST/WEST: primary axis = Z (inner), secondary = X (outer).
  const isZFace = face === FaceDir.NORTH || face === FaceDir.SOUTH;

  for (let outer = 0; outer < gridSize; outer++) {
    // Build mask for this row/column
    for (let inner = 0; inner < gridSize; inner++) {
      const gx = isZFace ? inner : outer;
      const gz = isZFace ? outer : inner;

      const lx = gx * step;
      const lz = gz * step;
      const h = getHeight(heights, lx, lz);

      // Neighbor in tile coordinates
      const nlx = lx + ndx * step;
      const nlz = lz + ndz * step;
      const nh = getHeight(heights, nlx, nlz);

      if (h > nh && h > 0) {
        const b = getBiome(biomes, lx, lz);
        greedyMask[inner] = (b << 16) | (h << 8) | nh;
      } else {
        greedyMask[inner] = 0;
      }
    }

    // Greedy merge along the inner axis
    for (let inner = 0; inner < gridSize; inner++) {
      const key = maskAt(inner);
      if (key === 0) continue;

      const biome = (key >> 16) & 0xff;
      const thisH = (key >> 8) & 0xff;
      const neighborH = key & 0xff;

      // Extend along the inner axis
      let span = 1;
      while (inner + span < gridSize && maskAt(inner + span) === key) {
        span++;
      }

      // Clear merged cells
      for (let s = 0; s < span; s++) {
        greedyMask[inner + s] = 0;
      }

      // Compute world-space quad corners
      const gx0 = isZFace ? inner : outer;
      const gz0 = isZFace ? outer : inner;

      const wx = worldOffsetX + gx0 * step;
      const wz = worldOffsetZ + gz0 * step;
      const yTop = thisH;
      const yBot = neighborH;
      const spanWorld = span * step;

      // Province info from the origin tile
      const plx = gx0 * step;
      const plz = gz0 * step;
      const pid = getProvince(provinces, plx, plz);
      const dBorder = distToBarbarianInChunk(provinces, plx, plz);

      emitSideQuad(face, wx, wz, yTop, yBot, step, spanWorld, nx, ny, nz, shade, biome, pid, dBorder);

      // Advance past merged span (loop will increment by 1)
      inner += span - 1;
    }
  }
}

/**
 * Emit a side quad with correct winding for the given face direction.
 *
 * The quad spans from yBot to yTop vertically, and extends `spanWorld`
 * units along the face's primary axis.
 */
function emitSideQuad(
  face: FaceDir,
  wx: number, wz: number,
  yTop: number, yBot: number,
  step: number, spanWorld: number,
  nx: number, ny: number, nz: number,
  shade: number,
  biome: number,
  provinceId: number,
  distToBorder: number,
): void {
  // Each face direction has specific corner positions to ensure outward-facing
  // CCW winding order.
  //
  // Side-face AO: the top edge (v0, v1 at yTop) gets subtle darkening where
  // the side meets the top surface — a concave edge that traps light.
  const sideAO = AO_STRENGTH + (1.0 - AO_STRENGTH) * 0.5; // softer than full AO

  switch (face) {
    case FaceDir.NORTH: {
      // +Z face: quad at z + step (the far edge of the voxel column)
      const z = wz + step;
      // Viewed from +Z looking toward -Z, CCW:
      emitQuad(
        wx + spanWorld, yTop, z,   // v0
        wx,             yTop, z,   // v1
        wx,             yBot, z,   // v2
        wx + spanWorld, yBot, z,   // v3
        nx, ny, nz, shade, biome, provinceId, distToBorder,
        sideAO, sideAO, 1.0, 1.0,
      );
      break;
    }
    case FaceDir.SOUTH: {
      // -Z face: quad at z (the near edge of the voxel column)
      const z = wz;
      // Viewed from -Z looking toward +Z, CCW:
      emitQuad(
        wx,             yTop, z,   // v0
        wx + spanWorld, yTop, z,   // v1
        wx + spanWorld, yBot, z,   // v2
        wx,             yBot, z,   // v3
        nx, ny, nz, shade, biome, provinceId, distToBorder,
        sideAO, sideAO, 1.0, 1.0,
      );
      break;
    }
    case FaceDir.EAST: {
      // +X face: quad at x + step
      const x = wx + step;
      // Viewed from +X looking toward -X, CCW:
      emitQuad(
        x, yTop, wz,               // v0
        x, yTop, wz + spanWorld,   // v1
        x, yBot, wz + spanWorld,   // v2
        x, yBot, wz,               // v3
        nx, ny, nz, shade, biome, provinceId, distToBorder,
        sideAO, sideAO, 1.0, 1.0,
      );
      break;
    }
    case FaceDir.WEST: {
      // -X face: quad at x
      const x = wx;
      // Viewed from -X looking toward +X, CCW:
      emitQuad(
        x, yTop, wz + spanWorld,   // v0
        x, yTop, wz,               // v1
        x, yBot, wz,               // v2
        x, yBot, wz + spanWorld,   // v3
        nx, ny, nz, shade, biome, provinceId, distToBorder,
        sideAO, sideAO, 1.0, 1.0,
      );
      break;
    }
    default:
      break;
  }
}

// ── LOD 3 Fast Path ────────────────────────────────────────────────

/**
 * LOD 3: Generate a single quad for the entire chunk.
 * Uses the most common biome and average height.
 */
function buildLOD3(chunk: ChunkData): ChunkMeshData {
  const worldOffsetX = chunk.cx * CHUNK_SIZE;
  const worldOffsetZ = chunk.cy * CHUNK_SIZE;

  // Find dominant biome and average height
  const biomeCounts = new Uint16Array(256);
  let heightSum = 0;
  let nonZeroCount = 0;
  const tileCount = CHUNK_SIZE * CHUNK_SIZE;

  for (let i = 0; i < tileCount; i++) {
    const h = chunk.heights[i] ?? 0;
    const b = chunk.biomes[i] ?? 0;
    const prev = biomeCounts[b] ?? 0;
    biomeCounts[b] = prev + 1;
    if (h > 0) {
      heightSum += h;
      nonZeroCount++;
    }
  }

  // Find most common biome
  let dominantBiome = 0;
  let maxCount = 0;
  for (let b = 0; b < 256; b++) {
    const count = biomeCounts[b] ?? 0;
    if (count > maxCount) {
      maxCount = count;
      dominantBiome = b;
    }
  }

  const avgHeight = nonZeroCount > 0 ? Math.round(heightSum / nonZeroCount) : 0;

  if (avgHeight === 0) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      colors: new Float32Array(0),
      indices: new Uint32Array(0),
    };
  }

  // Reset scratch buffers
  scratchPositions.reset();
  scratchNormals.reset();
  scratchColors.reset();
  scratchIndices.reset();
  vertexCount = 0;

  const shade = FACE_SHADE_LUT[FaceDir.TOP];
  const normal = FACE_NORMALS[FaceDir.TOP];
  const nx = normal[0];
  const ny = normal[1];
  const nz = normal[2];

  const wx = worldOffsetX;
  const wz = worldOffsetZ;
  const wy = avgHeight;
  const size = CHUNK_SIZE;

  // Use the center tile's province for LOD3
  const centerIdx = Math.floor(CHUNK_SIZE / 2) * CHUNK_SIZE + Math.floor(CHUNK_SIZE / 2);
  const lod3Province = chunk.provinces[centerIdx] ?? 0;
  const lod3Dist = distToBarbarianInChunk(
    chunk.provinces,
    Math.floor(CHUNK_SIZE / 2),
    Math.floor(CHUNK_SIZE / 2),
  );

  emitQuad(
    wx,        wy, wz,
    wx + size, wy, wz,
    wx + size, wy, wz + size,
    wx,        wy, wz + size,
    nx, ny, nz,
    shade,
    dominantBiome,
    lod3Province,
    lod3Dist,
  );

  return {
    positions: scratchPositions.toFloat32Array(),
    normals: scratchNormals.toFloat32Array(),
    colors: scratchColors.toFloat32Array(),
    indices: scratchIndices.toUint32Array(),
  };
}

// ── Bottom Faces ───────────────────────────────────────────────────

/**
 * Generate bottom faces at y=0.  A bottom face is emitted for every
 * column with height > 0.  These are greedy-merged by biome.
 *
 * In practice most cameras never see the underside, but chunk edges
 * create visible cliffs whose undersides need geometry.
 */
function mergeBottomFaces(
  heights: Uint8Array,
  biomes: Uint8Array,
  provinces: Uint8Array,
  step: number,
  gridSize: number,
  worldOffsetX: number,
  worldOffsetZ: number,
): void {
  const shade = FACE_SHADE_LUT[FaceDir.BOTTOM];
  const normal = FACE_NORMALS[FaceDir.BOTTOM];
  const nx = normal[0];
  const ny = normal[1];
  const nz = normal[2];

  // Build mask: biome + 1 for columns with h > 0, 0 otherwise
  for (let gz = 0; gz < gridSize; gz++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const lx = gx * step;
      const lz = gz * step;
      const h = getHeight(heights, lx, lz);
      if (h > 0) {
        greedyMask[gz * gridSize + gx] = getBiome(biomes, lx, lz) + 1;
      } else {
        greedyMask[gz * gridSize + gx] = 0;
      }
    }
  }

  // Greedy scan identical to top faces
  for (let gz = 0; gz < gridSize; gz++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const key = maskAt(gz * gridSize + gx);
      if (key === 0) continue;

      const biome = key - 1;

      let w = 1;
      while (gx + w < gridSize && maskAt(gz * gridSize + gx + w) === key) {
        w++;
      }

      let d = 1;
      let canExtend = true;
      while (gz + d < gridSize && canExtend) {
        for (let dx = 0; dx < w; dx++) {
          if (maskAt((gz + d) * gridSize + gx + dx) !== key) {
            canExtend = false;
            break;
          }
        }
        if (canExtend) d++;
      }

      for (let dz = 0; dz < d; dz++) {
        for (let dx = 0; dx < w; dx++) {
          greedyMask[(gz + dz) * gridSize + gx + dx] = 0;
        }
      }

      const wx = worldOffsetX + gx * step;
      const wz = worldOffsetZ + gz * step;
      const qw = w * step;
      const qd = d * step;

      // Province info from the origin tile
      const lx = gx * step;
      const lz = gz * step;
      const pid = getProvince(provinces, lx, lz);
      const dBorder = distToBarbarianInChunk(provinces, lx, lz);

      // Bottom face at y=0, flipped winding from top
      emitQuad(
        wx,      0, wz + qd,   // v0 (SW)
        wx + qw, 0, wz + qd,   // v1 (SE)
        wx + qw, 0, wz,        // v2 (NE)
        wx,      0, wz,        // v3 (NW)
        nx, ny, nz,
        shade,
        biome,
        pid,
        dBorder,
      );
    }
  }
}

// ── Main Entry Point ───────────────────────────────────────────────

/**
 * Generate a greedy-meshed chunk mesh from chunk data at the given LOD level.
 *
 * The returned arrays are compact -- no wasted capacity.  The caller can
 * transfer the underlying ArrayBuffers to the main thread for zero-copy
 * handoff.
 *
 * @param chunk - Decoded chunk data with heights, biomes, flags, provinces.
 * @param lod   - Level of detail: 0 (full), 1 (half), 2 (quarter), 3 (single quad).
 * @returns Mesh data with positions, normals, colors, and indices.
 */
export function greedyMeshChunk(chunk: ChunkData, lod: LODLevel): ChunkMeshData {
  // LOD 3 fast path -- single representative quad
  if (lod === 3) {
    return buildLOD3(chunk);
  }

  const step = LOD_STEPS[lod];
  const gridSize = CHUNK_SIZE / step;
  const worldOffsetX = chunk.cx * CHUNK_SIZE;
  const worldOffsetZ = chunk.cy * CHUNK_SIZE;

  // Reset shared scratch buffers
  scratchPositions.reset();
  scratchNormals.reset();
  scratchColors.reset();
  scratchIndices.reset();
  vertexCount = 0;

  // Phase 1: Greedy-merge top faces
  mergeTopFaces(
    chunk.heights, chunk.biomes, chunk.provinces,
    step, gridSize,
    worldOffsetX, worldOffsetZ,
  );

  // Phase 2: Greedy-merge side faces (north, south, east, west)
  mergeSideFaces(
    chunk.heights, chunk.biomes, chunk.provinces,
    step, gridSize,
    worldOffsetX, worldOffsetZ,
  );

  // Phase 3: Bottom faces (greedy-merged)
  mergeBottomFaces(
    chunk.heights, chunk.biomes, chunk.provinces,
    step, gridSize,
    worldOffsetX, worldOffsetZ,
  );

  // Build compact output arrays
  return {
    positions: scratchPositions.toFloat32Array(),
    normals: scratchNormals.toFloat32Array(),
    colors: scratchColors.toFloat32Array(),
    indices: scratchIndices.toUint32Array(),
  };
}
