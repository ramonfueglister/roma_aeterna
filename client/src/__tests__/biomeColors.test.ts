import { describe, it, expect } from 'vitest';
import { BIOME_COLORS, biomeColorRGB, applyColorNoise } from '../core/biomeColors';
import { BiomeType } from '../types';

describe('BIOME_COLORS', () => {
  it('has a color for every biome type', () => {
    const biomeValues = Object.values(BiomeType).filter(v => typeof v === 'number') as BiomeType[];
    for (const biome of biomeValues) {
      expect(BIOME_COLORS[biome]).toBeDefined();
      expect(typeof BIOME_COLORS[biome]).toBe('number');
    }
  });

  it('all colors are valid RGB hex', () => {
    for (const color of Object.values(BIOME_COLORS)) {
      expect(color).toBeGreaterThanOrEqual(0);
      expect(color).toBeLessThanOrEqual(0xffffff);
    }
  });
});

describe('biomeColorRGB', () => {
  it('returns [r, g, b] in 0-1 range', () => {
    const [r, g, b] = biomeColorRGB(BiomeType.GRASS);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(1);
  });

  it('correctly decomposes WATER_DEEP (0x14326e) per Spec Section 11', () => {
    const [r, g, b] = biomeColorRGB(BiomeType.WATER_DEEP);
    expect(r).toBeCloseTo(0x14 / 255, 2);
    expect(g).toBeCloseTo(0x32 / 255, 2);
    expect(b).toBeCloseTo(0x6e / 255, 2);
  });
});

describe('applyColorNoise', () => {
  it('returns values in 0-1 range', () => {
    for (let i = 0; i < 100; i++) {
      const [r, g, b] = applyColorNoise(0.5, 0.5, 0.5, i, i * 3, i * 7);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic for same coordinates', () => {
    const a = applyColorNoise(0.5, 0.5, 0.5, 10, 20, 30);
    const b = applyColorNoise(0.5, 0.5, 0.5, 10, 20, 30);
    expect(a).toEqual(b);
  });

  it('varies for different coordinates', () => {
    const a = applyColorNoise(0.5, 0.5, 0.5, 0, 0, 0);
    const b = applyColorNoise(0.5, 0.5, 0.5, 100, 100, 100);
    expect(a).not.toEqual(b);
  });
});
