/**
 * Performance monitor for FPS, memory, and draw call tracking.
 * Provides rolling averages and budget warnings.
 */

import { FRAME_BUDGET_MS, JS_HEAP_BUDGET_MB } from '../config';

export interface PerfSnapshot {
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  triangles: number;
  jsHeapMB: number;
  chunksLoaded: number;
  overBudget: boolean;
}

export class PerfMonitor {
  private frameTimes: number[] = [];
  private lastTime = 0;
  private frameCount = 0;
  private currentFps = 0;
  private currentFrameTime = 0;
  private sampleWindow = 60; // frames for rolling average

  drawCalls = 0;
  triangles = 0;
  chunksLoaded = 0;

  /** Call at the start of each frame. */
  beginFrame(): void {
    this.lastTime = performance.now();
  }

  /** Call at the end of each frame. Returns frame time in ms. */
  endFrame(): number {
    const elapsed = performance.now() - this.lastTime;
    this.frameTimes.push(elapsed);
    if (this.frameTimes.length > this.sampleWindow) {
      this.frameTimes.shift();
    }
    this.frameCount++;

    // Update rolling averages every 30 frames
    if (this.frameCount % 30 === 0) {
      const sum = this.frameTimes.reduce((a, b) => a + b, 0);
      this.currentFrameTime = sum / this.frameTimes.length;
      this.currentFps = 1000 / this.currentFrameTime;
    }

    return elapsed;
  }

  /** Get current performance snapshot. */
  snapshot(): PerfSnapshot {
    const jsHeapMB = this.getJsHeapMB();
    return {
      fps: Math.round(this.currentFps),
      frameTimeMs: Math.round(this.currentFrameTime * 100) / 100,
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      jsHeapMB: Math.round(jsHeapMB),
      chunksLoaded: this.chunksLoaded,
      overBudget: this.currentFrameTime > FRAME_BUDGET_MS,
    };
  }

  /** Check if JS heap is near budget. */
  isHeapNearBudget(): boolean {
    return this.getJsHeapMB() > JS_HEAP_BUDGET_MB * 0.85;
  }

  private getJsHeapMB(): number {
    const perf = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    if (perf.memory) {
      return perf.memory.usedJSHeapSize / (1024 * 1024);
    }
    return 0;
  }

  /** Reset all counters. */
  reset(): void {
    this.frameTimes.length = 0;
    this.frameCount = 0;
    this.currentFps = 0;
    this.currentFrameTime = 0;
    this.drawCalls = 0;
    this.triangles = 0;
    this.chunksLoaded = 0;
  }
}

/** Singleton performance monitor. */
export const perfMonitor = new PerfMonitor();
