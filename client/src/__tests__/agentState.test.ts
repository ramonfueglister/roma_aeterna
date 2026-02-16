import { describe, expect, it } from 'vitest';
import { AgentState } from '../types';

describe('AgentState', () => {
  it('includes loading state', () => {
    const state = AgentState.LOADING;
    expect(state).toBe('loading');
  });
});
