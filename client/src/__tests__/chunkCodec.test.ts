import { describe, it, expect } from 'vitest';
import { encodeChunk, decodeChunk, validateChunk } from '../world/chunkCodec';
import type { ChunkData } from '../types';

function makeChunk(cx = 0, cy = 0): ChunkData {
  const heights = new Uint8Array(1024);
  const biomes = new Uint8Array(1024);
  const flags = new Uint8Array(1024);
  const provinces = new Uint8Array(1024);

  // Fill with test data
  for (let i = 0; i < 1024; i++) {
    heights[i] = i % 128; // 0-127
    biomes[i] = i % 20;
    flags[i] = i % 8;
    provinces[i] = i % 42;
  }

  return { cx, cy, heights, biomes, flags, provinces };
}

describe('encodeChunk / decodeChunk', () => {
  it('roundtrips correctly', () => {
    const original = makeChunk(10, 20);
    const buffer = encodeChunk(original);
    const decoded = decodeChunk(buffer);

    expect(decoded.cx).toBe(10);
    expect(decoded.cy).toBe(20);
    expect(decoded.heights).toEqual(original.heights);
    expect(decoded.biomes).toEqual(original.biomes);
    expect(decoded.flags).toEqual(original.flags);
    expect(decoded.provinces).toEqual(original.provinces);
  });

  it('produces correct buffer size', () => {
    const chunk = makeChunk();
    const buffer = encodeChunk(chunk);
    expect(buffer.byteLength).toBe(4104);
  });

  it('writes correct magic bytes', () => {
    const chunk = makeChunk();
    const buffer = encodeChunk(chunk);
    const view = new DataView(buffer);
    expect(view.getUint16(0, true)).toBe(0x494d); // 'IM'
  });

  it('writes correct version', () => {
    const chunk = makeChunk();
    const buffer = encodeChunk(chunk);
    const view = new DataView(buffer);
    expect(view.getUint8(2)).toBe(1);
  });

  it('handles edge chunk coordinates', () => {
    const chunk = makeChunk(63, 63);
    const buffer = encodeChunk(chunk);
    const decoded = decodeChunk(buffer);
    expect(decoded.cx).toBe(63);
    expect(decoded.cy).toBe(63);
  });

  it('throws on wrong buffer size', () => {
    const buffer = new ArrayBuffer(100);
    expect(() => decodeChunk(buffer)).toThrow('Invalid chunk size');
  });

  it('throws on wrong magic', () => {
    const buffer = new ArrayBuffer(4104);
    const view = new DataView(buffer);
    view.setUint16(0, 0xDEAD, true);
    expect(() => decodeChunk(buffer)).toThrow('Invalid chunk magic');
  });
});

describe('validateChunk', () => {
  it('passes valid chunk', () => {
    const chunk = makeChunk();
    const errors = validateChunk(chunk);
    expect(errors).toEqual([]);
  });

  it('detects wrong heights array size', () => {
    const chunk = makeChunk();
    chunk.heights = new Uint8Array(512);
    const errors = validateChunk(chunk);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('Heights');
  });

  it('detects out-of-range height values', () => {
    const chunk = makeChunk();
    chunk.heights[0] = 200; // > 127
    const errors = validateChunk(chunk);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('Height at index 0');
  });
});
