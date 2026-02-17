/**
 * Animated Mediterranean water rendering system.
 *
 * Custom ShaderMaterial with 256x256 grid, 3 wave octaves, foam, and fresnel.
 * Uses GLSL ShaderMaterial on WebGL2. Single draw call for the entire water surface.
 */

import * as THREE from 'three';
import { WATER_LEVEL, MAP_SIZE } from '../config';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WATER_Y = WATER_LEVEL - 1; // visual position just below logical water level
const PLANE_SIZE = MAP_SIZE * 1.5;
const GRID_SEGMENTS = 256;

/** Sun position matching main.ts directional light */
const SUN_POSITION = new THREE.Vector3(-1500, 3000, -1200).normalize();

// ---------------------------------------------------------------------------
// GLSL - Vertex Shader
// ---------------------------------------------------------------------------

const VERTEX_SHADER = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uWaveAmplitude;
  uniform int   uOctaves;

  varying vec3  vWorldPos;
  varying vec3  vNormal;
  varying float vWaveHeight;

  // Fast pseudo-hash for wave variety
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  // Smooth-interpolated value noise (cheaper than Perlin)
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f); // smoothstep
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // Multi-octave wave displacement
  float waveDisplacement(vec2 pos, float time) {
    float height = 0.0;

    // Octave 1 -- large rolling swell
    height += sin(pos.x * 0.008 + time * 0.35) *
              cos(pos.y * 0.006 + time * 0.28) * 1.0;

    // Octave 2 -- medium chop at an angle
    height += sin(dot(vec2(pos.x, pos.y), vec2(0.012, 0.009)) + time * 0.50) * 0.5;

    if (uOctaves >= 3) {
      // Octave 3 -- fine ripples (full quality only)
      height += noise(pos * 0.04 + time * 0.6) * 0.35 - 0.175;
    }

    return height * uWaveAmplitude;
  }

  void main() {
    vec3 pos = position;

    // Wave displacement on the Y axis (geometry is already XZ-oriented)
    float waveH = waveDisplacement(pos.xz, uTime);
    pos.y += waveH;

    vWaveHeight = waveH;
    vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;

    // Compute analytical normal via central-difference on the wave function
    float eps = 1.0;
    float hL = waveDisplacement(pos.xz + vec2(-eps, 0.0), uTime);
    float hR = waveDisplacement(pos.xz + vec2( eps, 0.0), uTime);
    float hD = waveDisplacement(pos.xz + vec2(0.0, -eps), uTime);
    float hU = waveDisplacement(pos.xz + vec2(0.0,  eps), uTime);

    vec3 n = normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
    vNormal = normalize(normalMatrix * n);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// GLSL - Fragment Shader
// ---------------------------------------------------------------------------

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec3  uCameraPos;
  uniform vec3  uSunDir;
  uniform vec3  uDeepColor;
  uniform vec3  uShallowColor;
  uniform vec3  uSpecularColor;
  uniform float uOpacity;
  uniform bool  uEnableFoam;
  uniform sampler2D uHeightMap;
  uniform bool  uHasHeightMap;
  uniform float uMapSize;

  varying vec3  vWorldPos;
  varying vec3  vNormal;
  varying float vWaveHeight;

  // Simple hash for ripple pattern
  float hash2D(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash2D(i);
    float b = hash2D(i + vec2(1.0, 0.0));
    float c = hash2D(i + vec2(0.0, 1.0));
    float d = hash2D(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // Sample terrain height from heightmap at world position
  float sampleTerrainHeight(vec2 worldXZ) {
    if (!uHasHeightMap) return 0.0;
    // Convert world position to UV (world origin offset by half map)
    vec2 uv = (worldXZ + uMapSize * 0.5) / uMapSize;
    uv = clamp(uv, 0.0, 1.0);
    return texture2D(uHeightMap, uv).r * 255.0;
  }

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 L = normalize(uSunDir);

    // ── Fresnel (Schlick approximation) ───────────────────────────
    float cosTheta = max(dot(N, V), 0.0);
    float fresnel  = pow(1.0 - cosTheta, 4.0);
    fresnel = mix(0.04, 1.0, fresnel); // F0 = 0.04 for water

    // ── Heightmap-based depth ────────────────────────────────────
    float terrainH = sampleTerrainHeight(vWorldPos.xz);
    // WATER_LEVEL = 32, terrain near coast has height ~32-35
    float coastProximity = smoothstep(28.0, 34.0, terrainH);
    // Deep ocean: terrain height < 15, coastal: terrain height > 28
    float depthFromTerrain = 1.0 - smoothstep(8.0, 28.0, terrainH);

    // ── Depth-based colour blend ──────────────────────────────────
    // Combine wave height variation with terrain-based depth
    float depthFactor = smoothstep(-1.5, 1.5, vWaveHeight);
    if (uHasHeightMap) {
      // Terrain depth is primary driver, wave height adds variation
      depthFactor = mix(depthFromTerrain, depthFactor, 0.2);
    }
    vec3 waterColor = mix(uShallowColor, uDeepColor, depthFactor);

    // Subtle animated ripple tint variation
    float ripple = noise2D(vWorldPos.xz * 0.015 + uTime * 0.15);
    waterColor = mix(waterColor, waterColor * 1.12, ripple * 0.3);

    // ── Diffuse (subtle, water is mostly specular/reflective) ─────
    float NdotL = max(dot(N, L), 0.0);
    vec3 diffuse = waterColor * (0.35 + 0.25 * NdotL);

    // ── Specular (Blinn-Phong) ────────────────────────────────────
    vec3 H = normalize(L + V);
    float NdotH = max(dot(N, H), 0.0);
    float specPower = 256.0;
    float spec = pow(NdotH, specPower) * 2.5;

    // Secondary broad specular for warm glow
    float specBroad = pow(NdotH, 16.0) * 0.35;

    vec3 specular = uSpecularColor * (spec + specBroad);

    // ── Foam ─────────────────────────────────────────────────────
    vec3 foamContrib = vec3(0.0);
    if (uEnableFoam) {
      float foamNoise = noise2D(vWorldPos.xz * 0.03 + uTime * 0.25);

      // Wave-peak foam (existing)
      float waveFoam = smoothstep(1.2, 2.0, vWaveHeight + foamNoise * 0.8);

      // Coastal foam: white foam where water meets land
      float coastFoam = 0.0;
      if (uHasHeightMap) {
        float coastNoise = noise2D(vWorldPos.xz * 0.08 + uTime * 0.4);
        // Foam appears where terrain height is near water level
        coastFoam = coastProximity * (0.5 + coastNoise * 0.5);
        // Animated wash effect
        coastFoam *= 0.6 + 0.4 * sin(uTime * 1.5 + vWorldPos.x * 0.1 + vWorldPos.z * 0.08);
      }

      float totalFoam = max(waveFoam, coastFoam);
      foamContrib = vec3(0.85, 0.92, 0.95) * totalFoam * 0.6;
    }

    // ── Sky reflection approximation ──────────────────────────────
    // Simulate sky dome colour reflected on water surface
    vec3 reflectDir = reflect(-V, N);
    float skyBlend = smoothstep(-0.1, 0.5, reflectDir.y);
    vec3 skyColor = mix(vec3(0.18, 0.24, 0.35), vec3(0.45, 0.58, 0.72), skyBlend);

    // ── Final composition ─────────────────────────────────────────
    vec3 color = mix(diffuse, skyColor, fresnel * 0.55)
               + specular
               + foamContrib;

    // Edge alpha falloff: fade water near the edges of the plane
    float edgeDist = max(
      abs(vWorldPos.x) / (${PLANE_SIZE.toFixed(1)} * 0.5),
      abs(vWorldPos.z) / (${PLANE_SIZE.toFixed(1)} * 0.5)
    );
    float edgeAlpha = 1.0 - smoothstep(0.85, 1.0, edgeDist);

    float alpha = uOpacity * edgeAlpha;

    gl_FragColor = vec4(color, alpha);
  }
`;

// ---------------------------------------------------------------------------
// WaterRenderer Class
// ---------------------------------------------------------------------------

export class WaterRenderer {
  private readonly scene: THREE.Scene;
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.PlaneGeometry;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.geometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE, GRID_SEGMENTS, GRID_SEGMENTS);
    this.geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      uniforms: {
        uTime:          { value: 0.0 },
        uWaveAmplitude: { value: 2.0 },
        uOctaves:       { value: 3 },
        uCameraPos:     { value: new THREE.Vector3() },
        uSunDir:        { value: SUN_POSITION.clone() },
        // Mediterranean palette
        uDeepColor:     { value: new THREE.Color(0x0e2a45) },   // deep navy
        uShallowColor:  { value: new THREE.Color(0x2a7e8f) },   // warm teal
        uSpecularColor: { value: new THREE.Color(0xfff0c8) },   // golden highlight
        uOpacity:       { value: 0.82 },
        uEnableFoam:    { value: true },
        // Heightmap for coastal detection
        uHeightMap:     { value: null as THREE.Texture | null },
        uHasHeightMap:  { value: false },
        uMapSize:       { value: MAP_SIZE },
      },
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.y = WATER_Y;
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false; // large plane, always visible
    this.scene.add(this.mesh);
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Call once per frame. Updates time and camera-dependent uniforms.
   */
  update(time: number, cameraPosition: THREE.Vector3): void {
    const uTime = this.material.uniforms['uTime'];
    const uCameraPos = this.material.uniforms['uCameraPos'];
    if (uTime) uTime.value = time;
    if (uCameraPos) (uCameraPos.value as THREE.Vector3).copy(cameraPosition);
  }

  /**
   * Provide the heightmap texture for coastal foam detection.
   * The texture should be the same heightmap loaded by heightmapLoader.
   */
  setHeightmapTexture(texture: THREE.Texture): void {
    const uHeightMap = this.material.uniforms['uHeightMap'];
    const uHasHeightMap = this.material.uniforms['uHasHeightMap'];
    if (uHeightMap) uHeightMap.value = texture;
    if (uHasHeightMap) uHasHeightMap.value = true;
  }

  /**
   * Dispose all GPU resources. Call when the water system is no longer needed.
   */
  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
