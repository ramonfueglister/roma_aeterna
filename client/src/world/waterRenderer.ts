/**
 * Animated Mediterranean water rendering system using Three.js TSL (Three Shading Language).
 *
 * MeshPhysicalNodeMaterial with 256x256 grid, 3 wave octaves, foam, and fresnel.
 * TSL compiles to GLSL (WebGL2) or WGSL (WebGPU) automatically.
 * Single draw call for the entire water surface.
 */

import * as THREE from 'three';
import { Node, MeshPhysicalNodeMaterial } from 'three/webgpu';
import type { ShaderNodeObject } from 'three/tsl';
import {
  uniform, float, vec2, vec3, vec4,
  attribute,
  sin, mix, pow, max, abs, dot, normalize, reflect,
  smoothstep, fract, floor, clamp,
  texture,
  Fn,
  varying,
  modelWorldMatrix, modelNormalMatrix,
  select,
  greaterThanEqual,
} from 'three/tsl';
import { WATER_LEVEL, MAP_SIZE } from '../config';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WATER_Y = WATER_LEVEL; // spec §5: water at height 32 (sea level)
const PLANE_SIZE = MAP_SIZE * 1.5;
const GRID_SEGMENTS = 256;

/** Sun position matching main.ts directional light (spec §22: 35° elevation) */
const SUN_POSITION = new THREE.Vector3(-1500, 1345, -1200).normalize();

// ---------------------------------------------------------------------------
// TSL Noise Functions
// ---------------------------------------------------------------------------

/**
 * Fast pseudo-hash for wave variety.
 * Equivalent to: fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123)
 */
type SNode = ShaderNodeObject<Node>;

const tslHash = Fn(([p]: [SNode]) => {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453123));
});

/**
 * Smooth-interpolated value noise (cheaper than Perlin).
 * Uses smoothstep interpolation between 4 corner hash values.
 */
const tslNoise = Fn(([p]: [SNode]) => {
  const i = floor(p);
  const f = fract(p);
  // Smoothstep: f * f * (3.0 - 2.0 * f)
  const sf = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));

  const a = tslHash(i);
  const b = tslHash(i.add(vec2(1.0, 0.0)));
  const c = tslHash(i.add(vec2(0.0, 1.0)));
  const d = tslHash(i.add(vec2(1.0, 1.0)));

  return mix(mix(a, b, sf.x), mix(c, d, sf.x), sf.y);
});

// ---------------------------------------------------------------------------
// WaterRenderer Class
// ---------------------------------------------------------------------------

export class WaterRenderer {
  private readonly scene: THREE.Scene;
  private readonly mesh: THREE.Mesh;
  private readonly material: InstanceType<typeof MeshPhysicalNodeMaterial>;
  private readonly geometry: THREE.PlaneGeometry;

  // TSL uniforms (stored for per-frame updates)
  private readonly uTime = uniform(0.0);
  private readonly uCameraPos = uniform(new THREE.Vector3());

  // Heightmap texture node (TextureNode extends UniformNode<Texture>)
  private readonly heightMapNode = texture(new THREE.Texture());
  private readonly uHasHeightMap = uniform(0.0);

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.geometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE, GRID_SEGMENTS, GRID_SEGMENTS);
    this.geometry.rotateX(-Math.PI / 2);

    // ---- Alias uniforms for closure capture ----

    const uTime = this.uTime;
    const uCameraPos = this.uCameraPos;
    const uSunDir = uniform(SUN_POSITION.clone());
    // Spec §5: 4 depth zone colors
    const uCoastColor = uniform(new THREE.Color(100 / 255, 200 / 255, 210 / 255));   // (100,200,210) turquoise
    const uShallowColor = uniform(new THREE.Color(65 / 255, 155 / 255, 190 / 255));  // (65,155,190) light blue
    const uMediumColor = uniform(new THREE.Color(40 / 255, 100 / 255, 160 / 255));   // (40,100,160) medium blue
    const uDeepColor = uniform(new THREE.Color(20 / 255, 50 / 255, 110 / 255));      // (20,50,110) deep blue
    const uSpecularColor = uniform(new THREE.Color(0xfff0c8));
    const uOpacity = uniform(0.82);
    const uEnableFoam = uniform(1.0);
    const heightMapNode = this.heightMapNode;
    const uHasHeightMap = this.uHasHeightMap;
    const uMapSize = uniform(MAP_SIZE);

    // ---- Wave displacement function (spec §5: 2 directional sine waves) ----
    // Wave 1: freq 0.05, amp 0.3, direction 30°, speed 0.02
    // Wave 2: freq 0.08, amp 0.15, direction 120°, speed 0.02
    const wave1Dir = vec2(float(Math.cos(30 * Math.PI / 180)), float(Math.sin(30 * Math.PI / 180)));
    const wave2Dir = vec2(float(Math.cos(120 * Math.PI / 180)), float(Math.sin(120 * Math.PI / 180)));

    const waveDisplacement = Fn(([pos, time]: [SNode, SNode]) => {
      // Wave 1: amplitude 0.3, frequency 0.05, speed 0.02
      const phase1 = dot(pos, wave1Dir).mul(0.05).add(time.mul(0.02));
      const h1 = sin(phase1).mul(0.3);

      // Wave 2: amplitude 0.15, frequency 0.08, speed 0.02
      const phase2 = dot(pos, wave2Dir).mul(0.08).add(time.mul(0.02));
      const h2 = sin(phase2).mul(0.15);

      return h1.add(h2);
    });

    // ---- Vertex position node (wave displacement on Y axis) ----

    // Fresh attribute node -- NOT the global positionGeometry/positionLocal singletons.
    // Using the singleton causes a circular reference in NodeMaterial.setupPosition()
    // which does positionLocal.assign(this.positionNode), crashing with null currentStack.
    const geomPos = attribute('position', 'vec3');
    const posXZ = geomPos.xz;
    const waveH = waveDisplacement(posXZ, uTime);

    // Displaced position: add wave height to Y
    const displacedPosition = geomPos.add(vec3(0.0, waveH, 0.0));

    // ---- Analytical normal via central difference ----

    const eps = float(1.0);
    const hL = waveDisplacement(posXZ.add(vec2(-1.0, 0.0)), uTime);
    const hR = waveDisplacement(posXZ.add(vec2(1.0, 0.0)), uTime);
    const hD = waveDisplacement(posXZ.add(vec2(0.0, -1.0)), uTime);
    const hU = waveDisplacement(posXZ.add(vec2(0.0, 1.0)), uTime);

    const analyticNormal = normalize(vec3(hL.sub(hR), eps.mul(2.0), hD.sub(hU)));

    // ---- Varyings: pass data from vertex to fragment stage ----

    const vWaveHeight = varying(waveH, 'vWaveHeight');
    const vWorldPos = varying(
      modelWorldMatrix.mul(vec4(displacedPosition, 1.0)).xyz,
      'vWorldPos'
    );
    const vNormal = varying(
      normalize(modelNormalMatrix.mul(analyticNormal)),
      'vNormal'
    );

    // ---- Fragment output node ----

    const fragmentOutput = Fn(() => {
      const N = normalize(vNormal);
      const V = normalize(uCameraPos.sub(vWorldPos));
      const L = normalize(uSunDir);

      // -- Fresnel (Schlick approximation) --
      const cosTheta = max(dot(N, V), 0.0);
      const fresnel = mix(float(0.04), float(1.0), pow(float(1.0).sub(cosTheta), 4.0));

      // -- Heightmap-based depth --
      const hmUV = vWorldPos.xz.add(uMapSize.mul(0.5)).div(uMapSize);
      const clampedUV = clamp(hmUV, 0.0, 1.0);
      const terrainSample = heightMapNode.sample(clampedUV).r.mul(255.0);
      const terrainH = select(
        greaterThanEqual(uHasHeightMap, float(0.5)),
        terrainSample,
        float(0.0)
      );

      const coastProximity = smoothstep(28.0, 34.0, terrainH);

      // -- Depth-based 4-zone colour blend (spec §5) --
      // terrainH encodes distance from coast: higher = closer to land
      // Zone boundaries: coast (28-34), shallow (20-28), medium (8-20), deep (<8)
      const coastZone = smoothstep(28.0, 34.0, terrainH);      // near coast
      const shallowZone = smoothstep(20.0, 28.0, terrainH);    // shallow water
      const mediumZone = smoothstep(8.0, 20.0, terrainH);      // medium depth

      // Blend through 4 zones: deep → medium → shallow → coast
      const deepToMedium = mix(uDeepColor, uMediumColor, mediumZone);
      const toShallow = mix(deepToMedium, uShallowColor, shallowZone);
      const waterColorBase = mix(toShallow, uCoastColor, coastZone);

      // Fallback for no heightmap: wave-height based blend
      const depthFactorBase = smoothstep(-1.5, 1.5, vWaveHeight);
      const noHmColor = mix(uShallowColor, uDeepColor, depthFactorBase);
      const waterColorSelected = select(
        greaterThanEqual(uHasHeightMap, float(0.5)),
        waterColorBase,
        noHmColor
      );

      // Subtle animated ripple tint variation
      const ripple = tslNoise(vWorldPos.xz.mul(0.015).add(uTime.mul(0.15)));
      const waterColor = mix(waterColorSelected, waterColorSelected.mul(1.12), ripple.mul(0.3));

      // -- Diffuse (subtle, water is mostly specular/reflective) --
      const NdotL = max(dot(N, L), 0.0);
      const diffuse = waterColor.mul(float(0.35).add(float(0.25).mul(NdotL)));

      // -- Specular (Blinn-Phong) --
      const H = normalize(L.add(V));
      const NdotH = max(dot(N, H), 0.0);
      const spec = pow(NdotH, 256.0).mul(2.5);
      const specBroad = pow(NdotH, 16.0).mul(0.35);
      const specular = uSpecularColor.mul(spec.add(specBroad));

      // -- Foam --
      const foamNoise = tslNoise(vWorldPos.xz.mul(0.03).add(uTime.mul(0.25)));

      // Wave-peak foam
      const waveFoam = smoothstep(1.2, 2.0, vWaveHeight.add(foamNoise.mul(0.8)));

      // Coastal foam: white foam where water meets land
      const coastNoise = tslNoise(vWorldPos.xz.mul(0.08).add(uTime.mul(0.4)));
      const coastFoamBase = coastProximity
        .mul(float(0.5).add(coastNoise.mul(0.5)))
        .mul(float(0.6).add(float(0.4).mul(
          sin(uTime.mul(1.5).add(vWorldPos.x.mul(0.1)).add(vWorldPos.z.mul(0.08)))
        )));
      const coastFoam = select(
        greaterThanEqual(uHasHeightMap, float(0.5)),
        coastFoamBase,
        float(0.0)
      );

      const totalFoam = max(waveFoam, coastFoam);
      const foamColor = vec3(0.85, 0.92, 0.95).mul(totalFoam).mul(0.6);

      // Apply foam only when enabled
      const foamContrib = select(
        greaterThanEqual(uEnableFoam, float(0.5)),
        foamColor,
        vec3(0.0, 0.0, 0.0)
      );

      // -- Sky reflection approximation --
      const reflectDir = reflect(V.negate(), N);
      const skyBlend = smoothstep(-0.1, 0.5, reflectDir.y);
      const skyColor = mix(vec3(0.18, 0.24, 0.35), vec3(0.45, 0.58, 0.72), skyBlend);

      // -- Final composition --
      const color = mix(diffuse, skyColor, fresnel.mul(0.55))
        .add(specular)
        .add(foamContrib);

      // Edge alpha falloff: fade water near the edges of the plane
      const halfPlane = float(PLANE_SIZE * 0.5);
      const edgeDist = max(
        abs(vWorldPos.x).div(halfPlane),
        abs(vWorldPos.z).div(halfPlane)
      );
      const edgeAlpha = float(1.0).sub(smoothstep(0.85, 1.0, edgeDist));

      const alpha = uOpacity.mul(edgeAlpha);

      return vec4(color, alpha);
    });

    // ---- Create Material ----

    this.material = new MeshPhysicalNodeMaterial();
    this.material.transparent = true;
    this.material.depthWrite = false;
    this.material.side = THREE.FrontSide;

    // Assign TSL nodes to material slots
    this.material.positionNode = displacedPosition;
    this.material.normalNode = analyticNormal;
    this.material.outputNode = fragmentOutput();

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.y = WATER_Y;
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false; // large plane, always visible
    this.scene.add(this.mesh);
  }

  // -- Public API -----------------------------------------------------------

  /**
   * Call once per frame. Updates time and camera-dependent uniforms.
   */
  update(time: number, cameraPosition: THREE.Vector3): void {
    this.uTime.value = time;
    (this.uCameraPos.value as THREE.Vector3).copy(cameraPosition);
  }

  /**
   * Provide the heightmap texture for coastal foam detection.
   * The texture should be the same heightmap loaded by heightmapLoader.
   */
  setHeightmapTexture(tex: THREE.Texture): void {
    this.heightMapNode.value = tex;
    this.uHasHeightMap.value = 1.0;
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
