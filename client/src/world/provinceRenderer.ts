/**
 * Province overlay rendering system.
 *
 * Renders semi-transparent province fills, borders, and labels as a single
 * full-map ShaderMaterial plane. Visibility adapts to camera height:
 *
 *   > 3000  (Strategic)  Full fill + borders + names
 *   1000-3000 (Regional) Borders + names, no fill
 *   300-1000 (Tactical)  Thin border lines only
 *   < 300   (Local)      No province overlay
 *
 * Province data is accumulated tile-by-tile from chunk loads into a 2048x2048
 * DataTexture (RED channel = province ID). A 42x1 colour lookup texture
 * supplies per-province RGBA. All edge detection and alpha blending is
 * performed in the fragment shader for a single draw call.
 */

import * as THREE from 'three';
import {
  MAP_SIZE,
  CHUNK_SIZE,
  PROVINCE_COUNT,
  BARBARIAN_PROVINCE_ID,
} from '../config';

// ---------------------------------------------------------------------------
// Height thresholds for camera-dependent rendering
// ---------------------------------------------------------------------------

/** Camera height above which full province fill is shown. */
const STRATEGIC_HEIGHT = 3000;
/** Camera height above which borders + names are shown (no fill). */
const REGIONAL_HEIGHT = 1000;
/** Camera height above which thin border lines are shown. */
const TACTICAL_HEIGHT = 300;
/** Smooth blend range (world units) around each threshold. */
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

  // Province 0 = barbarian territory -- invisible (alpha handled in shader)
  colors[0] = [0, 0, 0];

  // Generate 41 distinct warm-palette colours.
  // Hue distribution across Mediterranean tones: golds, terracottas,
  // olive greens, warm blues, muted purples, sandy tans.
  const hueAnchors = [
    30, 42, 18, 55, 10, 70, 25, 48, 195, 210, 35, 60, 15, 50, 8, 75,
    225, 280, 320, 38, 22, 45, 12, 65, 200, 240, 310, 28, 52, 20, 58,
    5, 68, 215, 260, 340, 32, 40, 16, 62, 185,
  ];

  for (let i = 1; i <= PROVINCE_COUNT; i++) {
    const hueIndex = hueAnchors[(i - 1) % hueAnchors.length];
    const hue = hueIndex !== undefined ? hueIndex : ((i - 1) * 37) % 360;
    // Vary saturation and lightness to improve distinguishability
    const saturation = 0.45 + ((i * 7) % 30) / 100;
    const lightness = 0.42 + ((i * 13) % 20) / 100;
    const [r, g, b] = hslToRgb(hue / 360, saturation, lightness);
    colors[i] = [r, g, b];
  }

  return colors;
}

/** Convert HSL (h in [0,1], s in [0,1], l in [0,1]) to RGB [0,255]. */
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
// GLSL Shaders
// ---------------------------------------------------------------------------

const VERTEX_SHADER = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D uProvinceMap;    // 2048x2048, RED = province ID (0-255)
  uniform sampler2D uProvinceColors; // 42x1 RGBA lookup
  uniform float uCameraHeight;
  uniform float uBorderWidth;
  uniform float uFillAlpha;
  uniform float uTime;
  uniform float uBorderGlow;

  varying vec2 vUv;
  varying vec3 vWorldPos;

  // Height thresholds (matching TS constants)
  const float STRATEGIC  = ${STRATEGIC_HEIGHT.toFixed(1)};
  const float REGIONAL   = ${REGIONAL_HEIGHT.toFixed(1)};
  const float TACTICAL   = ${TACTICAL_HEIGHT.toFixed(1)};
  const float BLEND      = ${BLEND_RANGE.toFixed(1)};
  const float MAP_SZ     = ${MAP_SIZE.toFixed(1)};

  // Look up province colour from the 42x1 palette texture.
  // Province IDs are stored as 0-255 in the red channel, so we
  // normalise to a U coordinate into the palette strip.
  vec4 getProvinceColor(float id) {
    float u = (id + 0.5) / 42.0;
    return texture2D(uProvinceColors, vec2(u, 0.5));
  }

  // Read province ID at a texel offset from current UV.
  float sampleId(vec2 baseUv, vec2 offset) {
    vec2 texelSize = vec2(1.0 / MAP_SZ);
    vec2 sampleUv = baseUv + offset * texelSize;
    // Clamp to valid range
    sampleUv = clamp(sampleUv, vec2(0.0), vec2(1.0));
    return texture2D(uProvinceMap, sampleUv).r * 255.0;
  }

  void main() {
    // ── Province ID at this fragment ────────────────────────────
    float rawId = texture2D(uProvinceMap, vUv).r * 255.0;
    float id = floor(rawId + 0.5); // round to nearest integer

    // ── Height-based visibility factors ─────────────────────────
    // smoothstep transitions with BLEND range around each threshold
    float fillFactor   = smoothstep(STRATEGIC - BLEND, STRATEGIC + BLEND, uCameraHeight);
    float borderFactor = smoothstep(TACTICAL,  TACTICAL + BLEND,  uCameraHeight);
    float fadeFactor   = smoothstep(TACTICAL - BLEND * 0.5, TACTICAL, uCameraHeight);

    // If camera is below tactical threshold, fully transparent
    if (fadeFactor < 0.001) {
      discard;
    }

    // ── Border detection (multi-sample distance field) ──────────
    // Sample 8 neighbors at varying distances for smooth border detection
    float borderDist = 999.0;
    for (int i = -2; i <= 2; i++) {
      for (int j = -2; j <= 2; j++) {
        if (i == 0 && j == 0) continue;
        float nId = floor(sampleId(vUv, vec2(float(i), float(j)) * uBorderWidth * 0.5) + 0.5);
        if (nId != id) {
          float d = length(vec2(float(i), float(j)));
          borderDist = min(borderDist, d);
        }
      }
    }

    // Distance-based border alpha with soft gradient falloff
    float borderAlpha = 1.0 - smoothstep(0.0, 3.0, borderDist);

    // ── Province colour lookup ──────────────────────────────────
    vec4 provColor = getProvinceColor(id);

    // ── Barbarian territory (ID 0) ──────────────────────────────
    // Very subtle dark overlay for barbarian land, no fill/border
    if (id < 0.5) {
      // Only show at strategic height and only as subtle darkening
      float barbAlpha = 0.08 * fillFactor * fadeFactor;
      if (barbAlpha < 0.001) {
        discard;
      }
      gl_FragColor = vec4(0.0, 0.0, 0.0, barbAlpha);
      return;
    }

    // ── Compose final colour ────────────────────────────────────
    vec3 fillColor = provColor.rgb;

    // Glow border color: 1.5x province color for bloom pickup
    vec3 borderColor = provColor.rgb * 1.5;
    // Add subtle emissive warm glow scaled by glow intensity
    borderColor += vec3(0.15, 0.1, 0.05) * borderAlpha * uBorderGlow;

    float alpha = 0.0;
    vec3 color  = vec3(0.0);

    if (borderAlpha > 0.01) {
      // Borders visible from tactical height upward
      // Thicker appearance at higher altitudes, thin at tactical
      float heightBorderAlpha = mix(0.5, 0.85, fillFactor);
      // Subtle pulse animation on border brightness
      float pulse = 0.9 + 0.1 * sin(uTime * 1.2);
      float finalBorderAlpha = borderAlpha * heightBorderAlpha * borderFactor * pulse;

      // Blend fill behind the border gradient
      float fillAlphaHere = uFillAlpha * fillFactor;
      color = mix(fillColor, borderColor, borderAlpha);
      alpha = max(finalBorderAlpha, fillAlphaHere);
    } else {
      // Fill only at strategic height
      color = fillColor;
      alpha = uFillAlpha * fillFactor;
    }

    // Apply overall fade factor (smooth in/out at tactical boundary)
    alpha *= fadeFactor;

    if (alpha < 0.001) {
      discard;
    }

    gl_FragColor = vec4(color, alpha);
  }
`;

// ---------------------------------------------------------------------------
// ProvinceRenderer
// ---------------------------------------------------------------------------

export class ProvinceRenderer {
  private readonly scene: THREE.Scene;
  private readonly provinceGrid: Uint8Array;
  private readonly provinceTexture: THREE.DataTexture;
  private readonly colorTexture: THREE.DataTexture;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly mesh: THREE.Mesh;

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
    const colorCount = PROVINCE_COUNT + 1; // 0..41 inclusive
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

    // ── ShaderMaterial ──────────────────────────────────────────
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uProvinceMap:    { value: this.provinceTexture },
        uProvinceColors: { value: this.colorTexture },
        uCameraHeight:   { value: 0.0 },
        uBorderWidth:    { value: 2.0 },
        uFillAlpha:      { value: 0.30 },
        uTime:           { value: 0.0 },
        uBorderGlow:     { value: 1.0 },
      },
    });

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

  /**
   * Populate a 32x32 region of the province grid from chunk data.
   * Call this as each chunk's province data becomes available.
   */
  updateChunkProvinces(cx: number, cy: number, provinces: Uint8Array): void {
    const startX = cx * CHUNK_SIZE;
    const startY = cy * CHUNK_SIZE;

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const worldX = startX + lx;
        const worldY = startY + ly;

        // Bounds check
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

  /**
   * Per-frame update. Sets camera-height uniform and uploads dirty texture.
   */
  update(cameraHeight: number, elapsed = 0): void {
    // Upload texture if chunk data changed since last frame
    if (this.needsTextureUpload) {
      this.provinceTexture.needsUpdate = true;
      this.needsTextureUpload = false;
    }

    // Update camera height uniform
    const uCameraHeight = this.material.uniforms['uCameraHeight'];
    if (uCameraHeight) {
      uCameraHeight.value = cameraHeight;
    }

    // Update time uniform for border pulse animation
    const uTime = this.material.uniforms['uTime'];
    if (uTime) {
      uTime.value = elapsed;
    }

    // Hide mesh entirely when below lowest threshold (performance) or user-toggled off
    this.mesh.visible = this.userVisible && cameraHeight >= TACTICAL_HEIGHT - BLEND_RANGE;
  }

  /**
   * Toggle user-controlled visibility of the province overlay.
   * When hidden by the user, the overlay stays hidden regardless of camera height.
   */
  toggleVisible(): void {
    this.userVisible = !this.userVisible;
    this.mesh.visible = this.userVisible && this.mesh.visible;
  }

  /**
   * Dispose all GPU resources. Call when the province renderer is no longer needed.
   */
  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.provinceTexture.dispose();
    this.colorTexture.dispose();
  }
}
