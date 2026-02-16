/**
 * Temporary procedural chunk generator for visual development.
 *
 * Generates Mediterranean-style terrain using layered sine/cosine noise.
 * Seamless tiling is guaranteed because all noise functions operate on
 * absolute world coordinates (cx * CHUNK_SIZE + localX).
 *
 * This file will be retired once the real Supabase data pipeline is live.
 */

import { CHUNK_SIZE, WATER_LEVEL, MAX_HEIGHT, GRID_SIZE } from '../config';
import { BiomeType, TileFlags } from '../types';
import type { ChunkData } from '../types';

// ── Noise Helpers ──────────────────────────────────────────────────

/** Deterministic hash-based pseudo-random in [0, 1). */
function hash2d(x: number, y: number): number {
  const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * Layered sinusoidal noise producing smooth, tileable terrain.
 * Multiple octaves at different frequencies create natural-looking hills.
 */
function terrainNoise(wx: number, wy: number): number {
  // Large-scale continental shape
  const continental =
    Math.sin(wx * 0.0025 + 0.3) * Math.cos(wy * 0.0030 + 0.7) * 0.35 +
    Math.cos(wx * 0.0018 - 0.5) * Math.sin(wy * 0.0022 + 1.2) * 0.25;

  // Medium hills
  const hills =
    Math.sin(wx * 0.012 + wy * 0.008) * 0.15 +
    Math.cos(wx * 0.009 - wy * 0.011 + 2.0) * 0.10;

  // Fine ridges
  const ridges =
    Math.sin(wx * 0.035 + 1.7) * Math.cos(wy * 0.028 + 0.9) * 0.08 +
    Math.sin(wx * 0.022 + wy * 0.044 - 1.3) * 0.05;

  // Very fine variation
  const detail =
    Math.sin(wx * 0.07 + wy * 0.05) * 0.03 +
    Math.cos(wx * 0.09 - wy * 0.06 + 3.1) * 0.02;

  return continental + hills + ridges + detail;
}

/**
 * Additional moisture-like noise used for biome variation.
 * Offset frequencies ensure it is independent from heightmap.
 */
function moistureNoise(wx: number, wy: number): number {
  return (
    Math.sin(wx * 0.0045 + 5.0) * Math.cos(wy * 0.005 + 3.0) * 0.5 +
    Math.cos(wx * 0.015 - 2.0) * Math.sin(wy * 0.013 + 4.0) * 0.3 +
    Math.sin(wx * 0.04 + wy * 0.03 + 1.0) * 0.2
  );
}

// ── Voronoi Province Seeds ─────────────────────────────────────────

interface ProvinceSeed {
  wx: number;
  wy: number;
  id: number;
}

const TOTAL_TILES = GRID_SIZE * CHUNK_SIZE; // 2048

/**
 * Pre-computed province seed points spread across the map.
 * 41 provinces + province 0 (barbarian) at corners.
 */
const PROVINCE_SEEDS: ProvinceSeed[] = (() => {
  const seeds: ProvinceSeed[] = [];
  // Province 0: barbarian territory at map corners
  seeds.push({ wx: 0, wy: 0, id: 0 });
  seeds.push({ wx: TOTAL_TILES, wy: 0, id: 0 });
  seeds.push({ wx: 0, wy: TOTAL_TILES, id: 0 });
  seeds.push({ wx: TOTAL_TILES, wy: TOTAL_TILES, id: 0 });

  // Provinces 1-41: distributed across the map interior
  const cols = 7;
  const rows = 6;
  let provinceId = 1;
  for (let row = 0; row < rows && provinceId <= 41; row++) {
    for (let col = 0; col < cols && provinceId <= 41; col++) {
      // Jitter the grid position deterministically
      const baseX = ((col + 0.5) / cols) * TOTAL_TILES;
      const baseY = ((row + 0.5) / rows) * TOTAL_TILES;
      const jitterX = (hash2d(col * 17 + 3, row * 31 + 7) - 0.5) * (TOTAL_TILES / cols) * 0.5;
      const jitterY = (hash2d(col * 23 + 11, row * 13 + 5) - 0.5) * (TOTAL_TILES / rows) * 0.5;
      seeds.push({
        wx: Math.max(50, Math.min(TOTAL_TILES - 50, baseX + jitterX)),
        wy: Math.max(50, Math.min(TOTAL_TILES - 50, baseY + jitterY)),
        id: provinceId,
      });
      provinceId++;
    }
  }
  return seeds;
})();

/** Find nearest province seed for a world coordinate. */
function nearestProvince(wx: number, wy: number): number {
  let bestDist = Infinity;
  let bestId = 0;
  for (let i = 0; i < PROVINCE_SEEDS.length; i++) {
    const seed = PROVINCE_SEEDS[i]!;
    const dx = wx - seed.wx;
    const dy = wy - seed.wy;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestId = seed.id;
    }
  }
  return bestId;
}

// ── Road Path Detection ────────────────────────────────────────────

/**
 * Checks whether a world coordinate lies on a procedural road path.
 * Roads follow diagonal and cardinal lines between province centres.
 * Width tolerance is 1.5 tiles (produces ~3-tile-wide roads).
 */
function isOnRoad(wx: number, wy: number): boolean {
  const roadWidth = 1.8;
  const roadWidthSq = roadWidth * roadWidth;

  // Check distance to line segments between adjacent province seeds
  for (let i = 4; i < PROVINCE_SEEDS.length; i++) {
    const a = PROVINCE_SEEDS[i]!;
    for (let j = i + 1; j < PROVINCE_SEEDS.length; j++) {
      const b = PROVINCE_SEEDS[j]!;
      const abDx = b.wx - a.wx;
      const abDy = b.wy - a.wy;
      const segLenSq = abDx * abDx + abDy * abDy;

      // Only connect seeds that are reasonably close (within ~600 tiles)
      if (segLenSq > 360000) continue;

      // Project point onto segment
      const t = Math.max(0, Math.min(1, ((wx - a.wx) * abDx + (wy - a.wy) * abDy) / segLenSq));
      const projX = a.wx + t * abDx;
      const projY = a.wy + t * abDy;
      const dx = wx - projX;
      const dy = wy - projY;
      if (dx * dx + dy * dy < roadWidthSq) {
        return true;
      }
    }
  }
  return false;
}

// ── Height Calculation ─────────────────────────────────────────────

/**
 * Compute terrain height at a world coordinate.
 *
 * The map is shaped so that:
 *  - Edges (especially south and west) are ocean.
 *  - Centre-north has mountain ranges.
 *  - The interior is rolling Mediterranean hills.
 */
function computeHeight(wx: number, wy: number): number {
  const nx = wx / TOTAL_TILES; // 0..1
  const ny = wy / TOTAL_TILES;

  // Base noise value in roughly [-1, 1]
  const noise = terrainNoise(wx, wy);

  // Continental mask: falloff near edges to create ocean borders
  const edgeFadeX = Math.min(nx, 1 - nx) * 4; // ramp 0->1 over 25% of map
  const edgeFadeY = Math.min(ny, 1 - ny) * 4;
  const edgeFade = Math.min(1, Math.min(edgeFadeX, edgeFadeY));

  // Mountain ridge in upper-centre portion of the map (Alps / Anatolian highlands)
  const mountainBandY = 1 - Math.pow((ny - 0.3) * 3.5, 2);
  const mountainBandX = 1 - Math.pow((nx - 0.5) * 2.5, 2);
  const mountainFactor = Math.max(0, mountainBandY * mountainBandX);
  const mountainBoost = mountainFactor * 0.35;

  // Combine: scale noise into height range
  const raw = (noise + mountainBoost + 0.4) * edgeFade;
  const height = Math.round(raw * MAX_HEIGHT);

  return Math.max(0, Math.min(MAX_HEIGHT, height));
}

// ── Biome Assignment ───────────────────────────────────────────────

function assignBiome(
  height: number,
  wx: number,
  wy: number,
  isCoast: boolean,
): BiomeType {
  // Deep and shallow water
  if (height < WATER_LEVEL - 5) return BiomeType.WATER_DEEP;
  if (height < WATER_LEVEL) return BiomeType.WATER_SHALLOW;

  // Beach strip
  if (height === WATER_LEVEL) return BiomeType.SAND;

  // Coastal lowlands
  if (height < WATER_LEVEL + 4) {
    return isCoast ? BiomeType.COAST : BiomeType.SAND;
  }

  // Low elevations: grassland, farmland, olive groves, vineyards
  if (height < WATER_LEVEL + 15) {
    const moisture = moistureNoise(wx, wy);
    const variation = hash2d(wx, wy);

    if (moisture > 0.3 && variation < 0.25) return BiomeType.FARMLAND;
    if (moisture > 0.1 && variation > 0.7) return BiomeType.OLIVE_GROVE;
    if (moisture < -0.1 && variation > 0.6) return BiomeType.VINEYARD;
    if (moisture < -0.3) return BiomeType.SCRUB;
    return BiomeType.GRASS;
  }

  // Mid elevations
  if (height < 50) {
    const moisture = moistureNoise(wx, wy);
    if (moisture > 0.2) return BiomeType.FOREST;
    if (moisture > -0.1) return BiomeType.GRASS;
    return BiomeType.SCRUB;
  }

  // Upper-mid elevations
  if (height < 70) {
    const moisture = moistureNoise(wx, wy);
    if (moisture > 0.3) return BiomeType.DENSE_FOREST;
    if (moisture > 0) return BiomeType.FOREST;
    return BiomeType.SCRUB;
  }

  // High elevations
  if (height < 90) return BiomeType.MOUNTAIN;

  // Peaks
  return BiomeType.SNOW;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Generate a complete ChunkData object procedurally.
 *
 * @param cx - Chunk X coordinate (0 .. GRID_SIZE-1)
 * @param cy - Chunk Y coordinate (0 .. GRID_SIZE-1)
 * @returns ChunkData with heights, biomes, flags, and provinces filled in
 */
export function generateProceduralChunk(cx: number, cy: number): ChunkData {
  const tileCount = CHUNK_SIZE * CHUNK_SIZE;

  const heights = new Uint8Array(tileCount);
  const biomes = new Uint8Array(tileCount);
  const flags = new Uint8Array(tileCount);
  const provinces = new Uint8Array(tileCount);

  // First pass: compute all heights so we can detect coastlines
  const originX = cx * CHUNK_SIZE;
  const originY = cy * CHUNK_SIZE;

  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const idx = ly * CHUNK_SIZE + lx;
      const wx = originX + lx;
      const wy = originY + ly;
      heights[idx] = computeHeight(wx, wy);
    }
  }

  // Second pass: assign biomes, flags, provinces (needs neighbour height info for coast)
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const idx = ly * CHUNK_SIZE + lx;
      const wx = originX + lx;
      const wy = originY + ly;
      const h = heights[idx]!;

      // Detect coast: land tile adjacent to water
      let isCoast = false;
      if (h >= WATER_LEVEL) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nlx = lx + dx;
            const nly = ly + dy;
            // For tiles at chunk edges, compute neighbour height directly
            if (nlx < 0 || nlx >= CHUNK_SIZE || nly < 0 || nly >= CHUNK_SIZE) {
              const nwx = wx + dx;
              const nwy = wy + dy;
              if (computeHeight(nwx, nwy) < WATER_LEVEL) {
                isCoast = true;
              }
            } else {
              const nIdx = nly * CHUNK_SIZE + nlx;
              if (heights[nIdx]! < WATER_LEVEL) {
                isCoast = true;
              }
            }
            if (isCoast) break;
          }
          if (isCoast) break;
        }
      }

      // Biome
      biomes[idx] = assignBiome(h, wx, wy, isCoast);

      // Province (only for land tiles)
      if (h >= WATER_LEVEL) {
        provinces[idx] = nearestProvince(wx, wy);
      } else {
        provinces[idx] = 0; // Water is barbarian/unclaimed
      }

      // Flags
      let tileFlag = 0;
      if (isCoast) {
        tileFlag |= TileFlags.IS_COAST;
      }
      if (h >= WATER_LEVEL && isOnRoad(wx, wy)) {
        tileFlag |= TileFlags.HAS_ROAD;
        biomes[idx] = BiomeType.ROAD; // Override biome on road tiles
      }
      flags[idx] = tileFlag;
    }
  }

  return { cx, cy, heights, biomes, flags, provinces };
}
