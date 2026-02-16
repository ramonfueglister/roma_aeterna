import { describe, it, expect } from 'vitest';
import { Pool } from '../core/pool';

describe('Pool', () => {
  function makePool(initial = 0) {
    return new Pool<{ value: number }>(
      () => ({ value: 0 }),
      (item) => { item.value = 0; },
      initial,
    );
  }

  it('creates items on acquire when empty', () => {
    const pool = makePool();
    const item = pool.acquire();
    expect(item).toEqual({ value: 0 });
    expect(pool.activeCount).toBe(1);
    expect(pool.availableCount).toBe(0);
  });

  it('reuses items after release', () => {
    const pool = makePool();
    const item = pool.acquire();
    item.value = 42;
    pool.release(item);
    expect(pool.activeCount).toBe(0);
    expect(pool.availableCount).toBe(1);

    const reused = pool.acquire();
    expect(reused.value).toBe(0); // reset was called
    expect(reused).toBe(item); // same reference
  });

  it('pre-warms with initial size', () => {
    const pool = makePool(10);
    expect(pool.availableCount).toBe(10);
    expect(pool.activeCount).toBe(0);
    expect(pool.totalCount).toBe(10);
  });

  it('releaseAll returns all active items', () => {
    const pool = makePool();
    pool.acquire();
    pool.acquire();
    pool.acquire();
    expect(pool.activeCount).toBe(3);
    pool.releaseAll();
    expect(pool.activeCount).toBe(0);
    expect(pool.availableCount).toBe(3);
  });

  it('warmUp increases pool to target', () => {
    const pool = makePool(5);
    pool.warmUp(20);
    expect(pool.totalCount).toBe(20);
  });

  it('shrink reduces available pool', () => {
    const pool = makePool(20);
    pool.shrink(5);
    expect(pool.availableCount).toBe(5);
  });

  it('release ignores unknown items', () => {
    const pool = makePool();
    const unknown = { value: 99 };
    pool.release(unknown); // should not throw
    expect(pool.availableCount).toBe(0);
  });

  it('dispose clears everything', () => {
    const pool = makePool(10);
    pool.acquire();
    pool.dispose();
    expect(pool.activeCount).toBe(0);
    expect(pool.availableCount).toBe(0);
  });
});
