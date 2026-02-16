import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/eventBus';

type TestEvents = {
  greet: string;
  count: number;
  complex: { x: number; y: number };
};

describe('EventBus', () => {
  it('calls listener on emit', () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on('greet', fn);
    bus.emit('greet', 'hello');
    expect(fn).toHaveBeenCalledWith('hello');
  });

  it('supports multiple listeners', () => {
    const bus = new EventBus<TestEvents>();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    bus.on('count', fn1);
    bus.on('count', fn2);
    bus.emit('count', 42);
    expect(fn1).toHaveBeenCalledWith(42);
    expect(fn2).toHaveBeenCalledWith(42);
  });

  it('unsubscribes via returned function', () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    const unsub = bus.on('greet', fn);
    unsub();
    bus.emit('greet', 'hello');
    expect(fn).not.toHaveBeenCalled();
  });

  it('once fires only once', () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.once('count', fn);
    bus.emit('count', 1);
    bus.emit('count', 2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it('off removes all listeners for event', () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on('greet', fn);
    bus.off('greet');
    bus.emit('greet', 'hello');
    expect(fn).not.toHaveBeenCalled();
  });

  it('clear removes all listeners', () => {
    const bus = new EventBus<TestEvents>();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    bus.on('greet', fn1);
    bus.on('count', fn2);
    bus.clear();
    bus.emit('greet', 'hello');
    bus.emit('count', 1);
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).not.toHaveBeenCalled();
  });

  it('handles complex payloads', () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on('complex', fn);
    bus.emit('complex', { x: 10, y: 20 });
    expect(fn).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it('emitting with no listeners is safe', () => {
    const bus = new EventBus<TestEvents>();
    expect(() => bus.emit('greet', 'hello')).not.toThrow();
  });
});
