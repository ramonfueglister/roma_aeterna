/**
 * Async loader for heightmap and province-map PNG images.
 *
 * Loads 2048x2048 grayscale PNGs into Uint8Array buffers that can be
 * sampled by proceduralChunk.ts to produce geographically-accurate terrain.
 *
 * Falls back to procedural generation if images fail to load.
 */

import { MAP_SIZE } from '../config';
import { createLogger } from '../core/logger';

const log = createLogger('heightmap');

// ── Singleton state ─────────────────────────────────────────────

let heightmapData: Uint8Array | null = null;
let provinceData: Uint8Array | null = null;
let loadAttempted = false;

// ── Public API ──────────────────────────────────────────────────

/**
 * Load heightmap and province-map PNGs.
 * Must be called before chunk generation begins.
 * Safe to call multiple times (idempotent).
 */
export async function loadHeightmaps(): Promise<void> {
  if (loadAttempted) return;
  loadAttempted = true;

  const [hm, pm] = await Promise.allSettled([
    loadImage('/heightmaps/mediterranean.png'),
    loadImage('/heightmaps/provinces.png'),
  ]);

  if (hm.status === 'fulfilled' && hm.value) {
    heightmapData = hm.value;
    log.info(`Heightmap loaded: ${MAP_SIZE}x${MAP_SIZE}`);
  } else {
    log.warn('Heightmap not found, using procedural fallback');
  }

  if (pm.status === 'fulfilled' && pm.value) {
    provinceData = pm.value;
    log.info(`Province map loaded: ${MAP_SIZE}x${MAP_SIZE}`);
  } else {
    log.warn('Province map not found, using procedural fallback');
  }
}

/**
 * Sample height at a world tile coordinate (0..2047).
 * Returns a value in [0, 127] or null if heightmap not loaded.
 */
export function sampleHeight(wx: number, wy: number): number | null {
  if (!heightmapData) return null;

  const x = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(wx)));
  const y = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(wy)));
  const idx = y * MAP_SIZE + x;
  const raw = heightmapData[idx];
  return raw !== undefined ? raw : null;
}

/**
 * Sample province ID at a world tile coordinate (0..2047).
 * Returns a province ID in [0, 41] or null if province map not loaded.
 */
export function sampleProvince(wx: number, wy: number): number | null {
  if (!provinceData) return null;

  const x = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(wx)));
  const y = Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(wy)));
  const idx = y * MAP_SIZE + x;
  const raw = provinceData[idx];
  return raw !== undefined ? raw : null;
}

/** Whether a real heightmap is loaded (not procedural fallback). */
export function hasHeightmap(): boolean {
  return heightmapData !== null;
}

/** Get the raw heightmap Uint8Array (or null if not loaded). */
export function getHeightmapData(): Uint8Array | null {
  return heightmapData;
}

/** Whether a real province map is loaded (not procedural fallback). */
export function hasProvinceMap(): boolean {
  return provinceData !== null;
}

// ── Internal ────────────────────────────────────────────────────

/**
 * Load a grayscale PNG into a Uint8Array via canvas.
 * Extracts the RED channel as the data source.
 */
async function loadImage(url: string): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = MAP_SIZE;
      canvas.height = MAP_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        log.warn(`Canvas 2D context unavailable for ${url}`);
        resolve(null);
        return;
      }

      ctx.drawImage(img, 0, 0, MAP_SIZE, MAP_SIZE);
      const imageData = ctx.getImageData(0, 0, MAP_SIZE, MAP_SIZE);
      const rgba = imageData.data;

      // Extract RED channel only
      const result = new Uint8Array(MAP_SIZE * MAP_SIZE);
      for (let i = 0; i < result.length; i++) {
        result[i] = rgba[i * 4]!;
      }

      resolve(result);
    };

    img.onerror = () => {
      log.warn(`Failed to load ${url}`);
      resolve(null);
    };

    img.src = url;
  });
}
