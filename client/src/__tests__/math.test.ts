import { describe, it, expect } from 'vitest';
import {
  clamp, lerp, smoothstep,
  worldToChunk, chunkToWorld, tileToChunkLocal, tileToIndex, indexToTile, tileToWorld,
  chunkKey, chunkManhattan, distance, distanceSq,
  isInBounds, isChunkInBounds, spiralOrder,
} from '../core/math';

describe('clamp', () => {
  it('returns value when in range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it('returns min when below', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });
  it('returns max when above', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
  it('handles equal min and max', () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });
});

describe('lerp', () => {
  it('returns a at t=0', () => {
    expect(lerp(10, 20, 0)).toBe(10);
  });
  it('returns b at t=1', () => {
    expect(lerp(10, 20, 1)).toBe(20);
  });
  it('returns midpoint at t=0.5', () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
  });
});

describe('smoothstep', () => {
  it('returns 0 at edge0', () => {
    expect(smoothstep(0, 1, 0)).toBe(0);
  });
  it('returns 1 at edge1', () => {
    expect(smoothstep(0, 1, 1)).toBe(1);
  });
  it('returns 0.5 at midpoint', () => {
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
  });
  it('clamps below edge0', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
  });
  it('clamps above edge1', () => {
    expect(smoothstep(0, 1, 2)).toBe(1);
  });
});

describe('worldToChunk', () => {
  it('converts origin', () => {
    expect(worldToChunk(0, 0)).toEqual({ cx: 0, cy: 0 });
  });
  it('converts within first chunk', () => {
    expect(worldToChunk(15, 20)).toEqual({ cx: 0, cy: 0 });
  });
  it('converts to second chunk', () => {
    expect(worldToChunk(32, 0)).toEqual({ cx: 1, cy: 0 });
  });
  it('converts last tile', () => {
    expect(worldToChunk(2047, 2047)).toEqual({ cx: 63, cy: 63 });
  });
  it('clamps negative coordinates', () => {
    expect(worldToChunk(-10, -10)).toEqual({ cx: 0, cy: 0 });
  });
});

describe('chunkToWorld', () => {
  it('converts origin chunk', () => {
    expect(chunkToWorld(0, 0)).toEqual({ tileX: 0, tileY: 0 });
  });
  it('converts chunk 1,1', () => {
    expect(chunkToWorld(1, 1)).toEqual({ tileX: 32, tileY: 32 });
  });
  it('converts last chunk', () => {
    expect(chunkToWorld(63, 63)).toEqual({ tileX: 2016, tileY: 2016 });
  });
});

describe('tileToChunkLocal', () => {
  it('returns local coordinates inside chunk', () => {
    expect(tileToChunkLocal(0, 0)).toEqual({ x: 0, y: 0 });
    expect(tileToChunkLocal(32, 47)).toEqual({ x: 0, y: 15 });
  });

  it('clamps negative world coordinates', () => {
    expect(tileToChunkLocal(-10, -10)).toEqual({ x: 0, y: 0 });
  });

  it('clamps upper-bound world coordinates', () => {
    expect(tileToChunkLocal(2047, 2047)).toEqual({ x: 31, y: 31 });
  });
});

describe('tileToWorld', () => {
  it('converts local tile coordinates to world tile coordinates', () => {
    expect(tileToWorld(1, 2, 3, 4)).toEqual({ tileX: 35, tileY: 68 });
    expect(tileToWorld(0, 0, 0, 0)).toEqual({ tileX: 0, tileY: 0 });
  });
});

describe('tileToIndex / indexToTile', () => {
  it('converts origin', () => {
    expect(tileToIndex(0, 0)).toBe(0);
  });
  it('converts end of first row', () => {
    expect(tileToIndex(31, 0)).toBe(31);
  });
  it('converts start of second row', () => {
    expect(tileToIndex(0, 1)).toBe(32);
  });
  it('roundtrips correctly', () => {
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const idx = tileToIndex(x, y);
        const result = indexToTile(idx);
        expect(result).toEqual({ x, y });
      }
    }
  });
});

describe('chunkKey', () => {
  it('generates unique keys', () => {
    expect(chunkKey(0, 0)).toBe('0,0');
    expect(chunkKey(1, 2)).toBe('1,2');
    expect(chunkKey(63, 63)).toBe('63,63');
  });
});

describe('distance functions', () => {
  it('chunkManhattan', () => {
    expect(chunkManhattan(0, 0, 3, 4)).toBe(7);
    expect(chunkManhattan(5, 5, 5, 5)).toBe(0);
  });
  it('distance', () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
    expect(distance(0, 0, 0, 0)).toBe(0);
  });
  it('distanceSq', () => {
    expect(distanceSq(0, 0, 3, 4)).toBe(25);
  });
});

describe('bounds checking', () => {
  it('isInBounds valid', () => {
    expect(isInBounds(0, 0)).toBe(true);
    expect(isInBounds(1024, 1024)).toBe(true);
    expect(isInBounds(2047, 2047)).toBe(true);
  });
  it('isInBounds invalid', () => {
    expect(isInBounds(-1, 0)).toBe(false);
    expect(isInBounds(0, 2048)).toBe(false);
    expect(isInBounds(2048, 0)).toBe(false);
  });
  it('isChunkInBounds valid', () => {
    expect(isChunkInBounds(0, 0)).toBe(true);
    expect(isChunkInBounds(63, 63)).toBe(true);
  });
  it('isChunkInBounds invalid', () => {
    expect(isChunkInBounds(-1, 0)).toBe(false);
    expect(isChunkInBounds(64, 0)).toBe(false);
  });
});

describe('spiralOrder', () => {
  it('returns center for radius 0', () => {
    const order = spiralOrder(0);
    expect(order).toEqual([[0, 0]]);
  });
  it('returns 9 elements for radius 1', () => {
    const order = spiralOrder(1);
    expect(order.length).toBe(9); // 1 center + 8 surrounding
    expect(order[0]).toEqual([0, 0]);
  });
  it('returns 25 elements for radius 2', () => {
    const order = spiralOrder(2);
    expect(order.length).toBe(25);
  });
  it('starts from center', () => {
    const order = spiralOrder(3);
    expect(order[0]).toEqual([0, 0]);
  });
});
