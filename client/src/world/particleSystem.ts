/**
 * GPU particle system for ambient world effects.
 *
 * Single THREE.Points object with a custom ShaderMaterial renders all
 * particle types in one draw call. Particles are animated entirely on
 * the GPU via the vertex shader; the CPU only updates the uniform
 * for elapsed time and camera position each frame.
 *
 * Three particle types:
 *   0 = Desert Dust:   sandy wisps over DESERT/SCRUB biome tiles
 *   1 = City Smoke:    dark gray wisps rising from Tier 1-2 cities
 *   2 = Coastal Birds:  dark specks circling near port cities
 *
 * Target: <1ms GPU for all particles.
 */

import * as THREE from 'three';
import { MAP_SIZE, WATER_LEVEL } from '../config';
import { CITY_DATABASE } from './cityDatabase';

// ── Constants ───────────────────────────────────────────────────

const HALF_MAP = MAP_SIZE / 2;

/** Camera height above which all particles are hidden. */
const MAX_VISIBLE_HEIGHT = 2000;

/** Radius around camera within which particles are rendered. */
const VISIBLE_RADIUS = 600;

/** Maximum number of desert dust particles. */
const MAX_DUST = 200;

/** Particles per qualifying city for smoke. */
const SMOKE_PER_CITY = 5;

/** Maximum number of coastal bird particles. */
const MAX_BIRDS = 30;

/** Camera height threshold below which desert dust spawns. */
const DUST_CAMERA_HEIGHT = 200;

// ── Particle type IDs (must match shader) ───────────────────────

const TYPE_DUST = 0;
const TYPE_SMOKE = 1;
const TYPE_BIRDS = 2;

// ── Shader Source ───────────────────────────────────────────────

const vertexShader = /* glsl */ `
  attribute vec3 velocity;
  attribute float type;
  attribute float life;
  attribute float maxLife;

  uniform float uElapsed;
  uniform vec3 uCameraPos;
  uniform float uVisibleRadius;
  uniform float uMaxVisibleHeight;

  varying float vAlpha;
  varying float vType;

  void main() {
    // Compute current life phase: wrap elapsed into [0, maxLife) cycle
    float t = mod(uElapsed + life, maxLife);
    float lifeRatio = t / maxLife;

    // Animate position: base + velocity * t
    vec3 animPos = position + velocity * t;

    // Type-specific motion
    if (type > 1.5) {
      // Coastal birds: circular orbit
      float angle = uElapsed * 0.3 + life * 6.2831;
      float radius = 15.0 + life * 10.0;
      animPos.x += cos(angle) * radius;
      animPos.z += sin(angle) * radius;
    }

    // Distance from camera (XZ plane)
    float dx = animPos.x - uCameraPos.x;
    float dz = animPos.z - uCameraPos.z;
    float distSq = dx * dx + dz * dz;
    float radiusSq = uVisibleRadius * uVisibleRadius;

    // Radius-based culling + camera height culling
    bool visible = distSq < radiusSq && uCameraPos.y < uMaxVisibleHeight;

    // Desert dust: additional height check
    if (type < 0.5) {
      visible = visible && uCameraPos.y < ${DUST_CAMERA_HEIGHT.toFixed(1)};
    }

    // Alpha: fade in at start, fade out at end of life
    float fadeIn = smoothstep(0.0, 0.1, lifeRatio);
    float fadeOut = 1.0 - smoothstep(0.75, 1.0, lifeRatio);
    float distFade = 1.0 - smoothstep(radiusSq * 0.5, radiusSq, distSq);

    vAlpha = visible ? fadeIn * fadeOut * distFade : 0.0;
    vType = type;

    // Point size by type
    float size;
    if (type < 0.5) {
      size = 2.0; // dust
    } else if (type < 1.5) {
      size = 3.0; // smoke
    } else {
      size = 4.0; // birds
    }

    vec4 mvPosition = modelViewMatrix * vec4(animPos, 1.0);
    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 1.0, 16.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  varying float vType;

  void main() {
    if (vAlpha < 0.01) discard;

    // Render as soft circle
    vec2 center = gl_PointCoord - vec2(0.5);
    float dist = length(center);
    if (dist > 0.5) discard;
    float circle = 1.0 - smoothstep(0.3, 0.5, dist);

    // Color by type
    vec3 color;
    if (vType < 0.5) {
      // Desert dust: sandy
      color = vec3(0.82, 0.72, 0.53);
    } else if (vType < 1.5) {
      // City smoke: dark gray
      color = vec3(0.35, 0.33, 0.32);
    } else {
      // Coastal birds: dark specks
      color = vec3(0.15, 0.13, 0.12);
    }

    gl_FragColor = vec4(color, vAlpha * circle);
  }
`;

// ── Particle System Class ───────────────────────────────────────

export class ParticleSystem {
  private points: THREE.Points;
  private material: THREE.ShaderMaterial;
  private geometry: THREE.BufferGeometry;
  private particleCount: number;

  constructor(scene: THREE.Scene) {
    // Gather spawn sources from city database
    const smokeCities = CITY_DATABASE.filter((c) => c.tier <= 2);
    const portCities = CITY_DATABASE.filter((c) => c.isPort);

    const smokeCount = smokeCities.length * SMOKE_PER_CITY;
    const birdCount = Math.min(portCities.length, MAX_BIRDS);
    this.particleCount = MAX_DUST + smokeCount + birdCount;

    // Allocate attribute arrays
    const positions = new Float32Array(this.particleCount * 3);
    const velocities = new Float32Array(this.particleCount * 3);
    const types = new Float32Array(this.particleCount);
    const lives = new Float32Array(this.particleCount);
    const maxLives = new Float32Array(this.particleCount);

    let idx = 0;

    // ── Desert Dust ───────────────────────────────────────────
    // Spread randomly across a large area; the shader culls by radius
    for (let i = 0; i < MAX_DUST; i++) {
      const wx = (Math.random() - 0.5) * MAP_SIZE;
      const wz = (Math.random() - 0.5) * MAP_SIZE;
      const wy = WATER_LEVEL + 2 + Math.random() * 8;

      positions[idx * 3] = wx;
      positions[idx * 3 + 1] = wy;
      positions[idx * 3 + 2] = wz;

      // Slow horizontal drift
      velocities[idx * 3] = (Math.random() - 0.5) * 2.0;
      velocities[idx * 3 + 1] = Math.random() * 0.3;
      velocities[idx * 3 + 2] = (Math.random() - 0.5) * 1.5;

      types[idx] = TYPE_DUST;
      lives[idx] = Math.random() * 20; // phase offset
      maxLives[idx] = 15 + Math.random() * 10;

      idx++;
    }

    // ── City Smoke ────────────────────────────────────────────
    for (const city of smokeCities) {
      const cx = city.tileX - HALF_MAP;
      const cz = city.tileY - HALF_MAP;
      const baseY = WATER_LEVEL + 8;

      for (let s = 0; s < SMOKE_PER_CITY; s++) {
        positions[idx * 3] = cx + (Math.random() - 0.5) * 6;
        positions[idx * 3 + 1] = baseY + Math.random() * 3;
        positions[idx * 3 + 2] = cz + (Math.random() - 0.5) * 6;

        // Rising slowly with slight horizontal drift
        velocities[idx * 3] = (Math.random() - 0.5) * 0.4;
        velocities[idx * 3 + 1] = 0.8 + Math.random() * 0.6;
        velocities[idx * 3 + 2] = (Math.random() - 0.5) * 0.4;

        types[idx] = TYPE_SMOKE;
        lives[idx] = Math.random() * 12;
        maxLives[idx] = 8 + Math.random() * 6;

        idx++;
      }
    }

    // ── Coastal Birds ─────────────────────────────────────────
    for (let i = 0; i < birdCount; i++) {
      const city = portCities[i % portCities.length]!;
      const cx = city.tileX - HALF_MAP;
      const cz = city.tileY - HALF_MAP;
      const baseY = WATER_LEVEL + 20 + Math.random() * 15;

      positions[idx * 3] = cx + (Math.random() - 0.5) * 20;
      positions[idx * 3 + 1] = baseY;
      positions[idx * 3 + 2] = cz + (Math.random() - 0.5) * 20;

      // Slow circling handled primarily by shader; velocity adds slight drift
      velocities[idx * 3] = (Math.random() - 0.5) * 0.2;
      velocities[idx * 3 + 1] = (Math.random() - 0.5) * 0.1;
      velocities[idx * 3 + 2] = (Math.random() - 0.5) * 0.2;

      types[idx] = TYPE_BIRDS;
      lives[idx] = Math.random() * 30;
      maxLives[idx] = 25 + Math.random() * 15;

      idx++;
    }

    // ── Build Geometry ────────────────────────────────────────
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    this.geometry.setAttribute('type', new THREE.BufferAttribute(types, 1));
    this.geometry.setAttribute('life', new THREE.BufferAttribute(lives, 1));
    this.geometry.setAttribute('maxLife', new THREE.BufferAttribute(maxLives, 1));

    // ── Material ─────────────────────────────────────────────
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uElapsed: { value: 0 },
        uCameraPos: { value: new THREE.Vector3() },
        uVisibleRadius: { value: VISIBLE_RADIUS },
        uMaxVisibleHeight: { value: MAX_VISIBLE_HEIGHT },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    // ── Points Object ────────────────────────────────────────
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false; // shader handles culling
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  /**
   * Update uniforms for the current frame. All animation runs on GPU.
   */
  update(cameraX: number, cameraY: number, cameraZ: number, elapsed: number): void {
    const uniforms = this.material.uniforms;
    uniforms['uElapsed']!.value = elapsed;
    (uniforms['uCameraPos']!.value as THREE.Vector3).set(cameraX, cameraY, cameraZ);
  }

  /**
   * Clean up GPU resources.
   */
  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
