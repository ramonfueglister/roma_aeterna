/**
 * Synchronous chunk mesh builder.
 *
 * Converts ChunkData + LODLevel into ChunkMeshData (positions, normals,
 * colors, indices) ready for Three.js BufferGeometry.
 *
 * This runs on the main thread as a temporary fallback. The same logic
 * will be ported into the Web Worker mesh generator when WorkerPool is
 * implemented. The function signature is intentionally kept worker-friendly
 * (pure data in, pure data out, no Three.js dependencies).
 *
 * Geometry style: voxel columns. Each tile becomes a vertical column of
 * height = tile height. Top face + 4 side faces are emitted (bottom face
 * is omitted since it faces the ground and is never visible).
 *
 * At higher LOD levels the chunk is down-sampled:
 *   LOD0: 1:1 (32x32 = 1024 columns)
 *   LOD1: 2:1 (16x16 = 256 columns)
 *   LOD2: 4:1 (8x8 = 64 columns)
 *   LOD3: 8:1 (4x4 = 16 columns)
 */

import { CHUNK_SIZE, FACE_SHADE } from '../config';
import type { ChunkData, ChunkMeshData, LODLevel } from '../types';
import { biomeColorRGB, applyColorNoise } from '../core/biomeColors';
import { BiomeType } from '../types';

// ── LOD step sizes ─────────────────────────────────────────────────

const LOD_STEP: Record<LODLevel, number> = {
  0: 1,
  1: 2,
  2: 4,
  3: 8,
};

// ── Public API ─────────────────────────────────────────────────────

/**
 * Build mesh data for a single chunk at a given LOD level.
 *
 * @param chunk - The chunk data (heights, biomes, etc.)
 * @param lod   - Level of detail (0 = full, 3 = coarsest)
 * @returns ChunkMeshData with typed arrays ready for GPU upload
 */
export function buildChunkMesh(chunk: ChunkData, lod: LODLevel): ChunkMeshData {
  const step = LOD_STEP[lod];
  const tilesPerAxis = CHUNK_SIZE / step;

  // Worst case: each column has top + 4 sides = 5 faces, each face = 4 verts + 2 tris
  // Actual count is much lower (sides are culled against neighbours).
  // We pre-allocate generously and then trim.
  const maxFaces = tilesPerAxis * tilesPerAxis * 5;
  const maxVerts = maxFaces * 4;
  const maxIndices = maxFaces * 6;

  const positions = new Float32Array(maxVerts * 3);
  const normals = new Float32Array(maxVerts * 3);
  const colors = new Float32Array(maxVerts * 3);
  const indices = new Uint32Array(maxIndices);

  let vertCount = 0;
  let indexCount = 0;

  // Helper: sample the maximum height in a step x step block
  function sampleHeight(lx: number, ly: number): number {
    if (step === 1) {
      const idx = ly * CHUNK_SIZE + lx;
      return chunk.heights[idx]!;
    }
    let maxH = 0;
    for (let dy = 0; dy < step; dy++) {
      for (let dx = 0; dx < step; dx++) {
        const sx = Math.min(lx + dx, CHUNK_SIZE - 1);
        const sy = Math.min(ly + dy, CHUNK_SIZE - 1);
        const h = chunk.heights[sy * CHUNK_SIZE + sx]!;
        if (h > maxH) maxH = h;
      }
    }
    return maxH;
  }

  // Helper: sample the biome at the centre of the block
  function sampleBiome(lx: number, ly: number): BiomeType {
    const cx = Math.min(lx + Math.floor(step / 2), CHUNK_SIZE - 1);
    const cy = Math.min(ly + Math.floor(step / 2), CHUNK_SIZE - 1);
    return chunk.biomes[cy * CHUNK_SIZE + cx]! as BiomeType;
  }

  // Helper: push a quad (4 verts, 6 indices)
  function pushQuad(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    x3: number, y3: number, z3: number,
    nx: number, ny: number, nz: number,
    r: number, g: number, b: number,
    shade: number,
  ): void {
    const sr = r * shade;
    const sg = g * shade;
    const sb = b * shade;

    const base = vertCount;

    positions[vertCount * 3] = x0;
    positions[vertCount * 3 + 1] = y0;
    positions[vertCount * 3 + 2] = z0;
    normals[vertCount * 3] = nx;
    normals[vertCount * 3 + 1] = ny;
    normals[vertCount * 3 + 2] = nz;
    colors[vertCount * 3] = sr;
    colors[vertCount * 3 + 1] = sg;
    colors[vertCount * 3 + 2] = sb;
    vertCount++;

    positions[vertCount * 3] = x1;
    positions[vertCount * 3 + 1] = y1;
    positions[vertCount * 3 + 2] = z1;
    normals[vertCount * 3] = nx;
    normals[vertCount * 3 + 1] = ny;
    normals[vertCount * 3 + 2] = nz;
    colors[vertCount * 3] = sr;
    colors[vertCount * 3 + 1] = sg;
    colors[vertCount * 3 + 2] = sb;
    vertCount++;

    positions[vertCount * 3] = x2;
    positions[vertCount * 3 + 1] = y2;
    positions[vertCount * 3 + 2] = z2;
    normals[vertCount * 3] = nx;
    normals[vertCount * 3 + 1] = ny;
    normals[vertCount * 3 + 2] = nz;
    colors[vertCount * 3] = sr;
    colors[vertCount * 3 + 1] = sg;
    colors[vertCount * 3 + 2] = sb;
    vertCount++;

    positions[vertCount * 3] = x3;
    positions[vertCount * 3 + 1] = y3;
    positions[vertCount * 3 + 2] = z3;
    normals[vertCount * 3] = nx;
    normals[vertCount * 3 + 1] = ny;
    normals[vertCount * 3 + 2] = nz;
    colors[vertCount * 3] = sr;
    colors[vertCount * 3 + 1] = sg;
    colors[vertCount * 3 + 2] = sb;
    vertCount++;

    // Two triangles: 0-1-2, 2-3-0
    indices[indexCount++] = base;
    indices[indexCount++] = base + 1;
    indices[indexCount++] = base + 2;
    indices[indexCount++] = base + 2;
    indices[indexCount++] = base + 3;
    indices[indexCount++] = base;
  }

  // ── Build columns ──────────────────────────────────────────────

  // Pre-compute height grid for neighbour lookups
  const gridTiles = tilesPerAxis;
  const heightGrid = new Float32Array(gridTiles * gridTiles);
  const biomeGrid = new Uint8Array(gridTiles * gridTiles);

  for (let gy = 0; gy < gridTiles; gy++) {
    for (let gx = 0; gx < gridTiles; gx++) {
      const lx = gx * step;
      const ly = gy * step;
      heightGrid[gy * gridTiles + gx] = sampleHeight(lx, ly);
      biomeGrid[gy * gridTiles + gx] = sampleBiome(lx, ly);
    }
  }

  for (let gy = 0; gy < gridTiles; gy++) {
    for (let gx = 0; gx < gridTiles; gx++) {
      const gIdx = gy * gridTiles + gx;
      const h = heightGrid[gIdx]!;
      if (h <= 0) continue; // Skip completely flat ground-level tiles

      const biome = biomeGrid[gIdx]! as BiomeType;
      const [baseR, baseG, baseB] = biomeColorRGB(biome);

      // Apply per-vertex noise using grid position for determinism
      const worldLx = gx * step;
      const worldLy = gy * step;
      const [r, g, b] = applyColorNoise(baseR, baseG, baseB, worldLx, worldLy, h);

      // Column corners in chunk-local space
      const x0 = gx * step;
      const z0 = gy * step;
      const x1 = x0 + step;
      const z1 = z0 + step;

      // ── Top face (always emitted) ────────────────────────────
      pushQuad(
        x0, h, z0,
        x1, h, z0,
        x1, h, z1,
        x0, h, z1,
        0, 1, 0,
        r, g, b,
        FACE_SHADE.TOP,
      );

      // ── Side faces (emitted only when neighbour is shorter) ──

      // North side (z = z0, facing -Z)
      const northH = gy > 0 ? heightGrid[(gy - 1) * gridTiles + gx]! : 0;
      if (northH < h) {
        pushQuad(
          x1, h, z0,
          x0, h, z0,
          x0, northH, z0,
          x1, northH, z0,
          0, 0, -1,
          r, g, b,
          FACE_SHADE.NORTH,
        );
      }

      // South side (z = z1, facing +Z)
      const southH = gy < gridTiles - 1 ? heightGrid[(gy + 1) * gridTiles + gx]! : 0;
      if (southH < h) {
        pushQuad(
          x0, h, z1,
          x1, h, z1,
          x1, southH, z1,
          x0, southH, z1,
          0, 0, 1,
          r, g, b,
          FACE_SHADE.SOUTH,
        );
      }

      // West side (x = x0, facing -X)
      const westH = gx > 0 ? heightGrid[gy * gridTiles + (gx - 1)]! : 0;
      if (westH < h) {
        pushQuad(
          x0, h, z0,
          x0, h, z1,
          x0, westH, z1,
          x0, westH, z0,
          -1, 0, 0,
          r, g, b,
          FACE_SHADE.WEST,
        );
      }

      // East side (x = x1, facing +X)
      const eastH = gx < gridTiles - 1 ? heightGrid[gy * gridTiles + (gx + 1)]! : 0;
      if (eastH < h) {
        pushQuad(
          x1, h, z1,
          x1, h, z0,
          x1, eastH, z0,
          x1, eastH, z1,
          1, 0, 0,
          r, g, b,
          FACE_SHADE.EAST,
        );
      }
    }
  }

  // ── Trim arrays to actual size ────────────────────────────────

  return {
    positions: positions.slice(0, vertCount * 3),
    normals: normals.slice(0, vertCount * 3),
    colors: colors.slice(0, vertCount * 3),
    indices: indices.slice(0, indexCount),
  };
}
