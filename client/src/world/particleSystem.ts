/**
 * GPU particle system for ambient world effects (TSL / WebGPURenderer).
 *
 * Single THREE.Points object with PointsNodeMaterial renders all
 * particle types in one draw call. Particles are animated entirely on
 * the GPU via TSL vertex position/size/color nodes; the CPU only
 * updates the uniform for elapsed time and camera position each frame.
 *
 * Three particle types:
 *   0 = Desert Dust:   sandy wisps over DESERT/SCRUB biome tiles
 *   1 = City Smoke:    dark gray wisps rising from Tier 1-2 cities
 *   2 = Coastal Birds:  dark specks circling near port cities
 *
 * Target: <1ms GPU for all particles.
 */

import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import {
  attribute,
  uniform,
  float,
  vec2,
  vec3,
  Fn,
  cos,
  sin,
  mod,
  smoothstep,
  length,
  select,
  positionGeometry,
  pointUV,
} from 'three/tsl';
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

// ── Particle type IDs ──────────────────────────────────────────

const TYPE_DUST = 0;
const TYPE_SMOKE = 1;
const TYPE_BIRDS = 2;

// ── Particle System Class ──────────────────────────────────────

export class ParticleSystem {
  private points: THREE.Points;
  private material: InstanceType<typeof PointsNodeMaterial>;
  private geometry: THREE.BufferGeometry;
  private particleCount: number;

  // Uniforms exposed for per-frame updates
  private readonly _uElapsed = uniform(0);
  private readonly _uCameraPos = uniform(new THREE.Vector3());

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
    for (let i = 0; i < MAX_DUST; i++) {
      const wx = (Math.random() - 0.5) * MAP_SIZE;
      const wz = (Math.random() - 0.5) * MAP_SIZE;
      const wy = WATER_LEVEL + 2 + Math.random() * 8;

      positions[idx * 3] = wx;
      positions[idx * 3 + 1] = wy;
      positions[idx * 3 + 2] = wz;

      velocities[idx * 3] = (Math.random() - 0.5) * 2.0;
      velocities[idx * 3 + 1] = Math.random() * 0.3;
      velocities[idx * 3 + 2] = (Math.random() - 0.5) * 1.5;

      types[idx] = TYPE_DUST;
      lives[idx] = Math.random() * 20;
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
    this.geometry.setAttribute('particleType', new THREE.BufferAttribute(types, 1));
    this.geometry.setAttribute('life', new THREE.BufferAttribute(lives, 1));
    this.geometry.setAttribute('maxLife', new THREE.BufferAttribute(maxLives, 1));

    // ── TSL Material ──────────────────────────────────────────
    this.material = new PointsNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      sizeAttenuation: true,
    });

    // TSL attribute accessors
    const aVelocity = attribute('velocity', 'vec3');
    const aType = attribute('particleType', 'float');
    const aLife = attribute('life', 'float');
    const aMaxLife = attribute('maxLife', 'float');

    const uElapsed = this._uElapsed;
    const uCameraPos = this._uCameraPos;

    // ── Vertex Position Node ──────────────────────────────────
    // Animate position: base + velocity * t, with bird circular orbit
    const positionFn = Fn(() => {
      const pos = positionGeometry.toVar();
      const vel = aVelocity;
      const pType = aType;
      const life = aLife;
      const maxLife = aMaxLife;

      // Life cycle phase: wrap elapsed into [0, maxLife)
      const t = mod(uElapsed.add(life), maxLife);

      // Base animation: position + velocity * t
      const animPos = pos.add(vel.mul(t)).toVar();

      // Bird circular orbit
      const isBird = pType.greaterThan(1.5);
      const angle = uElapsed.mul(0.3).add(life.mul(6.2831));
      const radius = float(15.0).add(life.mul(10.0));
      animPos.x.addAssign(select(isBird, cos(angle).mul(radius), float(0)));
      animPos.z.addAssign(select(isBird, sin(angle).mul(radius), float(0)));

      return animPos;
    });

    this.material.positionNode = positionFn();

    // ── Size Node ─────────────────────────────────────────────
    // Point size by type: dust=2, smoke=3, birds=4
    const sizeFn = Fn(() => {
      const pType = aType;
      return select(pType.lessThan(0.5), float(2.0),
        select(pType.lessThan(1.5), float(3.0), float(4.0)));
    });

    this.material.sizeNode = sizeFn();

    // ── Color + Opacity Node ──────────────────────────────────
    // Color by type, alpha by life phase + distance culling
    const colorFn = Fn(() => {
      const pType = aType;
      return select(pType.lessThan(0.5),
        vec3(0.82, 0.72, 0.53),      // Desert dust: sandy
        select(pType.lessThan(1.5),
          vec3(0.35, 0.33, 0.32),    // City smoke: dark gray
          vec3(0.15, 0.13, 0.12),    // Coastal birds: dark specks
        ),
      );
    });

    this.material.colorNode = colorFn();

    const opacityFn = Fn(() => {
      const pType = aType;
      const life = aLife;
      const maxLife = aMaxLife;

      // Life cycle phase
      const t = mod(uElapsed.add(life), maxLife);
      const lifeRatio = t.div(maxLife);

      // Fade in/out over life
      const fadeIn = smoothstep(float(0.0), float(0.1), lifeRatio);
      const fadeOut = float(1.0).sub(smoothstep(float(0.75), float(1.0), lifeRatio));

      // Distance from camera (XZ plane)
      const animPos = positionGeometry.add(aVelocity.mul(t)).toVar();
      // Add bird orbit offset for correct distance
      const isBird = pType.greaterThan(1.5);
      const birdAngle = uElapsed.mul(0.3).add(life.mul(6.2831));
      const birdRadius = float(15.0).add(life.mul(10.0));
      animPos.x.addAssign(select(isBird, cos(birdAngle).mul(birdRadius), float(0)));
      animPos.z.addAssign(select(isBird, sin(birdAngle).mul(birdRadius), float(0)));

      const dx = animPos.x.sub(uCameraPos.x);
      const dz = animPos.z.sub(uCameraPos.z);
      const distSq = dx.mul(dx).add(dz.mul(dz));
      const radiusSq = float(VISIBLE_RADIUS * VISIBLE_RADIUS);

      // Radius-based culling
      const inRadius = distSq.lessThan(radiusSq);
      // Camera height culling
      const belowMaxHeight = uCameraPos.y.lessThan(float(MAX_VISIBLE_HEIGHT));
      // Dust: additional height check
      const isDust = pType.lessThan(0.5);
      const dustVisible = uCameraPos.y.lessThan(float(DUST_CAMERA_HEIGHT));
      const typeVisible = select(isDust, dustVisible, float(1.0));

      // Distance fade
      const distFade = float(1.0).sub(smoothstep(radiusSq.mul(0.5), radiusSq, distSq));

      // Soft circle from point UV
      const center = pointUV.sub(vec2(0.5));
      const pointDist = length(center);
      const circle = float(1.0).sub(smoothstep(float(0.3), float(0.5), pointDist));

      // Combine all factors
      const baseAlpha = fadeIn.mul(fadeOut).mul(distFade).mul(circle);
      return select(inRadius, select(belowMaxHeight, baseAlpha.mul(typeVisible), float(0)), float(0));
    });

    this.material.opacityNode = opacityFn();

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
    this._uElapsed.value = elapsed;
    (this._uCameraPos.value as THREE.Vector3).set(cameraX, cameraY, cameraZ);
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
