/**
 * System #23: HudSystem
 *
 * Updates DOM HUD elements with performance stats, camera position,
 * and chunk loading status. Throttled to every 30 frames to avoid
 * DOM thrashing.
 *
 * Frequency: every 30 frames (~2x per second at 60fps)
 */

import type { World } from 'bitecs';
import { perfMonitor } from '../../core/perfMonitor';
import { getCameraWorldX, getCameraHeight, getCameraWorldZ } from './viewportSystem';
import { getChunkLoaderRef } from './chunkLoadSystem';

export interface HudElements {
  fpsNode: HTMLDivElement | null;
  chunksNode: HTMLDivElement | null;
  coordsNode: HTMLDivElement | null;
  toastEl: HTMLDivElement | null;
  dispose: () => void;
}

let hudRef: HudElements | null = null;
let frameCount = 0;
let toastCleared = false;

export function setHudRef(hud: HudElements): void {
  hudRef = hud;
}

export function setToast(title: string, body: string): void {
  if (hudRef?.toastEl) {
    hudRef.toastEl.innerHTML = `<div class="title">${title}</div><div>${body}</div>`;
  }
}

export function hudSystem(_world: World, _delta: number): void {
  if (!hudRef) return;

  frameCount++;
  if (frameCount % 30 !== 0) return;

  const snap = perfMonitor.snapshot();
  const camX = getCameraWorldX();
  const camY = getCameraHeight();
  const camZ = getCameraWorldZ();

  if (hudRef.fpsNode) {
    hudRef.fpsNode.textContent = `FPS: ${snap.fps} | Draw: ${snap.drawCalls} | Tri: ${snap.triangles}`;
  }

  if (hudRef.coordsNode) {
    hudRef.coordsNode.textContent = `Camera: x=${camX.toFixed(0)}, y=${camY.toFixed(0)}, z=${camZ.toFixed(0)}`;
  }

  const loader = getChunkLoaderRef();
  if (loader && hudRef.chunksNode) {
    hudRef.chunksNode.textContent = `Chunks: ${loader.loadedCount} loaded, ${loader.pendingCount} pending`;
  }

  if (!toastCleared && loader && loader.loadedCount > 0) {
    toastCleared = true;
    setToast('Imperium', `${loader.loadedCount} chunks loaded`);
  }
}
