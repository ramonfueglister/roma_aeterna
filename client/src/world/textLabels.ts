/**
 * Text label rendering system for cities and provinces.
 *
 * Uses troika-three-text for SDF-based text rendering with the Cinzel
 * serif font, appropriate for the Roman Empire theme. Labels are pooled
 * (never created/destroyed per frame), billboard toward the camera,
 * and LOD-culled by importance with a configurable cap.
 *
 * Visibility rules (by camera height):
 *   - Province names:          camera height > 1000
 *   - Major cities (Tier 1-2): camera height 300..3000
 *   - All cities:              camera height < 300
 *
 * Labels fade in/out during zoom transitions and scale with camera height
 * for consistent screen-space readability.
 */

import * as THREE from 'three';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error -- troika-three-text has no type declarations
import { Text } from 'troika-three-text';
import type { CityData, CityTier } from '../types';
import { MAP_SIZE } from '../config';
import { sampleHeight, hasHeightmap } from './heightmapLoader';

// ---------------------------------------------------------------------------
// Troika Text type shim (minimal surface used by this module)
// ---------------------------------------------------------------------------

/** Minimal type overlay for troika-three-text's Text class (extends Mesh). */
interface TroikaText extends THREE.Mesh {
  text: string;
  font: string | null;
  fontSize: number;
  color: number | string | THREE.Color | null;
  anchorX: number | 'left' | 'center' | 'right';
  anchorY: number | 'top' | 'top-baseline' | 'middle' | 'bottom-baseline' | 'bottom';
  letterSpacing: number;
  outlineWidth: number | string;
  outlineColor: number | string | THREE.Color;
  outlineOpacity: number;
  fillOpacity: number;
  depthOffset: number;
  orientation: string;
  maxWidth: number;
  sync: (callback?: () => void) => void;
  dispose: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Font served from public/fonts/ via Vite. */
const FONT_URL = '/fonts/Cinzel-Regular.ttf';

/** Default maximum simultaneously visible labels. */
const DEFAULT_LABEL_CAP = 50;

/** Fixed Y offset above terrain for city labels. */
const CITY_LABEL_Y_OFFSET = 8;

/** Fixed Y height for province labels (above most terrain). */
const PROVINCE_LABEL_Y = 90;

/** Render order ensures labels draw on top of all geometry. */
const LABEL_RENDER_ORDER = 100;

/**
 * Importance weight for sorting. Lower value = higher importance.
 * Province labels sit between tier 2 and tier 3 in priority.
 */
const IMPORTANCE_WEIGHTS: Record<'city1' | 'city2' | 'province' | 'city3' | 'city4', number> = {
  city1: 0,
  city2: 1,
  province: 2,
  city3: 3,
  city4: 4,
};

/** Camera height transition band width for fade in/out (world units). */
const FADE_BAND = 100;

/** Half the map size, used for centering tile coordinates to world space. */
const HALF_MAP = MAP_SIZE / 2;

// ---------------------------------------------------------------------------
// Province label data interface
// ---------------------------------------------------------------------------

export interface ProvinceLabelData {
  id: number;
  name: string;
  labelX: number;
  labelZ: number;
  color: number;
}

// ---------------------------------------------------------------------------
// Internal label descriptor
// ---------------------------------------------------------------------------

/** Unified descriptor for both city and province labels. */
interface LabelEntry {
  /** Display text. */
  readonly text: string;
  /** World X position. */
  readonly worldX: number;
  /** World Y position. */
  readonly worldY: number;
  /** World Z position. */
  readonly worldZ: number;
  /** Sort priority (lower = more important). */
  readonly importance: number;
  /** True for province labels, false for city labels. */
  readonly isProvince: boolean;
  /** Province color (only meaningful when isProvince is true). */
  readonly provinceColor: number;
  /** City tier (only meaningful when isProvince is false). */
  readonly tier: CityTier;
}

/** Scored label candidate with computed distance and opacity. */
interface ScoredLabel {
  readonly entry: LabelEntry;
  readonly opacity: number;
  readonly distSq: number;
}

// ---------------------------------------------------------------------------
// TextLabelRenderer
// ---------------------------------------------------------------------------

export class TextLabelRenderer {
  private readonly scene: THREE.Scene;

  /** Object pool of reusable troika Text instances. */
  private readonly pool: TroikaText[] = [];

  /** Current maximum visible label count. */
  private labelCap: number = DEFAULT_LABEL_CAP;

  /** All registered city label entries. */
  private cityEntries: LabelEntry[] = [];

  /** All registered province label entries. */
  private provinceEntries: LabelEntry[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.buildPool(DEFAULT_LABEL_CAP);
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Provide the full city list. Builds internal label entries from city data.
   * City tileX maps to world X, tileY maps to world Z (top-down XZ plane).
   * Call once after city data is loaded (or again if cities change).
   */
  setCities(cities: CityData[]): void {
    const useHm = hasHeightmap();
    this.cityEntries = cities.map((city): LabelEntry => {
      const tierKey = `city${city.tier}` as 'city1' | 'city2' | 'city3' | 'city4';
      const terrainH = useHm ? (sampleHeight(city.tileX, city.tileY) ?? 0) : 0;
      return {
        text: city.latinName || city.name,
        worldX: city.tileX - HALF_MAP,
        worldY: terrainH + CITY_LABEL_Y_OFFSET,
        worldZ: city.tileY - HALF_MAP,
        importance: IMPORTANCE_WEIGHTS[tierKey],
        isProvince: false,
        provinceColor: 0xffffff,
        tier: city.tier,
      };
    });
  }

  /**
   * Provide province label data. Builds internal province label entries.
   * Province labelX/labelZ are already in world-space coordinates.
   * Call once after province data is available.
   */
  setProvinces(provinces: ProvinceLabelData[]): void {
    this.provinceEntries = provinces.map((prov): LabelEntry => ({
      text: prov.name,
      worldX: prov.labelX,
      worldY: PROVINCE_LABEL_Y,
      worldZ: prov.labelZ,
      importance: IMPORTANCE_WEIGHTS.province,
      isProvince: true,
      provinceColor: prov.color,
      tier: 1, // unused for provinces; satisfies LabelEntry shape
    }));
  }

  /**
   * Per-frame update. Determines visible labels based on camera state,
   * assigns pool objects to the top-priority labels, hides unused ones.
   */
  update(cameraHeight: number, cameraX: number, cameraZ: number): void {
    // Gather candidate labels based on camera height visibility rules
    const candidates = this.gatherCandidates(cameraHeight);

    // Compute distance from camera for each candidate and sort by priority
    const scored = this.scoreAndSort(candidates, cameraX, cameraZ, cameraHeight);

    // Take top N up to the label cap
    const visibleCount = Math.min(scored.length, this.labelCap);

    // Ensure pool is large enough (grows lazily if cap was increased)
    if (this.pool.length < this.labelCap) {
      this.buildPool(this.labelCap);
    }

    // Assign visible labels to pool objects
    for (let i = 0; i < visibleCount; i++) {
      const scoredEntry = scored[i];
      if (!scoredEntry) continue;

      const textObj = this.pool[i];
      if (!textObj) continue;

      this.assignLabel(textObj, scoredEntry, cameraHeight);
    }

    // Hide remaining pool objects that are not needed this frame
    for (let i = visibleCount; i < this.pool.length; i++) {
      const textObj = this.pool[i];
      if (!textObj) continue;

      if (textObj.visible) {
        textObj.visible = false;
      }
    }
  }

  /**
   * Change the maximum number of simultaneously visible labels.
   */
  setLabelCap(cap: number): void {
    this.labelCap = Math.max(1, cap);
    if (this.pool.length < this.labelCap) {
      this.buildPool(this.labelCap);
    }
  }

  /**
   * Dispose all GPU resources and remove labels from the scene.
   */
  dispose(): void {
    for (const textObj of this.pool) {
      this.scene.remove(textObj);
      textObj.dispose();
    }
    this.pool.length = 0;
    this.cityEntries = [];
    this.provinceEntries = [];
  }

  // ── Internal ──────────────────────────────────────────────────

  /**
   * Build or expand the object pool to the target size.
   * New Text objects are created invisible and added to the scene.
   */
  private buildPool(targetSize: number): void {
    while (this.pool.length < targetSize) {
      const textObj = new Text() as TroikaText;

      // Shared properties that do not change per-assignment
      textObj.font = FONT_URL;
      textObj.anchorX = 'center';
      textObj.anchorY = 'bottom';
      textObj.depthOffset = 0;
      textObj.renderOrder = LABEL_RENDER_ORDER;
      textObj.visible = false;

      // Disable depth test so labels render on top of geometry.
      // troika creates its derived material lazily on first sync,
      // but the base material is a MeshBasicMaterial we can configure now.
      const baseMat = textObj.material;
      if (baseMat && !Array.isArray(baseMat)) {
        baseMat.depthTest = false;
        baseMat.transparent = true;
      }

      // Billboard orientation: troika text renders in the XY plane.
      // We use '+x+y' (default) and handle rotation in assignLabel.
      textObj.orientation = '+x+y';

      this.scene.add(textObj);
      this.pool.push(textObj);
    }
  }

  /**
   * Gather all label entries that should be considered visible
   * at the current camera height, each annotated with a fade opacity.
   */
  private gatherCandidates(
    cameraHeight: number,
  ): Array<{ entry: LabelEntry; opacity: number }> {
    const results: Array<{ entry: LabelEntry; opacity: number }> = [];

    // ── Province labels: visible when camera height > 1000 ──
    // Fade in between (1000 - FADE_BAND) and 1000
    if (cameraHeight > 1000 - FADE_BAND) {
      const provinceOpacity = smoothstep(1000 - FADE_BAND, 1000, cameraHeight);
      if (provinceOpacity > 0.01) {
        for (const entry of this.provinceEntries) {
          results.push({ entry, opacity: provinceOpacity });
        }
      }
    }

    // ── City labels ──
    // Major (Tier 1-2): visible at camera height 300..3000
    //   - Fade in between (300 - FADE_BAND)..300
    //   - Fade out between 3000..(3000 + FADE_BAND)
    // Minor (Tier 3-4): visible when camera height < 300
    //   - Fade out between (300 - FADE_BAND)..300

    const majorFadeIn = smoothstep(300 - FADE_BAND, 300, cameraHeight);
    const majorFadeOut = 1.0 - smoothstep(3000, 3000 + FADE_BAND, cameraHeight);
    const majorCityOpacity = Math.min(majorFadeIn, majorFadeOut);

    const allCityOpacity = 1.0 - smoothstep(300 - FADE_BAND, 300, cameraHeight);

    for (const entry of this.cityEntries) {
      const isMajor = entry.tier === 1 || entry.tier === 2;

      if (isMajor) {
        // Major cities are visible in both the "all cities" and "major" ranges.
        // Use the higher opacity of the two.
        const combinedOpacity = Math.max(majorCityOpacity, allCityOpacity);
        if (combinedOpacity > 0.01) {
          results.push({ entry, opacity: combinedOpacity });
        }
      } else {
        // Minor cities visible only in the "all cities" range
        if (allCityOpacity > 0.01) {
          results.push({ entry, opacity: allCityOpacity });
        }
      }
    }

    return results;
  }

  /**
   * Score candidates by importance and distance, then sort.
   * Filters out labels beyond a camera-height-dependent visibility radius.
   */
  private scoreAndSort(
    candidates: Array<{ entry: LabelEntry; opacity: number }>,
    cameraX: number,
    cameraZ: number,
    cameraHeight: number,
  ): ScoredLabel[] {
    // Visibility radius scales with camera height so zoomed-out views
    // can still reach distant province labels
    const visRadius = Math.max(200, cameraHeight * 1.5);
    const visRadiusSq = visRadius * visRadius;

    const scored: ScoredLabel[] = [];

    for (const candidate of candidates) {
      const dx = candidate.entry.worldX - cameraX;
      const dz = candidate.entry.worldZ - cameraZ;
      const distSq = dx * dx + dz * dz;

      if (distSq <= visRadiusSq) {
        scored.push({
          entry: candidate.entry,
          opacity: candidate.opacity,
          distSq,
        });
      }
    }

    // Sort by importance first (lower = higher priority),
    // then by distance within the same importance tier
    scored.sort((a, b) => {
      const impDiff = a.entry.importance - b.entry.importance;
      if (impDiff !== 0) return impDiff;
      return a.distSq - b.distSq;
    });

    return scored;
  }

  /**
   * Configure a pool Text object to display a specific label entry.
   * Updates text, position, style, opacity, font size, and triggers sync.
   */
  private assignLabel(
    textObj: TroikaText,
    scored: ScoredLabel,
    cameraHeight: number,
  ): void {
    const { entry, opacity } = scored;

    // Font size scales with camera height for consistent screen-space size.
    // Base sizes are tuned per label type / city tier.
    const baseFontSize = entry.isProvince ? 28 : getCityFontSize(entry.tier);
    const fontSize = baseFontSize * Math.max(0.3, cameraHeight / 1000);

    // Update text content only when changed to avoid unnecessary re-rasterization
    if (textObj.text !== entry.text) {
      textObj.text = entry.text;
    }

    if (textObj.fontSize !== fontSize) {
      textObj.fontSize = fontSize;
    }

    // Position in world space
    textObj.position.set(entry.worldX, entry.worldY, entry.worldZ);

    // Billboard: troika text renders in the XY plane by default.
    // Rotate -90 degrees around X so text lies in the XZ plane facing up,
    // readable from a top-down or angled camera perspective.
    textObj.rotation.set(-Math.PI / 2, 0, 0);

    // Style per label type
    if (entry.isProvince) {
      textObj.color = entry.provinceColor;
      textObj.outlineWidth = fontSize * 0.03;
      textObj.outlineColor = 0x000000;
      textObj.outlineOpacity = opacity * 0.7;
      textObj.fillOpacity = opacity * 0.7;
      textObj.letterSpacing = 0.15;
    } else {
      textObj.color = 0xffffff;
      textObj.outlineWidth = fontSize * 0.05;
      textObj.outlineColor = 0x000000;
      textObj.outlineOpacity = opacity;
      textObj.fillOpacity = opacity;
      textObj.letterSpacing = 0.02;
    }

    // Ensure depth test is disabled on the derived material.
    // troika creates a derived material lazily, so we enforce this
    // each frame to cover the case where the material was just swapped.
    const mat = textObj.material;
    if (mat) {
      if (Array.isArray(mat)) {
        for (const m of mat) {
          m.depthTest = false;
          m.transparent = true;
        }
      } else {
        mat.depthTest = false;
        mat.transparent = true;
      }
    }

    textObj.renderOrder = LABEL_RENDER_ORDER;
    textObj.visible = true;
    textObj.sync();
  }
}

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

/**
 * Return the base font size for a city tier.
 * Tier 1 (capitals/major) largest, tier 4 (minor settlements) smallest.
 */
function getCityFontSize(tier: CityTier): number {
  switch (tier) {
    case 1: return 18;
    case 2: return 14;
    case 3: return 10;
    case 4: return 7;
  }
}

/**
 * Smooth Hermite interpolation between edge0 and edge1.
 * Returns 0 when x <= edge0, 1 when x >= edge1, smooth curve between.
 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
