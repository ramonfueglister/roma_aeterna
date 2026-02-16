import { afterEach, describe, expect, it } from 'vitest';

import { QUALITY_PRESETS, QUALITY_PRESET_ORDER, getDefaultQualityPreset, isMobileRuntime, QualityPresetManager } from '../core/qualityManager';
import type { PerfSnapshot } from '../core/perfMonitor';

function makeSnapshot(overBudget: boolean, fps = 10, frameTimeMs = 50): PerfSnapshot {
  return {
    fps,
    frameTimeMs,
    drawCalls: 0,
    triangles: 0,
    jsHeapMB: 0,
    chunksLoaded: 0,
    overBudget,
    chunkLoadBudgetExceeded: false,
  };
}

describe('QualityPresetManager', () => {
  const storageKey = 'imperium.quality.test';

  afterEach(() => {
    window.localStorage.removeItem(storageKey);
  });

  it('loads default preset as high', () => {
    const manager = new QualityPresetManager({ storageKey });
    expect(manager.currentPreset).toBe('high');
  });

  it('falls back to persisted preset if available', () => {
    window.localStorage.setItem(storageKey, 'low');
    const manager = new QualityPresetManager({ storageKey });
    expect(manager.currentPreset).toBe('low');
  });

  it('updates current preset with manual selection', () => {
    const manager = new QualityPresetManager({ storageKey });
    expect(manager.setPreset('toaster')).toBe(true);
    expect(manager.currentPreset).toBe('toaster');
    expect(manager.currentConfig).toEqual(QUALITY_PRESETS.toaster);
  });

  it('defines all quality preset configuration baselines', () => {
    expect(QUALITY_PRESETS.high.label).toBe('High');
    expect(QUALITY_PRESETS.medium.label).toBe('Medium');
    expect(QUALITY_PRESETS.low.label).toBe('Low');
    expect(QUALITY_PRESETS.toaster.label).toBe('Toaster');

    expect(QUALITY_PRESETS.high.workers).toBe(4);
    expect(QUALITY_PRESETS.medium.workers).toBe(4);
    expect(QUALITY_PRESETS.low.workers).toBe(3);
    expect(QUALITY_PRESETS.toaster.workers).toBe(2);

    expect(QUALITY_PRESETS.high.lodDistanceScale).toBe(1);
    expect(QUALITY_PRESETS.medium.lodDistanceScale).toBe(0.5);
    expect(QUALITY_PRESETS.low.lodDistanceScale).toBe(0.25);
    expect(QUALITY_PRESETS.toaster.lodDistanceScale).toBe(0.125);
  });

  it('defaults to toaster profile on mobile', () => {
    const originalUserAgent = navigator.userAgent;
    const setAgent = (value: string) => {
      try {
        Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
      } catch {
        // Some environments expose userAgent as non-configurable.
      }
    };

    setAgent('iPhone');

    try {
      expect(isMobileRuntime()).toBe(true);
      expect(getDefaultQualityPreset()).toBe('toaster');
    } finally {
      setAgent(originalUserAgent);
    }

  });

  it('downgrades after sustained over-budget snapshots', () => {
    const manager = new QualityPresetManager({
      storageKey,
      autoDowngradeFrames: 2,
      autoSwitchCooldownMs: 0,
    });
    manager.setPreset('high');

    manager.updateFromSnapshot(makeSnapshot(true, 20, 40));
    manager.updateFromSnapshot(makeSnapshot(true, 20, 40));

    expect(manager.currentPreset).toBe('medium');
  });

  it('keeps table order stable', () => {
    expect(QUALITY_PRESET_ORDER).toEqual(['high', 'medium', 'low', 'toaster']);
  });

  it('upgrades after sustained below-budget snapshots', () => {
    const manager = new QualityPresetManager({
      storageKey,
      autoDowngradeFrames: 2,
      autoUpgradeFrames: 2,
      autoSwitchCooldownMs: 0,
    });
    expect(manager.setPreset('low')).toBe(true);

    manager.updateFromSnapshot(makeSnapshot(false, 60, 8));
    manager.updateFromSnapshot(makeSnapshot(false, 60, 8));

    expect(manager.currentPreset).toBe('medium');
  });

  it('persists selected preset to localStorage', () => {
    const manager = new QualityPresetManager({ storageKey });
    expect(manager.setPreset('medium')).toBe(true);
    expect(window.localStorage.getItem(storageKey)).toBe('medium');
  });
});
