/**
 * Post-processing pipeline for Roma Aeterna (TSL / WebGPURenderer).
 *
 * Chain: ScenePass -> Bloom (simplified) -> TiltShift -> ColorGrading -> ParchmentOverlay -> Vignette
 *
 * All effects are composed as a single TSL node graph assigned to PostProcessing.outputNode.
 * Parchment overlay fades in above camera height 2000.
 *
 * Replaces the previous EffectComposer + ShaderPass pipeline with TSL nodes
 * compatible with WebGPURenderer (WebGPU native and WebGL2 fallback).
 */

import * as THREE from 'three';
import { PostProcessing } from 'three/webgpu';
import type { Renderer } from 'three/webgpu';

/**
 * TSL node type. TSL nodes use Proxy-based dynamic dispatch for .rgb, .a,
 * .mul(), .add(), .sub(), .div(), .sample(), .blur() etc. These are not
 * expressible in TypeScript's static type system.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any;
import {
  pass,
  screenUV,
  screenSize,
  uniform,
  float,
  vec2,
  vec3,
  vec4,
  Fn,
  mix,
  smoothstep,
  clamp,
  max,
  pow,
  dot,
  abs,
  length,
  convertToTexture,
  oneMinus,
  mx_fractal_noise_float,
} from 'three/tsl';

import { createLogger } from '../core/logger';

const log = createLogger('postfx');

// ── Gaussian weights for tilt-shift (9-tap, sigma ~1.5, normalized) ──
const WEIGHTS = [0.227027027, 0.194594595, 0.121621622, 0.054054054, 0.016216216] as const;

// Rec. 709 luminance coefficients
const LUMA = vec3(0.2126, 0.7152, 0.0722);

// ── Pipeline ─────────────────────────────────────────────────────

export class PostProcessingPipeline {
  private readonly postProcessing: PostProcessing;

  // ── Uniforms (reactive -- changing .value auto-updates the shader) ──

  // Bloom
  private readonly _bloomStrength = uniform(0.35);
  private readonly _bloomRadius = uniform(0.6);
  private readonly _bloomThreshold = uniform(0.58);

  // Vignette
  private readonly _vignetteIntensity = uniform(0.45);
  private readonly _vignetteSmoothness = uniform(0.65);

  // Color Grading
  private readonly _saturation = uniform(0.88);
  private readonly _lift = uniform(new THREE.Vector3(0.05, 0.035, 0.01));
  private readonly _gamma = uniform(new THREE.Vector3(1.03, 1.0, 0.94));
  private readonly _gain = uniform(new THREE.Vector3(1.06, 1.03, 0.92));

  // Tilt-Shift
  private readonly _focusCenter = uniform(0.4);
  private readonly _focusWidth = uniform(0.3);
  private readonly _blurAmount = uniform(2.0);

  // Parchment Overlay
  private readonly _cameraHeight = uniform(0.0);

  constructor(
    renderer: Renderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ) {
    this.postProcessing = new PostProcessing(renderer);

    // --- Build the TSL node graph ---
    const scenePass = pass(scene, camera);
    const sceneTexture = (scenePass.getTextureNode('output'));

    // 1. Bloom (simplified: threshold -> add bright pixels with strength)
    const bloomOutput = this.buildBloom(sceneTexture);

    // 2. Tilt-Shift (needs texture for multi-tap sampling)
    const tiltShiftInput = convertToTexture(bloomOutput);
    const tiltShiftOutput = this.buildTiltShift((tiltShiftInput));

    // 3. Color Grading (per-pixel, no re-sampling needed)
    const colorGraded = this.buildColorGrading(tiltShiftOutput);

    // 4. Parchment Overlay (per-pixel procedural noise blend)
    const parchmented = this.buildParchmentOverlay(colorGraded);

    // 5. Vignette (per-pixel distance-based darkening)
    const vignetted = this.buildVignette(parchmented);

    this.postProcessing.outputNode = vignetted as Node;

    log.info('Post-processing pipeline initialized (TSL)');
  }

  // ── Effect builders ────────────────────────────────────────────

  /**
   * Simplified bloom: extract bright pixels above threshold,
   * apply a soft glow using reduced-resolution RTT, and add back.
   *
   * This approximates UnrealBloomPass by using convertToTexture at
   * full resolution with bilinear sampling as a simple soft-glow.
   * For stronger bloom, the radius uniform scales the contribution.
   */
  private buildBloom(sceneColor: Node): Node {
    const strength = this._bloomStrength;
    const threshold = this._bloomThreshold;
    const radius = this._bloomRadius;

    // Extract bright pixels above threshold
    const bright = max(sceneColor.rgb.sub(vec3(threshold)), vec3(0.0));

    // Convert bright pass to texture for bilinear-filtered soft sampling
    const brightTexture = convertToTexture(vec4(bright, 1.0));

    // Sample the bright texture with mip bias for soft glow (blur approximation)
    // The .blur() method uses mip-level bias for a natural falloff.
    // If mipmaps are not available, this degrades gracefully to unblurred.
    const blurredBright = (brightTexture.blur(radius));

    // Add bloom back to scene: original + blurred bright * strength
    const result = sceneColor.rgb.add(blurredBright.rgb.mul(strength));

    return vec4(result, sceneColor.a);
  }

  /**
   * Tilt-shift DOF: gaussian blur that increases with vertical distance
   * from a horizontal focus band. Uses 9-tap (5 weights) sampling with
   * both vertical (primary) and horizontal (30%) blur components.
   */
  private buildTiltShift(inputTexture: Node): Node {
    const focusCenter = this._focusCenter;
    const focusWidth = this._focusWidth;
    const blurAmount = this._blurAmount;

    // Cast inputTexture for .sample() access (available on TextureNode/RTTNode)
    const tex = inputTexture as Node & { sample: (uv: Node) => Node };

    const tiltShiftFn = Fn(() => {
      const uv = screenUV;

      // Distance from focus center band
      const dist = abs(uv.y.sub(focusCenter));
      const halfWidth = focusWidth.mul(0.5);

      // Blur factor: 0 inside focus band, ramps up outside
      const blurFactor = smoothstep(halfWidth, halfWidth.add(0.15), dist);
      const blur = blurFactor.mul(blurAmount);

      // Texel size for offset calculation
      const texelSize = vec2(float(1.0).div(screenSize.x), float(1.0).div(screenSize.y));

      // Center sample (weight[0])
      let result: Node = (tex.sample(uv)).mul(WEIGHTS[0]!);

      // 4 offset taps in each direction (unrolled loop for TSL compatibility)
      for (let i = 1; i < 5; i++) {
        const offset: Node = float(i).mul(blur);
        const weight = WEIGHTS[i]!;

        // Vertical blur (primary tilt-shift axis)
        const offsetV = vec2(0, texelSize.y.mul(offset));
        result = result.add((tex.sample(uv.add(offsetV))).mul(weight));
        result = result.add((tex.sample(uv.sub(offsetV))).mul(weight));

        // Subtle horizontal blur (30% of vertical for natural look)
        const offsetH = vec2(texelSize.x.mul(offset).mul(0.3), 0);
        result = result.add((tex.sample(uv.add(offsetH))).mul(weight).mul(0.3));
        result = result.add((tex.sample(uv.sub(offsetH))).mul(weight).mul(0.3));
      }

      // Normalize: vertical contributes full weights, horizontal 30%
      // Total = W[0] + 2 * sum(W[1..4]) * 1.3
      let totalWeight = WEIGHTS[0]!;
      for (let i = 1; i < 5; i++) {
        totalWeight += 2.0 * WEIGHTS[i]! * 1.3;
      }
      result = result.div(totalWeight);

      return result;
    });

    return (tiltShiftFn());
  }

  /**
   * Color grading with lift/gamma/gain and saturation.
   * Warm golden-hour Mediterranean palette (Imperator Rome style).
   */
  private buildColorGrading(inputColor: Node): Node {
    const saturationU = this._saturation;
    const liftU = this._lift;
    const gammaU = this._gamma;
    const gainU = this._gain;

    const colorGradeFn = Fn(([color]: [Node]) => {
      // Apply gain (scale)
      let c: Node = color.rgb.mul(gainU);

      // Apply lift (offset, strongest in shadows)
      c = c.add((liftU).mul(oneMinus(c)));

      // Apply gamma (power curve)
      c = (max(c, vec3(0.0)));
      c = (pow(c, vec3(1.0).div((gammaU))));

      // Saturation
      const luma = dot(c, LUMA);
      c = (mix(vec3(luma), c, saturationU));

      // Clamp to valid range
      c = (clamp(c, vec3(0.0), vec3(1.0)));

      return vec4(c, color.a);
    });

    return (colorGradeFn(inputColor));
  }

  /**
   * Parchment overlay: procedural noise blended over the scene
   * using multiply blend for an antique map feel.
   * Fades in at camera heights above 2000, max opacity 0.25 at 5000+.
   */
  private buildParchmentOverlay(inputColor: Node): Node {
    const cameraHeightU = this._cameraHeight;

    const parchmentFn = Fn(([color]: [Node]) => {
      // Opacity: 0 at height <= 2000, 0.25 at height >= 5000
      const opacity = smoothstep(float(2000.0), float(5000.0), cameraHeightU).mul(0.25);

      // Generate procedural parchment noise using MaterialX FBM
      // Tile at 512px equivalent spacing
      const noiseCoord = screenUV.mul(screenSize).div(512.0);

      // Large-scale paper variation (fibers, aging) - 4 octaves
      const coarseGrain = mx_fractal_noise_float(
        noiseCoord.mul(8.0),     // position
        4,                        // octaves
        2.0,                      // lacunarity
        0.5,                      // diminish
        0.5,                      // amplitude
      );

      // Fine-scale grain (paper texture surface) - 4 octaves, offset
      const fineGrain = mx_fractal_noise_float(
        noiseCoord.mul(24.0).add(vec2(7.31, 7.31)),
        4,
        2.0,
        0.5,
        0.5,
      );

      // Combine: mostly coarse structure with fine detail
      const grain = mix(coarseGrain, fineGrain, 0.35);

      // Warm parchment base tone
      const darkTone = vec3(0.78, 0.72, 0.62);
      const lightTone = vec3(0.95, 0.90, 0.82);
      const parchment = mix(darkTone, lightTone, grain);

      // Multiply blend: scene * parchment, then mix by opacity
      const blended = color.rgb.mul(parchment);
      const result = mix(color.rgb, blended, opacity);

      return vec4(result, color.a);
    });

    return (parchmentFn(inputColor));
  }

  /**
   * Vignette: distance-based darkening from screen center to edges.
   */
  private buildVignette(inputColor: Node): Node {
    const intensityU = this._vignetteIntensity;
    const smoothnessU = this._vignetteSmoothness;

    const vignetteFn = Fn(([color]: [Node]) => {
      // Distance from center, normalized so corners reach ~1.414
      const centeredUv = screenUV.sub(0.5);
      const dist = length(centeredUv).mul(2.0);

      // Smooth falloff from center to edges
      const edge = oneMinus(smoothnessU);
      const outerEdge = float(1.0).add((smoothnessU).mul(0.5));
      const vignette = oneMinus(smoothstep(edge, outerEdge, dist));
      const vignetteMixed = mix(float(1.0), vignette, intensityU);

      const result = color.rgb.mul(vignetteMixed);

      return vec4(result, color.a);
    });

    return (vignetteFn(inputColor));
  }

  // ── Public API ───────────────────────────────────────────────

  /**
   * Render a frame through the post-processing pipeline.
   */
  render(): void {
    this.postProcessing.render();
  }

  /**
   * Handle viewport resize. PostProcessing and PassNode auto-track
   * the renderer size, so this is largely a no-op. Kept for API
   * compatibility with the system that calls it.
   */
  setSize(_width: number, _height: number): void {
    // PostProcessing and PassNode automatically resize to match the renderer.
    // No manual size management is needed with the TSL pipeline.
  }

  /**
   * Release all GPU resources held by the pipeline.
   */
  dispose(): void {
    this.postProcessing.dispose();
    log.info('Post-processing pipeline disposed');
  }

  // ── Accessors for runtime tuning ─────────────────────────────

  // --- Bloom ---

  set bloomStrength(value: number) {
    this._bloomStrength.value = value;
  }

  get bloomStrength(): number {
    return this._bloomStrength.value;
  }

  set bloomRadius(value: number) {
    this._bloomRadius.value = value;
  }

  get bloomRadius(): number {
    return this._bloomRadius.value;
  }

  set bloomThreshold(value: number) {
    this._bloomThreshold.value = value;
  }

  get bloomThreshold(): number {
    return this._bloomThreshold.value;
  }

  // --- Vignette ---

  set vignetteIntensity(value: number) {
    this._vignetteIntensity.value = value;
  }

  get vignetteIntensity(): number {
    return this._vignetteIntensity.value;
  }

  set vignetteSmoothness(value: number) {
    this._vignetteSmoothness.value = value;
  }

  get vignetteSmoothness(): number {
    return this._vignetteSmoothness.value;
  }

  // --- Color Grading ---

  set colorSaturation(value: number) {
    this._saturation.value = value;
  }

  get colorSaturation(): number {
    return this._saturation.value;
  }

  get colorLift(): THREE.Vector3 {
    return this._lift.value;
  }

  get colorGamma(): THREE.Vector3 {
    return this._gamma.value;
  }

  get colorGain(): THREE.Vector3 {
    return this._gain.value;
  }

  // --- Tilt-Shift ---

  set tiltShiftFocusCenter(value: number) {
    this._focusCenter.value = value;
  }

  get tiltShiftFocusCenter(): number {
    return this._focusCenter.value;
  }

  set tiltShiftFocusWidth(value: number) {
    this._focusWidth.value = value;
  }

  get tiltShiftFocusWidth(): number {
    return this._focusWidth.value;
  }

  set tiltShiftBlurAmount(value: number) {
    this._blurAmount.value = value;
  }

  get tiltShiftBlurAmount(): number {
    return this._blurAmount.value;
  }

  // --- Parchment Overlay ---

  /**
   * Update the camera height for the parchment overlay effect.
   * Also drives zoom-dependent tilt-shift and saturation.
   *
   * - height <= 2000: no parchment effect (opacity 0)
   * - height >= 5000: full parchment effect (opacity 0.25)
   * - smooth interpolation between these thresholds
   */
  updateCameraHeight(height: number): void {
    this._cameraHeight.value = height;

    // Zoom-dependent tilt-shift: strong at close zoom, off at strategic
    // smoothstep(500, 300, h) -> 1.0 at h<=300, 0.0 at h>=500
    const tiltFactor = Math.max(0, Math.min(1, (500 - height) / 200));
    this._blurAmount.value = 2.0 * tiltFactor;

    // Zoom-dependent saturation: more vivid at close zoom, slightly desaturated at strategic
    // Close (<300): 1.0, Mid (500-2000): 0.85, Far (>3000): 0.75
    const satClose = Math.max(0, Math.min(1, (500 - height) / 200));
    const satFar = Math.max(0, Math.min(1, (height - 2000) / 1000));
    this._saturation.value = 0.85 + 0.15 * satClose - 0.10 * satFar;
  }

  /** Current camera height value driving the parchment overlay */
  get parchmentCameraHeight(): number {
    return this._cameraHeight.value;
  }
}
