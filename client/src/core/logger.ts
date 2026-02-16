/**
 * Structured logger with categories and levels.
 * Filtered by LOG_LEVEL env var or runtime config.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let globalLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

export function createLogger(category: string) {
  const prefix = `[${category}]`;

  function shouldLog(level: LogLevel): boolean {
    return LOG_PRIORITY[level] >= LOG_PRIORITY[globalLevel];
  }

  return {
    debug(...args: unknown[]): void {
      if (shouldLog('debug')) console.debug(prefix, ...args);
    },
    info(...args: unknown[]): void {
      if (shouldLog('info')) console.info(prefix, ...args);
    },
    warn(...args: unknown[]): void {
      if (shouldLog('warn')) console.warn(prefix, ...args);
    },
    error(...args: unknown[]): void {
      if (shouldLog('error')) console.error(prefix, ...args);
    },
  };
}
