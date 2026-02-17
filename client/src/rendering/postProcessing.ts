/**
 * Post-processing pipeline for Roma Aeterna.
 *
 * Chain: RenderPass -> UnrealBloomPass -> TiltShiftPass -> ColorGradingPass -> ParchmentOverlayPass -> VignettePass
 *
 * All passes are always active. Parchment overlay fades in above camera height 2000.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { createLogger } from '../core/logger';

const log = createLogger('postfx');

// ── Vignette Shader ──────────────────────────────────────────────

const VignetteShader = {
  name: 'VignetteShader',

  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    intensity: { value: 0.4 },
    smoothness: { value: 0.5 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float intensity;
    uniform float smoothness;

    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Distance from center, normalized so corners reach ~1.0
      vec2 centeredUv = vUv - 0.5;
      float dist = length(centeredUv) * 2.0; // 0 at center, ~1.414 at corners

      // Smooth falloff from center to edges
      float vignette = 1.0 - smoothstep(1.0 - smoothness, 1.0 + smoothness * 0.5, dist);
      vignette = mix(1.0, vignette, intensity);

      color.rgb *= vignette;
      gl_FragColor = color;
    }
  `,
} as const;

// ── Color Grading Shader ─────────────────────────────────────────

const ColorGradingShader = {
  name: 'ColorGradingShader',

  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    saturation: { value: 0.85 },
    lift: { value: new THREE.Vector3(0.04, 0.03, 0.01) },    // warm amber shadows
    gamma: { value: new THREE.Vector3(1.02, 1.0, 0.96) },    // slight warm midtones
    gain: { value: new THREE.Vector3(1.04, 1.02, 0.94) },    // golden highlights
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform vec3 lift;
    uniform vec3 gamma;
    uniform vec3 gain;

    varying vec2 vUv;

    // Rec. 709 luminance weights
    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // --- Lift / Gamma / Gain ---
      // Lift: affects shadows (additive offset, fades out in highlights)
      // Gain: multiplies the whole signal
      // Gamma: power curve on the midtones
      vec3 c = color.rgb;

      // Apply gain (scale)
      c *= gain;

      // Apply lift (offset, strongest in shadows)
      c += lift * (1.0 - c);

      // Apply gamma (power curve)
      // Protect against negative values before pow
      c = max(c, vec3(0.0));
      c = pow(c, 1.0 / gamma);

      // --- Saturation ---
      float luma = dot(c, LUMA);
      c = mix(vec3(luma), c, saturation);

      // Clamp to valid range
      c = clamp(c, 0.0, 1.0);

      gl_FragColor = vec4(c, color.a);
    }
  `,
} as const;

// ── Tilt-Shift DOF Shader ────────────────────────────────────────

const TiltShiftShader = {
  name: 'TiltShiftShader',

  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1, 1) },
    focusCenter: { value: 0.4 },    // vertical center of focus band (0=top, 1=bottom)
    focusWidth: { value: 0.3 },     // width of the sharp focus band
    blurAmount: { value: 2.0 },     // max blur in texels
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float focusCenter;
    uniform float focusWidth;
    uniform float blurAmount;

    varying vec2 vUv;

    // 9-tap Gaussian weights (sigma ~1.5, normalized)
    const float WEIGHTS[5] = float[5](
      0.227027027,
      0.194594595,
      0.121621622,
      0.054054054,
      0.016216216
    );

    void main() {
      // Distance from the focus center band, normalized
      float dist = abs(vUv.y - focusCenter);
      float halfWidth = focusWidth * 0.5;

      // Blur factor: 0 inside focus band, ramps up outside
      float blurFactor = smoothstep(halfWidth, halfWidth + 0.15, dist);
      float blur = blurFactor * blurAmount;

      if (blur < 0.01) {
        // Inside focus band - no blur needed
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      // Two-pass approximation done in a single pass using both axes.
      // For a proper tilt-shift the blur is predominantly vertical,
      // but we add a small horizontal component for realism.
      vec2 texelSize = 1.0 / resolution;

      vec4 result = texture2D(tDiffuse, vUv) * WEIGHTS[0];

      for (int i = 1; i < 5; i++) {
        float offset = float(i) * blur;
        float weight = WEIGHTS[i];

        // Vertical blur (primary tilt-shift axis)
        vec2 offsetV = vec2(0.0, texelSize.y * offset);
        result += texture2D(tDiffuse, vUv + offsetV) * weight;
        result += texture2D(tDiffuse, vUv - offsetV) * weight;

        // Subtle horizontal blur (30% of vertical for natural look)
        vec2 offsetH = vec2(texelSize.x * offset * 0.3, 0.0);
        result += texture2D(tDiffuse, vUv + offsetH) * weight * 0.3;
        result += texture2D(tDiffuse, vUv - offsetH) * weight * 0.3;
      }

      // Normalize: vertical contributes full weights, horizontal 30%
      // Total weight = WEIGHTS[0] + 2 * sum(WEIGHTS[1..4]) * (1.0 + 0.3)
      // Pre-computed: 0.227027 + 2 * (0.194595 + 0.121622 + 0.054054 + 0.016216) * 1.3
      // = 0.227027 + 2 * 0.386487 * 1.3 = 0.227027 + 1.004865 = 1.231892
      float totalWeight = WEIGHTS[0];
      for (int i = 1; i < 5; i++) {
        totalWeight += 2.0 * WEIGHTS[i] * 1.3;
      }
      result /= totalWeight;

      gl_FragColor = result;
    }
  `,
} as const;

// ── Parchment Overlay Shader ─────────────────────────────────────

const ParchmentOverlayShader = {
  name: 'ParchmentOverlayShader',

  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uCameraHeight: { value: 0.0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uCameraHeight;
    uniform vec2 uResolution;

    varying vec2 vUv;

    // ---- Hash-based noise for procedural parchment ----

    // Simple 2D hash returning a float in [0, 1]
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    // Value noise with smooth interpolation
    float valueNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);

      // Hermite interpolation for smooth blending
      vec2 u = f * f * (3.0 - 2.0 * f);

      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));

      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    // Multi-octave fractal Brownian motion for paper grain
    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.5;
      float frequency = 1.0;

      // 4 octaves: coarse fiber + medium grain + fine grain + micro detail
      for (int i = 0; i < 4; i++) {
        value += amplitude * valueNoise(p * frequency);
        amplitude *= 0.5;
        frequency *= 2.0;
      }
      return value;
    }

    // Generate parchment texture: warm paper with fiber-like grain
    vec3 parchmentColor(vec2 uv) {
      // Tile at 512px equivalent spacing (seamless in screen space)
      vec2 noiseCoord = uv * uResolution / 512.0;

      // Large-scale paper variation (fibers, aging)
      float coarseGrain = fbm(noiseCoord * 8.0);

      // Fine-scale grain (paper texture surface)
      float fineGrain = fbm(noiseCoord * 24.0 + 7.31);

      // Combine: mostly coarse structure with fine detail
      float grain = mix(coarseGrain, fineGrain, 0.35);

      // Warm parchment base tone: desaturated golden-brown
      // Range: from dark aged spots (0.78, 0.72, 0.62) to light paper (0.95, 0.90, 0.82)
      vec3 darkTone  = vec3(0.78, 0.72, 0.62);
      vec3 lightTone = vec3(0.95, 0.90, 0.82);

      return mix(darkTone, lightTone, grain);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Opacity: 0.0 at height <= 2000, 0.15 at height >= 5000
      // Smooth interpolation (smoothstep) between thresholds
      float opacity = smoothstep(2000.0, 5000.0, uCameraHeight) * 0.15;

      if (opacity < 0.001) {
        // Below activation threshold - pass through unchanged
        gl_FragColor = color;
        return;
      }

      // Generate procedural parchment noise
      vec3 parchment = parchmentColor(vUv);

      // Multiply blend: scene * parchment, then mix by opacity
      // Multiply blend darkens and tints, giving the antique map feel
      vec3 blended = color.rgb * parchment;
      color.rgb = mix(color.rgb, blended, opacity);

      gl_FragColor = color;
    }
  `,
} as const;

// ── Uniform Type Helpers ─────────────────────────────────────────

interface VignetteUniforms {
  tDiffuse: THREE.IUniform<THREE.Texture | null>;
  intensity: THREE.IUniform<number>;
  smoothness: THREE.IUniform<number>;
}

interface ColorGradingUniforms {
  tDiffuse: THREE.IUniform<THREE.Texture | null>;
  saturation: THREE.IUniform<number>;
  lift: THREE.IUniform<THREE.Vector3>;
  gamma: THREE.IUniform<THREE.Vector3>;
  gain: THREE.IUniform<THREE.Vector3>;
}

interface TiltShiftUniforms {
  tDiffuse: THREE.IUniform<THREE.Texture | null>;
  resolution: THREE.IUniform<THREE.Vector2>;
  focusCenter: THREE.IUniform<number>;
  focusWidth: THREE.IUniform<number>;
  blurAmount: THREE.IUniform<number>;
}

interface ParchmentOverlayUniforms {
  tDiffuse: THREE.IUniform<THREE.Texture | null>;
  uCameraHeight: THREE.IUniform<number>;
  uResolution: THREE.IUniform<THREE.Vector2>;
}

// ── Pipeline ─────────────────────────────────────────────────────

export class PostProcessingPipeline {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly vignettePass: ShaderPass;
  private readonly colorGradingPass: ShaderPass;
  private readonly tiltShiftPass: ShaderPass;
  private readonly parchmentOverlayPass: ShaderPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ) {
    // --- Composer ---
    this.composer = new EffectComposer(renderer);

    // --- Render pass (always first) ---
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // --- Bloom ---
    const renderSize = renderer.getSize(new THREE.Vector2());
    this.bloomPass = new UnrealBloomPass(
      renderSize,   // resolution
      0.3,          // strength - subtle warm glow
      0.5,          // radius - soft spread
      0.75,         // threshold - lowered for province border glow
    );
    this.composer.addPass(this.bloomPass);

    // --- Tilt-Shift DOF ---
    this.tiltShiftPass = new ShaderPass(TiltShiftShader);
    this.tiltShiftUniforms.resolution.value.copy(renderSize);
    this.composer.addPass(this.tiltShiftPass);

    // --- Color Grading ---
    this.colorGradingPass = new ShaderPass(ColorGradingShader);
    this.composer.addPass(this.colorGradingPass);

    // --- Parchment Overlay (antique map feel at strategic zoom) ---
    this.parchmentOverlayPass = new ShaderPass(ParchmentOverlayShader);
    this.parchmentOverlayUniforms.uResolution.value.copy(renderSize);
    this.composer.addPass(this.parchmentOverlayPass);

    // --- Vignette (always last visual pass) ---
    this.vignettePass = new ShaderPass(VignetteShader);
    this.composer.addPass(this.vignettePass);

    log.info('Post-processing pipeline initialized');
  }

  // ── Typed uniform accessors ──────────────────────────────────

  private get vignetteUniforms(): VignetteUniforms {
    return this.vignettePass.uniforms as unknown as VignetteUniforms;
  }

  private get colorGradingUniforms(): ColorGradingUniforms {
    return this.colorGradingPass.uniforms as unknown as ColorGradingUniforms;
  }

  private get tiltShiftUniforms(): TiltShiftUniforms {
    return this.tiltShiftPass.uniforms as unknown as TiltShiftUniforms;
  }

  private get parchmentOverlayUniforms(): ParchmentOverlayUniforms {
    return this.parchmentOverlayPass.uniforms as unknown as ParchmentOverlayUniforms;
  }

  // ── Public API ───────────────────────────────────────────────

  /**
   * Render a frame through the post-processing pipeline.
   */
  render(): void {
    this.composer.render();
  }

  /**
   * Handle viewport resize. Must be called when the window or canvas
   * changes size so that all render targets stay in sync.
   */
  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);

    // Update bloom pass internal resolution
    this.bloomPass.resolution.set(width, height);

    // Update tilt-shift resolution uniform
    this.tiltShiftUniforms.resolution.value.set(width, height);

    // Update parchment overlay resolution uniform
    this.parchmentOverlayUniforms.uResolution.value.set(width, height);
  }


  /**
   * Release all GPU resources held by the pipeline.
   * Call this before discarding the pipeline instance.
   */
  dispose(): void {
    this.bloomPass.dispose();

    // ShaderPass materials need manual disposal
    this.vignettePass.material.dispose();
    this.parchmentOverlayPass.material.dispose();
    this.colorGradingPass.material.dispose();
    this.tiltShiftPass.material.dispose();

    // Dispose render targets inside the composer
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();

    log.info('Post-processing pipeline disposed');
  }

  // ── Accessors for runtime tuning ─────────────────────────────

  // --- Bloom ---

  set bloomStrength(value: number) {
    this.bloomPass.strength = value;
  }

  get bloomStrength(): number {
    return this.bloomPass.strength;
  }

  set bloomRadius(value: number) {
    this.bloomPass.radius = value;
  }

  get bloomRadius(): number {
    return this.bloomPass.radius;
  }

  set bloomThreshold(value: number) {
    this.bloomPass.threshold = value;
  }

  get bloomThreshold(): number {
    return this.bloomPass.threshold;
  }

  // --- Vignette ---

  set vignetteIntensity(value: number) {
    this.vignetteUniforms.intensity.value = value;
  }

  get vignetteIntensity(): number {
    return this.vignetteUniforms.intensity.value;
  }

  set vignetteSmoothness(value: number) {
    this.vignetteUniforms.smoothness.value = value;
  }

  get vignetteSmoothness(): number {
    return this.vignetteUniforms.smoothness.value;
  }

  // --- Color Grading ---

  set colorSaturation(value: number) {
    this.colorGradingUniforms.saturation.value = value;
  }

  get colorSaturation(): number {
    return this.colorGradingUniforms.saturation.value;
  }

  get colorLift(): THREE.Vector3 {
    return this.colorGradingUniforms.lift.value;
  }

  get colorGamma(): THREE.Vector3 {
    return this.colorGradingUniforms.gamma.value;
  }

  get colorGain(): THREE.Vector3 {
    return this.colorGradingUniforms.gain.value;
  }

  // --- Tilt-Shift ---

  set tiltShiftFocusCenter(value: number) {
    this.tiltShiftUniforms.focusCenter.value = value;
  }

  get tiltShiftFocusCenter(): number {
    return this.tiltShiftUniforms.focusCenter.value;
  }

  set tiltShiftFocusWidth(value: number) {
    this.tiltShiftUniforms.focusWidth.value = value;
  }

  get tiltShiftFocusWidth(): number {
    return this.tiltShiftUniforms.focusWidth.value;
  }

  set tiltShiftBlurAmount(value: number) {
    this.tiltShiftUniforms.blurAmount.value = value;
  }

  get tiltShiftBlurAmount(): number {
    return this.tiltShiftUniforms.blurAmount.value;
  }

  // --- Parchment Overlay ---

  /**
   * Update the camera height for the parchment overlay effect.
   * Call this each frame (or when the camera moves) so the shader
   * knows how much parchment to blend in.
   *
   * - height <= 2000: no parchment effect (opacity 0)
   * - height >= 5000: full parchment effect (opacity 0.15)
   * - smooth interpolation between these thresholds
   */
  updateCameraHeight(height: number): void {
    this.parchmentOverlayUniforms.uCameraHeight.value = height;

    // Zoom-dependent tilt-shift: strong at close zoom, off at strategic
    // smoothstep(500, 300, h) → 1.0 at h<=300, 0.0 at h>=500
    const tiltFactor = Math.max(0, Math.min(1, (500 - height) / 200));
    this.tiltShiftUniforms.blurAmount.value = 2.0 * tiltFactor;

    // Zoom-dependent saturation: more vivid at close zoom, slightly desaturated at strategic
    // Close (<300): 1.0, Mid (500-2000): 0.85, Far (>3000): 0.75
    const satClose = Math.max(0, Math.min(1, (500 - height) / 200));
    const satFar = Math.max(0, Math.min(1, (height - 2000) / 1000));
    this.colorGradingUniforms.saturation.value = 0.85 + 0.15 * satClose - 0.10 * satFar;
  }

  /** Current camera height value driving the parchment overlay */
  get parchmentCameraHeight(): number {
    return this.parchmentOverlayUniforms.uCameraHeight.value;
  }
}
