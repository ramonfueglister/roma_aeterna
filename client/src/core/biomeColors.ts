/**
 * Biome color palette for the voxel world.
 * All colors are RGB hex values matching the Mediterranean/Roman Empire aesthetic.
 */

import { BiomeType } from '../types';

/** Base biome colors as 0xRRGGBB values. */
export const BIOME_COLORS: Record<BiomeType, number> = {
  [BiomeType.WATER_DEEP]: 0x1a3a5c,
  [BiomeType.WATER_SHALLOW]: 0x2d5f8a,
  [BiomeType.SAND]: 0xc4a854,
  [BiomeType.GRASS]: 0x5a8a3c,
  [BiomeType.FOREST]: 0x3d6b2e,
  [BiomeType.DENSE_FOREST]: 0x2a5420,
  [BiomeType.SCRUB]: 0x8a9a5c,
  [BiomeType.FARMLAND]: 0x7aa04a,
  [BiomeType.MARSH]: 0x4a6a4a,
  [BiomeType.DESERT]: 0xd4b862,
  [BiomeType.MOUNTAIN]: 0x6a6a6a,
  [BiomeType.SNOW]: 0xdadae0,
  [BiomeType.ROAD]: 0x8a7a62,
  [BiomeType.RIVER]: 0x3a6a8a,
  [BiomeType.CITY]: 0xa09070,
  [BiomeType.COAST]: 0xa0905a,
  [BiomeType.STEPPE]: 0x9a9a5c,
  [BiomeType.VOLCANIC]: 0x4a3a30,
  [BiomeType.OLIVE_GROVE]: 0x5a7a3a,
  [BiomeType.VINEYARD]: 0x6a5a3a,
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
 * Deterministic based on position for consistency across LODs.
 */
export function applyColorNoise(
  r: number, g: number, b: number,
  x: number, y: number, z: number,
): [number, number, number] {
  // Simple hash-based noise, deterministic per position
  const hash = Math.sin(x * 12.9898 + y * 78.233 + z * 45.164) * 43758.5453;
  const noise = (hash - Math.floor(hash)) * 0.1 - 0.05; // ±5%
  return [
    Math.max(0, Math.min(1, r + noise)),
    Math.max(0, Math.min(1, g + noise * 0.8)),
    Math.max(0, Math.min(1, b + noise * 0.6)),
  ];
}
