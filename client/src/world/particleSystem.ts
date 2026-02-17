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
  mix,
  smoothstep,
  length,
  select,
  // Note: attribute('position','vec3') used instead of positionGeometry/positionLocal
  // to avoid circular reference in NodeMaterial.setupPosition()
  pointUV,
} from 'three/tsl';
import { MAP_SIZE, WATER_LEVEL } from '../config';
import { CITY_DATABASE } from './cityDatabase';

// ── Constants ───────────────────────────────────────────────────

const HALF_MAP = MAP_SIZE / 2;

/** Camera height above which all particles are hidden (spec §13: smoke < 500). */
const MAX_VISIBLE_HEIGHT = 500;

/** Radius around camera within which particles are rendered. */
const VISIBLE_RADIUS = 600;

/** Maximum number of desert dust particles. */
const MAX_DUST = 200;

/** Particles per qualifying city for smoke. */
const SMOKE_PER_CITY = 5;

/** Maximum number of coastal bird particles. */
const MAX_BIRDS = 30;

/** Camera height threshold below which desert dust spawns (spec §13: < 300). */
const DUST_CAMERA_HEIGHT = 300;

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

        // Spec §13: rise speed 0.3 voxels/frame, wind drift 0.05 eastward
        velocities[idx * 3] = 0.05 + (Math.random() - 0.5) * 0.1;  // eastward wind drift
        velocities[idx * 3 + 1] = 0.3 + Math.random() * 0.15;       // rise speed ~0.3
        velocities[idx * 3 + 2] = (Math.random() - 0.5) * 0.1;

        types[idx] = TYPE_SMOKE;
        lives[idx] = Math.random() * 5;
        maxLives[idx] = 3 + Math.random() * 2; // spec §13: lifetime 3-5 seconds
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
      const pos = attribute('position', 'vec3').toVar();
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
    // Spec §13: smoke 2x2x2 voxels, scale 1.0→2.5 over life; birds ~4px
    const sizeFn = Fn(() => {
      const pType = aType;
      const life = aLife;
      const maxLife = aMaxLife;
      // Smoke scale animation: 1.0 at spawn → 2.5 at end (spec §13)
      const smokeT = mod(uElapsed.add(life), maxLife).div(maxLife);
      const smokeSize = mix(float(2.0), float(5.0), smokeT); // 2px base * (1.0→2.5)
      return select(pType.lessThan(0.5), float(2.0),
        select(pType.lessThan(1.5), smokeSize, float(4.0)));
    });

    this.material.sizeNode = sizeFn();

    // ── Color + Opacity Node ──────────────────────────────────
    // Color by type, alpha by life phase + distance culling
    const colorFn = Fn(() => {
      const pType = aType;
      const life = aLife;
      const maxLife = aMaxLife;
      // Smoke color fades: (180,180,180) at spawn → (220,220,220) at end (spec §13)
      const smokeT = mod(uElapsed.add(life), maxLife).div(maxLife);
      const smokeColor = mix(
        vec3(180 / 255, 180 / 255, 180 / 255),
        vec3(220 / 255, 220 / 255, 220 / 255),
        smokeT,
      );
      return select(pType.lessThan(0.5),
        vec3(0.82, 0.72, 0.53),      // Desert dust: sandy
        select(pType.lessThan(1.5),
          smokeColor,                  // City smoke: spec §13 gray gradient
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
      const animPos = attribute('position', 'vec3').add(aVelocity.mul(t)).toVar();
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
      // Per-type camera height culling (spec §13)
      const isDust = pType.lessThan(0.5);
      const isSmoke = pType.greaterThanEqual(0.5).and(pType.lessThan(1.5));
      const isBirdType = pType.greaterThan(1.5);
      // Dust: visible < 300 (DUST_CAMERA_HEIGHT)
      const dustVisible = uCameraPos.y.lessThan(float(DUST_CAMERA_HEIGHT));
      // Smoke: visible < 500 (MAX_VISIBLE_HEIGHT) per spec §13
      const smokeVisible = uCameraPos.y.lessThan(float(MAX_VISIBLE_HEIGHT));
      // Birds: visible < 300 per spec §13
      const birdTypeVisible = uCameraPos.y.lessThan(float(300.0));
      const typeVisible = select(isDust, dustVisible,
        select(isSmoke, smokeVisible, select(isBirdType, birdTypeVisible, float(1.0))));

      // Distance fade
      const distFade = float(1.0).sub(smoothstep(radiusSq.mul(0.5), radiusSq, distSq));

      // Soft circle from point UV
      const center = pointUV.sub(vec2(0.5));
      const pointDist = length(center);
      const circle = float(1.0).sub(smoothstep(float(0.3), float(0.5), pointDist));

      // Combine all factors
      const baseAlpha = fadeIn.mul(fadeOut).mul(distFade).mul(circle);
      return select(inRadius, baseAlpha.mul(typeVisible), float(0));
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
