/**
 * Province overlay rendering system (TSL / WebGPURenderer).
 *
 * Renders semi-transparent province fills, borders, and labels as a single
 * full-map MeshBasicNodeMaterial plane. Visibility adapts to camera height:
 *
 *   > 3000  (Strategic)  Full fill + borders + names
 *   1000-3000 (Regional) Borders + names, no fill
 *   300-1000 (Tactical)  Thin border lines only
 *   < 300   (Local)      No province overlay
 *
 * Province data is accumulated tile-by-tile from chunk loads into a 2048x2048
 * DataTexture (RED channel = province ID). A 42x1 colour lookup texture
 * supplies per-province RGBA. All edge detection and alpha blending is
 * performed via TSL nodes for a single draw call.
 */

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  texture,
  uniform,
  uv,
  float,
  vec2,
  vec3,
  vec4,
  Fn,
  min,
  max,
  mix,
  sin,
  smoothstep,
  length,
  clamp,
  floor,
  select,
  Loop,
} from 'three/tsl';
import {
  MAP_SIZE,
  CHUNK_SIZE,
  PROVINCE_COUNT,
  BARBARIAN_PROVINCE_ID,
} from '../config';

// ---------------------------------------------------------------------------
// Height thresholds for camera-dependent rendering
// ---------------------------------------------------------------------------

const STRATEGIC_HEIGHT = 3000;
const TACTICAL_HEIGHT = 300;
const BLEND_RANGE = 200;

/** Y position of the overlay plane, slightly above terrain / water. */
const OVERLAY_Y = 71;

// ---------------------------------------------------------------------------
// Province colour palette -- 41 warm Mediterranean colours + barbarian (0)
// ---------------------------------------------------------------------------

function generateProvinceColors(): [number, number, number][] {
  const colors: [number, number, number][] = new Array<[number, number, number]>(
    PROVINCE_COUNT + 1,
  );

  colors[0] = [0, 0, 0];

  const hueAnchors = [
    30, 42, 18, 55, 10, 70, 25, 48, 195, 210, 35, 60, 15, 50, 8, 75,
    225, 280, 320, 38, 22, 45, 12, 65, 200, 240, 310, 28, 52, 20, 58,
    5, 68, 215, 260, 340, 32, 40, 16, 62, 185,
  ];

  for (let i = 1; i <= PROVINCE_COUNT; i++) {
    const hueIndex = hueAnchors[(i - 1) % hueAnchors.length];
    const hue = hueIndex !== undefined ? hueIndex : ((i - 1) * 37) % 360;
    const saturation = 0.45 + ((i * 7) % 30) / 100;
    const lightness = 0.42 + ((i * 13) % 20) / 100;
    const [r, g, b] = hslToRgb(hue / 360, saturation, lightness);
    colors[i] = [r, g, b];
  }

  return colors;
}

function hslToRgb(
  h: number,
  s: number,
  l: number,
): [number, number, number] {
  let r: number;
  let g: number;
  let b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return [
    Math.round(r * 255),
    Math.round(g * 255),
    Math.round(b * 255),
  ];
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

const PROVINCE_COLORS = generateProvinceColors();

// ---------------------------------------------------------------------------
// ProvinceRenderer
// ---------------------------------------------------------------------------

export class ProvinceRenderer {
  private readonly scene: THREE.Scene;
  private readonly provinceGrid: Uint8Array;
  private readonly provinceTexture: THREE.DataTexture;
  private readonly colorTexture: THREE.DataTexture;
  private readonly material: InstanceType<typeof MeshBasicNodeMaterial>;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly mesh: THREE.Mesh;

  // TSL uniforms
  private readonly _uCameraHeight = uniform(0.0);
  private readonly _uBorderWidth = uniform(2.0);
  private readonly _uFillAlpha = uniform(0.30);
  private readonly _uTime = uniform(0.0);
  private readonly _uBorderGlow = uniform(1.0);

  private needsTextureUpload = false;
  private userVisible = true;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // ── Province grid (CPU-side, accumulated from chunk loads) ──
    this.provinceGrid = new Uint8Array(MAP_SIZE * MAP_SIZE);

    // ── Province ID texture (2048x2048, single RED channel) ─────
    this.provinceTexture = new THREE.DataTexture(
      this.provinceGrid,
      MAP_SIZE,
      MAP_SIZE,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    this.provinceTexture.minFilter = THREE.NearestFilter;
    this.provinceTexture.magFilter = THREE.NearestFilter;
    this.provinceTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.provinceTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.provinceTexture.needsUpdate = true;

    // ── Province colour lookup texture (42x1, RGBA) ─────────────
    const colorCount = PROVINCE_COUNT + 1;
    const colorData = new Uint8Array(colorCount * 4);
    for (let i = 0; i < colorCount; i++) {
      const entry = PROVINCE_COLORS[i];
      if (entry) {
        colorData[i * 4 + 0] = entry[0];
        colorData[i * 4 + 1] = entry[1];
        colorData[i * 4 + 2] = entry[2];
        colorData[i * 4 + 3] = i === BARBARIAN_PROVINCE_ID ? 0 : 255;
      }
    }
    this.colorTexture = new THREE.DataTexture(
      colorData,
      colorCount,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    this.colorTexture.minFilter = THREE.NearestFilter;
    this.colorTexture.magFilter = THREE.NearestFilter;
    this.colorTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.colorTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.colorTexture.needsUpdate = true;

    // ── TSL Node Material ───────────────────────────────────────
    this.material = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // TSL texture nodes
    const tProvMap = texture(this.provinceTexture);
    const tProvColors = texture(this.colorTexture);

    const uCamH = this._uCameraHeight;
    const uBorderW = this._uBorderWidth;
    const uFillA = this._uFillAlpha;
    const uTime = this._uTime;
    const uGlow = this._uBorderGlow;

    // Build the fragment output as a TSL Fn
    const provinceFn = Fn(() => {
      const baseUv = uv();
      const texelSize = float(1.0 / MAP_SIZE);

      // ── Province ID at this fragment
      const rawId = tProvMap.uv(baseUv).r.mul(255.0);
      const id = floor(rawId.add(0.5));

      // ── Height-based visibility factors
      const fillFactor = smoothstep(
        float(STRATEGIC_HEIGHT - BLEND_RANGE),
        float(STRATEGIC_HEIGHT + BLEND_RANGE),
        uCamH,
      );
      const borderFactor = smoothstep(
        float(TACTICAL_HEIGHT),
        float(TACTICAL_HEIGHT + BLEND_RANGE),
        uCamH,
      );
      const fadeFactor = smoothstep(
        float(TACTICAL_HEIGHT - BLEND_RANGE * 0.5),
        float(TACTICAL_HEIGHT),
        uCamH,
      );

      // ── Border detection (5x5 neighbor sampling)
      // Sample neighbors to find nearest province boundary
      const borderDist = float(999.0).toVar();

      // Unrolled 5x5 loop (TSL Loop requires integer range)
      // We sample at offsets [-2, -1, 0, 1, 2] × [-2, -1, 0, 1, 2]
      // skipping (0,0), scaled by borderWidth * 0.5
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Loop(5, ({ i: ii }: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Loop(5, ({ i: jj }: any) => {
          const fi = ii.toFloat().sub(2.0);
          const fj = jj.toFloat().sub(2.0);
          const isCenter = fi.equal(0.0).and(fj.equal(0.0));

          const offsetUv = baseUv.add(
            vec2(fi, fj).mul(uBorderW).mul(0.5).mul(texelSize),
          );
          const clampedUv = clamp(offsetUv, vec2(0.0), vec2(1.0));
          const nRaw = tProvMap.uv(clampedUv).r.mul(255.0);
          const nId = floor(nRaw.add(0.5));

          const isDiff = nId.notEqual(id);
          const d = length(vec2(fi, fj));

          // Update minimum border distance (skip center, skip same province)
          borderDist.assign(
            select(isCenter, borderDist,
              select(isDiff, min(borderDist, d), borderDist),
            ),
          );
        });
      });

      const borderAlpha = float(1.0).sub(smoothstep(float(0.0), float(3.0), borderDist));

      // ── Province colour lookup
      const colorU = id.add(0.5).div(42.0);
      const provColor = tProvColors.uv(vec2(colorU, 0.5));

      // ── Compose output
      const fillColor = provColor.rgb;
      const borderColor = provColor.rgb.mul(1.5).add(
        vec3(0.15, 0.1, 0.05).mul(borderAlpha).mul(uGlow),
      );

      // Border pulse animation
      const pulse = float(0.9).add(float(0.1).mul(sin(uTime.mul(1.2))));

      // Height-dependent border alpha
      const heightBorderAlpha = mix(float(0.5), float(0.85), fillFactor);
      const finalBorderAlpha = borderAlpha.mul(heightBorderAlpha).mul(borderFactor).mul(pulse);
      const fillAlphaHere = uFillA.mul(fillFactor);

      // Blend fill and border
      const hasBorder = borderAlpha.greaterThan(0.01);
      const color = select(hasBorder,
        mix(fillColor, borderColor, borderAlpha),
        fillColor,
      );
      const alpha = select(hasBorder,
        max(finalBorderAlpha, fillAlphaHere),
        fillAlphaHere,
      ).mul(fadeFactor);

      // Barbarian territory: subtle dark overlay
      const isBarbarian = id.lessThan(0.5);
      const barbAlpha = float(0.08).mul(fillFactor).mul(fadeFactor);

      const finalColor = select(isBarbarian, vec3(0.0), color);
      const finalAlpha = select(isBarbarian, barbAlpha, alpha);

      return vec4(finalColor, finalAlpha);
    });

    const output = provinceFn();
    this.material.colorNode = output.rgb;
    this.material.opacityNode = output.a;

    // ── Geometry (XZ plane spanning the full map) ───────────────
    this.geometry = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 1, 1);
    this.geometry.rotateX(-Math.PI / 2);

    // ── Mesh ────────────────────────────────────────────────────
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.set(MAP_SIZE / 2, OVERLAY_Y, MAP_SIZE / 2);
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  // ── Public API ──────────────────────────────────────────────────

  updateChunkProvinces(cx: number, cy: number, provinces: Uint8Array): void {
    const startX = cx * CHUNK_SIZE;
    const startY = cy * CHUNK_SIZE;

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const worldX = startX + lx;
        const worldY = startY + ly;

        if (worldX < 0 || worldX >= MAP_SIZE || worldY < 0 || worldY >= MAP_SIZE) {
          continue;
        }

        const localIndex = ly * CHUNK_SIZE + lx;
        const value = provinces[localIndex];
        if (value === undefined) continue;

        const gridIndex = worldY * MAP_SIZE + worldX;
        this.provinceGrid[gridIndex] = value;
      }
    }

    this.needsTextureUpload = true;
  }

  update(cameraHeight: number, elapsed = 0): void {
    if (this.needsTextureUpload) {
      this.provinceTexture.needsUpdate = true;
      this.needsTextureUpload = false;
    }

    this._uCameraHeight.value = cameraHeight;
    this._uTime.value = elapsed;

    this.mesh.visible = this.userVisible && cameraHeight >= TACTICAL_HEIGHT - BLEND_RANGE;
  }

  toggleVisible(): void {
    this.userVisible = !this.userVisible;
    this.mesh.visible = this.userVisible && this.mesh.visible;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.provinceTexture.dispose();
    this.colorTexture.dispose();
  }
}
