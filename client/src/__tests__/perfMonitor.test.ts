import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PerfMonitor, perfMonitor } from '../core/perfMonitor';
import { FRAME_BUDGET_MS } from '../config';

describe('PerfMonitor', () => {
  beforeEach(() => {
    perfMonitor.reset();
  });

  it('marks frames over budget and computes fps', () => {
    let cursor = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => {
      const value = cursor;
      cursor += 30;
      return value;
    });

    const monitor = new PerfMonitor();
    for (let i = 0; i < 30; i++) {
      monitor.beginFrame();
      monitor.endFrame();
    }

    const snap = monitor.snapshot();

    expect(snap.overBudget).toBe(true);
    expect(snap.fps).toBeLessThan(Math.round(1000 / FRAME_BUDGET_MS));

    spy.mockRestore();
  });

  it('does not flag under-budget snapshots', () => {
    let cursor = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => {
      const value = cursor;
      cursor += 10;
      return value;
    });

    const monitor = new PerfMonitor();
    for (let i = 0; i < 30; i++) {
      monitor.beginFrame();
      monitor.endFrame();
    }

    const snap = monitor.snapshot();

    expect(snap.overBudget).toBe(false);
    expect(snap.fps).toBeGreaterThan(45);

    spy.mockRestore();
  });

  it('surfaces draw call, triangle, and chunk counters in snapshots', () => {
    const monitor = new PerfMonitor();
    monitor.drawCalls = 17;
    monitor.triangles = 4096;
    monitor.chunksLoaded = 11;

    const snap = monitor.snapshot();

    expect(snap.drawCalls).toBe(17);
    expect(snap.triangles).toBe(4096);
    expect(snap.chunksLoaded).toBe(11);
    expect(snap.chunkLoadBudgetExceeded).toBe(false);
  });

  it('reset clears counters and samples', () => {
    perfMonitor.drawCalls = 9;
    perfMonitor.triangles = 99;
    perfMonitor.chunksLoaded = 3;

    perfMonitor.beginFrame();
    perfMonitor.endFrame();

    perfMonitor.reset();

    expect(perfMonitor.drawCalls).toBe(0);
    expect(perfMonitor.triangles).toBe(0);
    expect(perfMonitor.chunksLoaded).toBe(0);
    const snap = perfMonitor.snapshot();
    expect(snap.fps).toBe(0);
    expect(snap.frameTimeMs).toBe(0);
  });

  it('tracks chunk load counters and budget status', () => {
    const monitor = new PerfMonitor();

    monitor.setChunkLoadCount(4);
    monitor.addChunkLoads(3);
    monitor.removeChunkLoads(2);

    const snap = monitor.snapshot();

    expect(snap.chunksLoaded).toBe(5);
    expect(snap.chunkLoadBudgetExceeded).toBe(false);

    monitor.setChunkLoadCount(151);
    expect(monitor.snapshot().chunkLoadBudgetExceeded).toBe(true);
  });
});
