import { describe, it, expect } from 'vitest';
import { CHUNK_SIZE, CHUNK_LOAD_BUDGET, CHUNKS_PER_AXIS, MAP_SIZE, validateAndLoadConfig } from '../config';

describe('config', () => {
  it('loads default runtime config with valid values', () => {
    const result = validateAndLoadConfig();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.config.appName).toBe('Imperium');
    expect(result.config.mapSize).toBe(2048);
  });

  it('validates geometry relationships', () => {
    const result = validateAndLoadConfig();
    expect(result.valid).toBe(true);
    expect(result.config.mapSize % result.config.chunkSize).toBe(0);
    expect(result.config.gridSize).toBe(result.config.mapSize / result.config.chunkSize);
    expect(result.config.totalChunks).toBe(result.config.gridSize * result.config.gridSize);
  });

  it('fails when required values are invalid', () => {
    const result = validateAndLoadConfig({ mapSize: -1, minZoom: 100, maxZoom: 50, totalChunks: 10 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('mapSize must be greater than 0');
    expect(result.errors).toContain('minZoom (100) must be smaller than maxZoom (50)');
    expect(result.errors.some((error) => error.startsWith('totalChunks must equal gridSize^2'))).toBe(true);
  });

  it('accepts valid overrides while preserving invariants', () => {
    const result = validateAndLoadConfig({ targetFps: 30 });
    expect(result.valid).toBe(true);
    expect(result.config.targetFps).toBe(30);
    expect(result.config.frameBudgetMs).toBe(1000 / 30);
  });

  it('exports map/chunk size constants', () => {
    expect(typeof MAP_SIZE).toBe('number');
    expect(typeof CHUNK_SIZE).toBe('number');
    expect(typeof CHUNKS_PER_AXIS).toBe('number');
    expect(typeof CHUNK_LOAD_BUDGET).toBe('number');
    expect(MAP_SIZE).toBeGreaterThan(CHUNK_SIZE);
    expect(MAP_SIZE % CHUNK_SIZE).toBe(0);
    expect(CHUNKS_PER_AXIS).toBe(MAP_SIZE / CHUNK_SIZE);
    expect(CHUNK_LOAD_BUDGET).toBeGreaterThan(0);
  });
});
