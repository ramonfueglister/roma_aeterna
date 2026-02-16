import { describe, it, expect } from 'vitest';
import { err, isOk, ok, Result, unwrap } from '../types';

describe('Result helpers', () => {
  it('creates successful results with ok()', () => {
    const result = ok<number, Error>(42);
    if (!isOk(result)) {
      throw new Error('expected ok result');
    }
    expect(result.ok).toBe(true);
    expect(result.value).toBe(42);
  });

  it('creates failure results with err()', () => {
    const cause = new Error('boom');
    const result = err<number, Error>(cause);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected error result');
    }
    expect(result.error).toBe(cause);
  });

  it('unwraps successful results', () => {
    expect(unwrap(ok('value'))).toBe('value');
  });

  it('throws on errors in unwrap', () => {
    expect(() => unwrap(err('boom'))).toThrow('boom');
  });

  it('guards correctly with isOk', () => {
    const values: Array<Result<number, string>> = [ok(7), err('bad')];
    const oks = values.filter(isOk);
    expect(oks).toHaveLength(1);
    expect(oks[0]).toMatchObject({ ok: true, value: 7 });
  });
});
