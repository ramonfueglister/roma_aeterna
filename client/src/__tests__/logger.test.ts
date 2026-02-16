import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type LogLevel, createLogger, setLogLevel } from '../core/logger';

describe('Logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setLogLevel('info');
  });

  it('filters logs below the global level', () => {
    const logger = createLogger('test');
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    setLogLevel('warn' as LogLevel);
    logger.debug('nope');
    logger.warn('yeah');

    expect(debug).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[test]', 'yeah');
  });

  it('attaches category prefix to all outputs', () => {
    const logger = createLogger('cat');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logger.info('payload');

    expect(info).toHaveBeenCalledWith('[cat]', 'payload');
  });

  it('respects level changes at runtime', () => {
    const logger = createLogger('rt');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    setLogLevel('error');
    logger.info('hidden');
    logger.error('visible');

    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('[rt]', 'visible');
  });
});
