import { hasSupabaseConfig } from './supabase';

export interface StartupCheck {
  name: string;
  passed: boolean;
  message: string;
  required?: boolean;
}

export interface StartupReport {
  checks: StartupCheck[];
  ok: boolean;
}

function checkBrowserCapabilities(): StartupCheck {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      name: 'browser-capabilities',
      passed: false,
      message: 'Browser APIs are not available (document/window missing)',
      required: true,
    };
  }

  const requestAnimationFrameAvailable = typeof window.requestAnimationFrame === 'function';
  if (!requestAnimationFrameAvailable) {
    return {
      name: 'browser-capabilities',
      passed: false,
      message: 'requestAnimationFrame is missing',
      required: true,
    };
  }

  return { name: 'browser-capabilities', passed: true, message: 'Browser capabilities are present', required: true };
}

function checkRenderingContext(): StartupCheck {
  if (typeof document === 'undefined') {
    return {
      name: 'rendering-context',
      passed: false,
      message: 'Document API is not available',
      required: true,
    };
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2') || canvas.getContext('webgl');

  return {
    name: 'rendering-context',
    passed: Boolean(context),
    message: context ? 'WebGL context available' : 'WebGL context unavailable',
    required: true,
  };
}

function checkViewport(): StartupCheck {
  if (typeof window === 'undefined') {
    return {
      name: 'viewport-size',
      passed: false,
      message: 'Window object is not available',
      required: true,
    };
  }

  const validViewport =
    Number.isFinite(window.innerWidth) &&
    Number.isFinite(window.innerHeight) &&
    window.innerWidth > 0 &&
    window.innerHeight > 0;

  return {
    name: 'viewport-size',
    passed: validViewport,
    message: validViewport ? 'Viewport dimensions are valid' : 'Invalid viewport dimensions',
    required: true,
  };
}

function checkSupabase(): StartupCheck {
  return {
    name: 'supabase-config',
    passed: hasSupabaseConfig,
    message: hasSupabaseConfig
      ? 'Supabase configuration is present'
      : 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY',
    required: false,
  };
}

export function getStartupChecks(): StartupReport {
  const checks: StartupCheck[] = [
    checkBrowserCapabilities(),
    checkRenderingContext(),
    checkViewport(),
    checkSupabase(),
  ];

  return {
    checks,
    ok: checks.every((check) => (check.required === false ? true : check.passed)),
  };
}

export function summarizeStartupChecks(report: StartupReport): string {
  if (report.ok) {
    return 'Startup checks: all passed';
  }

  const failures = report.checks.filter((c) => !c.passed).map((c) => c.name).join(', ');
  return `Startup checks: failed (${failures})`;
}
