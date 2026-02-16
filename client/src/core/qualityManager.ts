import { FRAME_BUDGET_MS } from '../config';
import type { PerfSnapshot } from './perfMonitor';
import type { QualityPreset, QualityPresetConfig } from '../types';

const QUALITY_STORAGE_KEY = 'imperium.quality.preset';
const DEFAULT_AUTO_DOWNGRADE_FRAMES = 10;
const DEFAULT_AUTO_UPGRADE_FRAMES = 30;
const DEFAULT_AUTO_SWITCH_COOLDOWN_MS = 1500;

export const QUALITY_PRESET_ORDER: QualityPreset[] = ['high', 'medium', 'low', 'toaster'];

export const QUALITY_PRESETS: Record<QualityPreset, QualityPresetConfig> = {
  high: {
    preset: 'high',
    label: 'High',
    targetFps: 60,
    workers: 4,
    treeInstances: 5000,
    cityCache: 30,
    lodDistanceScale: 1,
    waterShader: 'full',
    ambientEffects: 'full',
    ambientFxEmitters: 260,
    cloudLayers: 2,
    streetLifeCap: 220,
    harvestLoopCap: 120,
    labelCap: 50,
    contactShadows: 'screen-space',
  },
  medium: {
    preset: 'medium',
    label: 'Medium',
    targetFps: 60,
    workers: 4,
    treeInstances: 1000,
    cityCache: 15,
    lodDistanceScale: 0.5,
    waterShader: 'normal',
    ambientEffects: 'reduced',
    ambientFxEmitters: 170,
    cloudLayers: 1,
    streetLifeCap: 140,
    harvestLoopCap: 80,
    labelCap: 40,
    contactShadows: 'screen-space',
  },
  low: {
    preset: 'low',
    label: 'Low',
    targetFps: 45,
    workers: 3,
    treeInstances: 200,
    cityCache: 5,
    lodDistanceScale: 0.25,
    waterShader: 'flat',
    ambientEffects: 'core',
    ambientFxEmitters: 90,
    cloudLayers: 1,
    streetLifeCap: 80,
    harvestLoopCap: 48,
    labelCap: 20,
    contactShadows: 'blob',
  },
  toaster: {
    preset: 'toaster',
    label: 'Toaster',
    targetFps: 30,
    workers: 2,
    treeInstances: 0,
    cityCache: 2,
    lodDistanceScale: 0.125,
    waterShader: 'flat',
    ambientEffects: 'core',
    ambientFxEmitters: 45,
    cloudLayers: 0,
    streetLifeCap: 40,
    harvestLoopCap: 24,
    labelCap: 8,
    contactShadows: 'blob',
  },
};

function isSupportedStorageValue(value: unknown): value is QualityPreset {
  return value === 'high' || value === 'medium' || value === 'low' || value === 'toaster';
}

export function readStoredQualityPreset(key: string = QUALITY_STORAGE_KEY): QualityPreset | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      return null;
    }
    return isSupportedStorageValue(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeStoredQualityPreset(preset: QualityPreset, key: string = QUALITY_STORAGE_KEY): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(key, preset);
  } catch {
    // Non-fatal; storage can fail in private mode or restricted environments.
  }
}

export interface QualityManagerOptions {
  initialPreset?: QualityPreset;
  storageKey?: string;
  autoDowngradeFrames?: number;
  autoUpgradeFrames?: number;
  autoSwitchCooldownMs?: number;
}

export function isMobileRuntime(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
}

export function getDefaultQualityPreset(): QualityPreset {
  return isMobileRuntime() ? 'toaster' : 'high';
}

export class QualityPresetManager {
  private preset: QualityPreset;
  private overBudgetFrameCount = 0;
  private underBudgetFrameCount = 0;
  private lastAutoSwitchAt = 0;
  private readonly storageKey: string;
  private readonly autoDowngradeFrames: number;
  private readonly autoUpgradeFrames: number;
  private readonly autoSwitchCooldownMs: number;
  private readonly now: () => number;

  constructor(options: QualityManagerOptions = {}) {
    this.storageKey = options.storageKey ?? QUALITY_STORAGE_KEY;
    this.autoDowngradeFrames = options.autoDowngradeFrames ?? DEFAULT_AUTO_DOWNGRADE_FRAMES;
    this.autoUpgradeFrames = options.autoUpgradeFrames ?? DEFAULT_AUTO_UPGRADE_FRAMES;
    this.autoSwitchCooldownMs = options.autoSwitchCooldownMs ?? DEFAULT_AUTO_SWITCH_COOLDOWN_MS;
    this.now = () => Date.now();

    const stored = readStoredQualityPreset(this.storageKey);
    this.preset = options.initialPreset ?? stored ?? getDefaultQualityPreset();
  }

  get currentPreset(): QualityPreset {
    return this.preset;
  }

  get currentConfig(): QualityPresetConfig {
    return QUALITY_PRESETS[this.preset];
  }

  setPreset(preset: QualityPreset, persist = true): boolean {
    if (preset === this.preset) {
      return false;
    }
    this.preset = preset;
    this.overBudgetFrameCount = 0;
    this.underBudgetFrameCount = 0;

    if (persist) {
      writeStoredQualityPreset(preset, this.storageKey);
    }
    return true;
  }

  private presetIndex(preset: QualityPreset = this.preset): number {
    return QUALITY_PRESET_ORDER.indexOf(preset);
  }

  private canStepDown(): boolean {
    return this.presetIndex(this.preset) < QUALITY_PRESET_ORDER.length - 1;
  }

  private canStepUp(): boolean {
    return this.presetIndex(this.preset) > 0;
  }

  private stepDown(): void {
    const index = this.presetIndex(this.preset);
    const next = QUALITY_PRESET_ORDER[index + 1];
    if (next) {
      this.setPreset(next);
      this.lastAutoSwitchAt = this.now();
    }
  }

  private stepUp(): void {
    const index = this.presetIndex(this.preset);
    const next = QUALITY_PRESET_ORDER[index - 1];
    if (next) {
      this.setPreset(next);
      this.lastAutoSwitchAt = this.now();
    }
  }

  private canAutoSwitch(nowMs: number): boolean {
    return nowMs - this.lastAutoSwitchAt >= this.autoSwitchCooldownMs;
  }

  updateFromSnapshot(snapshot: PerfSnapshot): QualityPreset {
    if (!snapshot || snapshot.frameTimeMs <= 0) {
      return this.preset;
    }

    if (snapshot.overBudget || snapshot.fps < this.currentConfig.targetFps * 0.85) {
      this.overBudgetFrameCount += 1;
      this.underBudgetFrameCount = 0;
    } else {
      this.underBudgetFrameCount += 1;
      this.overBudgetFrameCount = 0;
    }

    const now = this.now();

    if (snapshot.overBudget && this.canAutoSwitch(now) && this.overBudgetFrameCount >= this.autoDowngradeFrames && this.canStepDown()) {
      this.stepDown();
      return this.preset;
    }

    if (!snapshot.overBudget && this.canAutoSwitch(now) && this.underBudgetFrameCount >= this.autoUpgradeFrames && this.canStepUp()) {
      // Upgrade only when consistently under budget, and only if frame time is
      // well below target budget.
      if (snapshot.frameTimeMs <= FRAME_BUDGET_MS * 0.85) {
        this.stepUp();
      }
      return this.preset;
    }

    return this.preset;
  }
}
