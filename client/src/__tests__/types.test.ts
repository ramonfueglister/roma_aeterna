import { describe, expect, it } from 'vitest';

import { makeChunkKey, parseChunkKey } from '../types';

describe('chunk key helpers', () => {
  it('creates deterministic chunk keys', () => {
    expect(makeChunkKey(3, 4)).toBe('3,4');
    expect(makeChunkKey(-1, 12)).toBe('-1,12');
  });

  it('parses chunk keys back to coordinates', () => {
    expect(parseChunkKey('10,27')).toEqual({ cx: 10, cy: 27 });
    expect(parseChunkKey('-5,8')).toEqual({ cx: -5, cy: 8 });
  });
});

