import { afterEach, describe, expect, it, vi } from 'vitest';

import { getStartupChecks, summarizeStartupChecks } from '../startup';

describe('startup checks', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalRequestAnimationFrame = window.requestAnimationFrame;

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    window.requestAnimationFrame = originalRequestAnimationFrame;
  });

  it('passes with valid environment', () => {
    const report = getStartupChecks();
    expect(report.ok).toBe(true);
    const requiredChecks = report.checks.filter((check) => check.required !== false);
    expect(requiredChecks.every((check) => check.passed)).toBe(true);
    expect(summarizeStartupChecks(report)).toContain('Startup checks:');
  });

  it('fails when WebGL context is unavailable', () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as typeof HTMLCanvasElement.prototype.getContext;

    const report = getStartupChecks();

    const renderingCheck = report.checks.find((check) => check.name === 'rendering-context');
    expect(renderingCheck?.passed).toBe(false);
    expect(renderingCheck?.message).toBe('WebGL context unavailable');
    expect(report.ok).toBe(false);
    expect(summarizeStartupChecks(report)).toContain('rendering-context');
  });

  it('fails when requestAnimationFrame is unavailable', () => {
    // @ts-expect-error intentionally removing function
    window.requestAnimationFrame = undefined;

    const report = getStartupChecks();
    const browserCheck = report.checks.find((check) => check.name === 'browser-capabilities');

    expect(browserCheck?.passed).toBe(false);
    expect(browserCheck?.message).toBe('requestAnimationFrame is missing');
    expect(report.ok).toBe(false);
  });

  it('does not fail startup when optional Supabase check fails', () => {
    const report = getStartupChecks();

    const supabaseCheck = report.checks.find((check) => check.name === 'supabase-config');
    expect(supabaseCheck).toBeDefined();
    expect(supabaseCheck?.required).toBe(false);
  });
});
