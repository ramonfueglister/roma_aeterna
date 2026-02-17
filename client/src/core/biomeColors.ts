/**
 * Biome color palette for the voxel world.
 * All colors are RGB hex values matching the Mediterranean/Roman Empire aesthetic.
 *
 * Also contains empire border fog and map edge fade functions that are
 * applied to vertex colors at mesh generation time (zero GPU cost).
 */

import { BiomeType } from '../types';
import { MAP_SIZE, MAP_EDGE_FADE_TILES, BARBARIAN_PROVINCE_ID, CHUNK_SIZE } from '../config';

/** Base biome colors as 0xRRGGBB values (SPECS.md Section 11). */
export const BIOME_COLORS: Record<BiomeType, number> = {
  [BiomeType.WATER_DEEP]: 0x14326e,      // deep_sea        (20,  50,  110)
  [BiomeType.WATER_SHALLOW]: 0x4073a6,   // shallow_sea     (64,  115, 166)
  [BiomeType.SAND]: 0xe6d7aa,            // sand_beach      (230, 215, 170)
  [BiomeType.GRASS]: 0x61914f,           // grassland       (97,  145, 79)
  [BiomeType.FOREST]: 0x8cad61,          // mediterranean   (140, 173, 97)
  [BiomeType.DENSE_FOREST]: 0x2e5c1a,   // dense_forest    (46,  92,  26)
  [BiomeType.SCRUB]: 0xb3a66b,          // arid_scrub      (179, 166, 107)
  [BiomeType.FARMLAND]: 0x7a9e47,       // fertile         (122, 158, 71)
  [BiomeType.MARSH]: 0x597a4d,          // marsh           (89,  122, 77)
  [BiomeType.DESERT]: 0xd9c78c,         // desert          (217, 199, 140)
  [BiomeType.MOUNTAIN]: 0x8c857a,       // mountain        (140, 133, 122)
  [BiomeType.SNOW]: 0xe6ebf2,           // snow            (230, 235, 242)
  [BiomeType.ROAD]: 0xa08c6e,           // cliff           (160, 140, 110)
  [BiomeType.RIVER]: 0x4e91b4,          // river           (78,  145, 180)
  [BiomeType.CITY]: 0x736c62,           // mountain_dark   (115, 108, 98)
  [BiomeType.COAST]: 0x64c8d2,          // coast_water     (100, 200, 210)
  [BiomeType.STEPPE]: 0xa0945f,         // arid_scrub_dark (160, 148, 95)
  [BiomeType.VOLCANIC]: 0x234b14,       // forest_dark     (35,  75,  20)
  [BiomeType.OLIVE_GROVE]: 0x789652,    // med_dark        (120, 150, 82)
  [BiomeType.VINEYARD]: 0xc3b45a,       // fertile_field   (195, 180, 90)
};

/**
 * Get the RGB components from a biome color (0-1 range).
 * Returns [r, g, b] for vertex color usage.
 */
export function biomeColorRGB(biome: BiomeType): [number, number, number] {
  const hex = BIOME_COLORS[biome] ?? BIOME_COLORS[BiomeType.GRASS];
  return [
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
  ];
}

/**
 * Apply per-vertex color noise (±5% RGB variation).
 * Deterministic based on tile position for consistency across LODs.
 *
 * Spec §23: hash = (tile_x * 73856093 ^ tile_y * 19349663) / MAX_UINT
 * Multiplicative application: color * (1.0 + variation)
 */
export function applyColorNoise(
  r: number, g: number, b: number,
  tileX: number, tileY: number,
): [number, number, number] {
  // Integer XOR hash per spec §23
  const hash = ((tileX * 73856093) ^ (tileY * 19349663)) >>> 0;
  const noise = hash / 4294967296; // normalize to [0, 1)
  const variation = (noise - 0.5) * 0.10; // ±5% variation

  // Multiplicative application per spec §23
  return [
    Math.max(0, Math.min(1, r * (1.0 + variation))),
    Math.max(0, Math.min(1, g * (1.0 + variation * 0.8))),
    Math.max(0, Math.min(1, b * (1.0 + variation * 0.6))),
  ];
}

// ── Empire Border Fog (Spec Section 21) ──────────────────────────

/** Width of the transition zone (in tiles) at empire borders. */
const BORDER_TRANSITION_TILES = 10;

/** Blue-gray tint color for barbarian territory. */
const FOG_TINT_R = 0.45;
const FOG_TINT_G = 0.48;
const FOG_TINT_B = 0.55;

/**
 * Smoothstep interpolation for smooth gradient transitions.
 * Returns 0 when x <= edge0, 1 when x >= edge1, smooth curve between.
 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Compute the minimum distance from a tile to the nearest tile with
 * provinceId === 0, searching within the current chunk's province data.
 *
 * Since we only have the current chunk's province array, the search
 * radius is clamped to what fits within the 32x32 chunk grid. This
 * provides a good approximation -- border tiles near chunk edges will
 * still get partial fog from whichever barbarian tiles are visible in
 * the chunk.
 *
 * @param provinces - The chunk's province Uint8Array (1024 entries).
 * @param localX    - The tile's local X within the chunk (0..31).
 * @param localZ    - The tile's local Z within the chunk (0..31).
 * @returns Distance in tiles to nearest barbarian tile, or a large number if none found.
 */
export function distToBarbarianInChunk(
  provinces: Uint8Array,
  localX: number,
  localZ: number,
): number {
  const searchRadius = BORDER_TRANSITION_TILES;
  let minDistSq = (searchRadius + 1) * (searchRadius + 1);

  const xMin = Math.max(0, localX - searchRadius);
  const xMax = Math.min(CHUNK_SIZE - 1, localX + searchRadius);
  const zMin = Math.max(0, localZ - searchRadius);
  const zMax = Math.min(CHUNK_SIZE - 1, localZ + searchRadius);

  for (let sz = zMin; sz <= zMax; sz++) {
    for (let sx = xMin; sx <= xMax; sx++) {
      const pid = provinces[sz * CHUNK_SIZE + sx] ?? 0;
      if (pid === BARBARIAN_PROVINCE_ID) {
        const dx = sx - localX;
        const dz = sz - localZ;
        const distSq = dx * dx + dz * dz;
        if (distSq < minDistSq) {
          minDistSq = distSq;
        }
      }
    }
  }

  return Math.sqrt(minDistSq);
}

/**
 * Apply empire border fog to vertex colors.
 *
 * - provinceId === 0 (barbarian): desaturate 40%, brightness -25%, blue-gray tint
 * - provinceId > 0 within 10 tiles of border: gradient from full color to fog
 *
 * Colors are in 0-1 range. The function is pure and returns new values.
 *
 * @param r - Red component (0-1).
 * @param g - Green component (0-1).
 * @param b - Blue component (0-1).
 * @param provinceId - Province ID for this tile (0 = barbarian).
 * @param distToBorder - Distance in tiles to nearest barbarian tile.
 * @returns Modified [r, g, b] tuple.
 */
export function applyEmpireBorderFog(
  r: number, g: number, b: number,
  provinceId: number,
  distToBorder: number,
): [number, number, number] {
  // Determine the fog strength: 1.0 = full barbarian fog, 0.0 = no fog
  let fogStrength: number;

  if (provinceId === BARBARIAN_PROVINCE_ID) {
    // Full barbarian territory
    fogStrength = 1.0;
  } else if (distToBorder < BORDER_TRANSITION_TILES) {
    // Transition zone inside the empire -- gradient from 0.0 at 10 tiles to ~0.8 at border
    fogStrength = smoothstep(BORDER_TRANSITION_TILES, 0, distToBorder) * 0.8;
  } else {
    // Deep inside empire -- no fog
    return [r, g, b];
  }

  // Step 1: Desaturate by 40% (scaled by fogStrength)
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  const desatAmount = 0.4 * fogStrength;
  let dr = r + (luminance - r) * desatAmount;
  let dg = g + (luminance - g) * desatAmount;
  let db = b + (luminance - b) * desatAmount;

  // Step 2: Reduce brightness by 25% (scaled by fogStrength)
  const brightnessScale = 1.0 - 0.25 * fogStrength;
  dr *= brightnessScale;
  dg *= brightnessScale;
  db *= brightnessScale;

  // Step 3: Add slight blue-gray tint (scaled by fogStrength)
  const tintAmount = 0.15 * fogStrength;
  dr = dr * (1.0 - tintAmount) + FOG_TINT_R * tintAmount;
  dg = dg * (1.0 - tintAmount) + FOG_TINT_G * tintAmount;
  db = db * (1.0 - tintAmount) + FOG_TINT_B * tintAmount;

  return [
    Math.max(0, Math.min(1, dr)),
    Math.max(0, Math.min(1, dg)),
    Math.max(0, Math.min(1, db)),
  ];
}

// ── Map Edge Fade (Spec Section 21) ──────────────────────────────

/** Dark parchment color for map edges (normalized 0-1). */
const PARCHMENT_R = 60 / 255;
const PARCHMENT_G = 50 / 255;
const PARCHMENT_B = 40 / 255;

/**
 * Apply map edge fade to vertex colors.
 *
 * The last MAP_EDGE_FADE_TILES tiles at each map edge fade smoothly
 * toward a dark parchment color RGB(60, 50, 40), creating a natural
 * "edge of the known world" feeling with no hard cutoff.
 *
 * @param r - Red component (0-1).
 * @param g - Green component (0-1).
 * @param b - Blue component (0-1).
 * @param worldTileX - World tile X coordinate (0..MAP_SIZE-1).
 * @param worldTileZ - World tile Z coordinate (0..MAP_SIZE-1).
 * @returns Modified [r, g, b] tuple.
 */
export function applyMapEdgeFade(
  r: number, g: number, b: number,
  worldTileX: number,
  worldTileZ: number,
): [number, number, number] {
  // Distance from nearest edge on each axis
  const distX = Math.min(worldTileX, MAP_SIZE - 1 - worldTileX);
  const distZ = Math.min(worldTileZ, MAP_SIZE - 1 - worldTileZ);
  const distFromEdge = Math.min(distX, distZ);

  if (distFromEdge >= MAP_EDGE_FADE_TILES) {
    return [r, g, b];
  }

  // Smoothstep: 0.0 at tile 0 (full parchment) to 1.0 at fade boundary (no change)
  const keepFactor = smoothstep(0, MAP_EDGE_FADE_TILES, distFromEdge);
  const fadeFactor = 1.0 - keepFactor;

  return [
    Math.max(0, Math.min(1, r * keepFactor + PARCHMENT_R * fadeFactor)),
    Math.max(0, Math.min(1, g * keepFactor + PARCHMENT_G * fadeFactor)),
    Math.max(0, Math.min(1, b * keepFactor + PARCHMENT_B * fadeFactor)),
  ];
}
