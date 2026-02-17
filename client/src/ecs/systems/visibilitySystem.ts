/**
 * System #15: VisibilitySystem
 *
 * Sets Visible.value on entities based on camera height thresholds.
 * Uses the camera state from viewportSystem (no Three.js frustum
 * needed since existing renderers handle their own culling).
 *
 * Height-based visibility rules:
 *   - Cities Tier 1-2: always visible (up to 5000)
 *   - Cities Tier 3-4: visible when camera < 1500
 *   - Trees: visible when camera < 3000
 *   - Agents: visible when camera < 2000
 *   - Province entities: visible when camera > 300
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';
import { query } from 'bitecs';
import { IsCity, IsTree, IsAgent, IsProvince, Visible, CityInfo, Position } from '../components';
import { getCameraHeight, getCameraWorldX, getCameraWorldZ } from './viewportSystem';

export function visibilitySystem(world: World, _delta: number): void {
  const camH = getCameraHeight();
  const camX = getCameraWorldX();
  const camZ = getCameraWorldZ();

  // ── Cities ─────────────────────────────────────────────────
  const cities = query(world, [IsCity, Visible, CityInfo, Position]);
  for (let i = 0; i < cities.length; i++) {
    const eid = cities[i]!;
    const tier = CityInfo.tier[eid]!;

    if (tier <= 2) {
      // Major cities visible up to strategic zoom
      Visible.value[eid] = camH < 5000 ? 1 : 0;
    } else {
      // Minor cities visible at closer range
      if (camH > 1500) {
        Visible.value[eid] = 0;
      } else {
        // Distance cull at tactical range
        const dx = Position.x[eid]! - camX;
        const dz = Position.z[eid]! - camZ;
        const distSq = dx * dx + dz * dz;
        Visible.value[eid] = distSq < 2000 * 2000 ? 1 : 0;
      }
    }
  }

  // ── Trees ──────────────────────────────────────────────────
  const trees = query(world, [IsTree, Visible, Position]);
  const treeVisible = camH < 3000 ? 1 : 0;
  for (let i = 0; i < trees.length; i++) {
    const eid = trees[i]!;
    if (treeVisible === 0) {
      Visible.value[eid] = 0;
    } else {
      // Distance cull trees
      const dx = Position.x[eid]! - camX;
      const dz = Position.z[eid]! - camZ;
      const distSq = dx * dx + dz * dz;
      const visRadius = camH < 300 ? 200 : camH < 1500 ? 800 : 400;
      Visible.value[eid] = distSq < visRadius * visRadius ? 1 : 0;
    }
  }

  // ── Agents ─────────────────────────────────────────────────
  const agents = query(world, [IsAgent, Visible, Position]);
  const agentVisible = camH < 2000 ? 1 : 0;
  for (let i = 0; i < agents.length; i++) {
    const eid = agents[i]!;
    if (agentVisible === 0) {
      Visible.value[eid] = 0;
    } else {
      const dx = Position.x[eid]! - camX;
      const dz = Position.z[eid]! - camZ;
      const distSq = dx * dx + dz * dz;
      const visRadius = Math.min(600, camH * 0.8);
      Visible.value[eid] = distSq < visRadius * visRadius ? 1 : 0;
    }
  }

  // ── Provinces ──────────────────────────────────────────────
  const provinces = query(world, [IsProvince, Visible]);
  const provVisible = camH > 300 ? 1 : 0;
  for (let i = 0; i < provinces.length; i++) {
    Visible.value[provinces[i]!] = provVisible;
  }
}
