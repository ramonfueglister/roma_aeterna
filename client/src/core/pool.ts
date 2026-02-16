/**
 * Generic object pool for zero-allocation game loops.
 * Pre-allocates instances and recycles them via acquire/release.
 */

export class Pool<T> {
  private available: T[] = [];
  private active = new Set<T>();
  private readonly factory: () => T;
  private readonly reset: (item: T) => void;

  constructor(
    factory: () => T,
    reset: (item: T) => void,
    initialSize: number = 0,
  ) {
    this.factory = factory;
    this.reset = reset;
    for (let i = 0; i < initialSize; i++) {
      this.available.push(factory());
    }
  }

  /** Get an item from the pool (creates new if empty). */
  acquire(): T {
    const item = this.available.pop() ?? this.factory();
    this.active.add(item);
    return item;
  }

  /** Return an item to the pool. */
  release(item: T): void {
    if (!this.active.has(item)) return;
    this.active.delete(item);
    this.reset(item);
    this.available.push(item);
  }

  /** Release all active items back to the pool. */
  releaseAll(): void {
    for (const item of this.active) {
      this.reset(item);
      this.available.push(item);
    }
    this.active.clear();
  }

  /** Number of items currently in use. */
  get activeCount(): number {
    return this.active.size;
  }

  /** Number of items available for reuse. */
  get availableCount(): number {
    return this.available.length;
  }

  /** Total items managed by this pool. */
  get totalCount(): number {
    return this.active.size + this.available.length;
  }

  /** Pre-warm the pool to a target size. */
  warmUp(targetTotal: number): void {
    while (this.totalCount < targetTotal) {
      this.available.push(this.factory());
    }
  }

  /** Shrink available pool to a maximum size (free excess memory). */
  shrink(maxAvailable: number): void {
    while (this.available.length > maxAvailable) {
      this.available.pop();
    }
  }

  /** Dispose all items and clear the pool. */
  dispose(): void {
    this.available.length = 0;
    this.active.clear();
  }
}
