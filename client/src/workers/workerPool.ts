/**
 * Worker pool manager for parallel terrain mesh generation.
 *
 * Maintains a fixed pool of Web Workers (default 4, configurable for
 * quality presets) and dispatches mesh-generation tasks using
 * least-loaded scheduling with an overflow task queue.
 *
 * Each request gets a unique ID; responses are matched back to the
 * originating Promise via a pending-request map.
 *
 * Data transfer uses Transferable ArrayBuffers for zero-copy ownership
 * handoff in both directions:
 *   Main -> Worker: chunk heights, biomes, flags, provinces
 *   Worker -> Main: positions, normals, colors, indices
 *
 * Usage:
 *   const pool = new WorkerPool();
 *   const mesh = await pool.requestMesh(chunkData, lod);
 *   pool.dispose();
 */

import { WORKER_COUNT, WORKER_TASK_TIMEOUT_MS } from '../config';
import { createLogger } from '../core/logger';
import type {
  ChunkData,
  ChunkMeshData,
  LODLevel,
  WorkerRequest,
  WorkerResponse,
} from '../types';

const log = createLogger('WorkerPool');

// ── Internal types ───────────────────────────────────────────────

interface PendingTask {
  resolve: (data: ChunkMeshData) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface QueuedTask {
  chunk: ChunkData;
  lod: LODLevel;
  resolve: (data: ChunkMeshData) => void;
  reject: (error: Error) => void;
}

interface WorkerEntry {
  worker: Worker;
  pendingCount: number;
}

// ── WorkerPool ───────────────────────────────────────────────────

export class WorkerPool {
  private workers: WorkerEntry[] = [];
  private readonly pending = new Map<number, PendingTask>();
  private readonly queue: QueuedTask[] = [];
  private nextId = 1;
  private disposed = false;
  private targetPoolSize: number;

  constructor(poolSize: number = WORKER_COUNT) {
    this.targetPoolSize = poolSize;
    for (let i = 0; i < poolSize; i++) {
      this.workers.push(this.createWorkerEntry());
    }
    log.info(`Initialised with ${poolSize} workers`);
  }

  // ── Public API ───────────────────────────────────────────────

  /** Current number of active workers. */
  get workerCount(): number {
    return this.workers.length;
  }

  /** Number of tasks waiting in the queue. */
  get queueLength(): number {
    return this.queue.length;
  }

  /** Number of tasks currently in-flight on workers. */
  get pendingTaskCount(): number {
    return this.pending.size;
  }

  /**
   * Submit a mesh-generation request.
   * Resolves with the chunk mesh data once the worker finishes.
   * Rejects on worker error or timeout.
   *
   * The chunk data's Uint8Array buffers are copied (structured clone)
   * to the worker. For the return path, the worker transfers ownership
   * of the result ArrayBuffers back (zero-copy).
   */
  requestMesh(chunk: ChunkData, lod: LODLevel): Promise<ChunkMeshData> {
    if (this.disposed) {
      return Promise.reject(
        new Error('WorkerPool has been disposed'),
      );
    }

    return new Promise<ChunkMeshData>((resolve, reject) => {
      const leastBusy = this.pickWorker();

      // If every worker already has at least one task, queue instead of
      // piling up on a worker -- keeps latency predictable.
      if (leastBusy.pendingCount > 0) {
        this.queue.push({ chunk, lod, resolve, reject });
        return;
      }

      this.dispatch(leastBusy, chunk, lod, resolve, reject);
    });
  }

  /**
   * Resize the worker pool. Workers are added or removed as needed.
   * Useful for quality preset changes (e.g. toaster profile uses 2).
   *
   * Excess workers are terminated only once they become idle (no
   * pending tasks), so in-flight work is not lost.
   */
  setPoolSize(size: number): void {
    if (this.disposed) return;
    if (size < 1) {
      log.warn(`setPoolSize(${size}) clamped to 1`);
      size = 1;
    }

    this.targetPoolSize = size;

    // Add workers if we need more
    while (this.workers.length < size) {
      this.workers.push(this.createWorkerEntry());
    }

    // Remove idle excess workers
    this.trimExcessWorkers();

    log.info(`Pool resized to target=${size}, active=${this.workers.length}`);
  }

  /** Terminate all workers and reject any pending / queued tasks. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Reject everything in the queue.
    for (const queued of this.queue) {
      queued.reject(new Error('WorkerPool disposed'));
    }
    this.queue.length = 0;

    // Reject all pending tasks and clear their timers.
    for (const [, task] of this.pending) {
      clearTimeout(task.timer);
      task.reject(new Error('WorkerPool disposed'));
    }
    this.pending.clear();

    // Terminate workers.
    for (const entry of this.workers) {
      entry.worker.terminate();
      entry.pendingCount = 0;
    }
    this.workers.length = 0;

    log.info('Disposed');
  }

  // ── Internals ────────────────────────────────────────────────

  /**
   * Create a new Worker wrapped in a WorkerEntry with event listeners.
   */
  private createWorkerEntry(): WorkerEntry {
    const worker = new Worker(
      new URL('./meshWorker.ts', import.meta.url),
      { type: 'module' },
    );

    const entry: WorkerEntry = { worker, pendingCount: 0 };

    worker.addEventListener('message', (ev: MessageEvent<WorkerResponse>) => {
      this.handleResponse(entry, ev.data);
    });
    worker.addEventListener('error', (ev: ErrorEvent) => {
      this.handleWorkerError(entry, ev);
    });

    return entry;
  }

  /**
   * Pick the worker with the fewest outstanding tasks.
   * In case of a tie the first (lowest index) worker wins,
   * which provides a deterministic round-robin bias.
   */
  private pickWorker(): WorkerEntry {
    let best = this.workers[0]!;
    for (let i = 1; i < this.workers.length; i++) {
      const w = this.workers[i]!;
      if (w.pendingCount < best.pendingCount) {
        best = w;
      }
    }
    return best;
  }

  /**
   * Send a GENERATE_MESH message to a specific worker and
   * register the pending resolve/reject + timeout.
   *
   * The chunk's Uint8Array buffers are sent via structured clone
   * (not transferred) because the caller may still need them
   * (e.g. for LOD rebuilds). The overhead is small (4 KB per chunk).
   * The worker transfers the result buffers back (zero-copy).
   */
  private dispatch(
    entry: WorkerEntry,
    chunk: ChunkData,
    lod: LODLevel,
    resolve: (data: ChunkMeshData) => void,
    reject: (error: Error) => void,
  ): void {
    const id = this.nextId++;
    entry.pendingCount++;

    const timer = setTimeout(() => {
      const task = this.pending.get(id);
      if (task) {
        this.pending.delete(id);
        entry.pendingCount = Math.max(0, entry.pendingCount - 1);
        task.reject(
          new Error(
            `Mesh generation timed out after ${WORKER_TASK_TIMEOUT_MS}ms ` +
            `for chunk (${chunk.cx},${chunk.cy}) LOD${lod}`,
          ),
        );
        this.drainQueue();
      }
    }, WORKER_TASK_TIMEOUT_MS);

    this.pending.set(id, { resolve, reject, timer });

    const request: WorkerRequest = {
      id,
      type: 'GENERATE_MESH',
      chunkData: chunk,
      lod,
    };

    // Structured clone of the request. We intentionally do NOT transfer
    // the chunk ArrayBuffers because the caller retains ownership for
    // potential LOD rebuilds. The 4 KB copy cost is negligible vs the
    // mesh generation work.
    entry.worker.postMessage(request);
  }

  /**
   * Handle a response from any worker.
   */
  private handleResponse(entry: WorkerEntry, response: WorkerResponse): void {
    const task = this.pending.get(response.id);
    if (!task) {
      // Already timed out or pool disposed -- ignore.
      return;
    }

    this.pending.delete(response.id);
    clearTimeout(task.timer);
    entry.pendingCount = Math.max(0, entry.pendingCount - 1);

    if (response.type === 'MESH_READY' && response.meshData) {
      task.resolve(response.meshData);
    } else {
      task.reject(
        new Error(response.error ?? 'Unknown worker error'),
      );
    }

    // After resolving, try to trim if we have excess workers
    this.trimExcessWorkers();
    this.drainQueue();
  }

  /**
   * Handle an unrecoverable worker error (e.g. syntax error in the
   * worker script, out-of-memory). Replaces the dead worker with a
   * fresh one and drains the queue.
   */
  private handleWorkerError(entry: WorkerEntry, ev: ErrorEvent): void {
    const errorMsg = ev.message ?? 'Worker error';
    log.error(`Worker crashed: ${errorMsg}`);

    // Terminate the broken worker
    entry.worker.terminate();

    // Find its index in the array
    const idx = this.workers.indexOf(entry);
    if (idx === -1) return;

    // Replace with a fresh worker if we still need this many
    if (this.workers.length <= this.targetPoolSize) {
      const replacement = this.createWorkerEntry();
      this.workers[idx] = replacement;
      log.info('Replaced crashed worker with fresh instance');
    } else {
      // We have excess workers; just remove the dead one
      this.workers.splice(idx, 1);
    }

    // In-flight tasks for this worker will be rejected by their timeouts.
    // Drain the queue with available workers.
    this.drainQueue();
  }

  /**
   * If there are queued tasks and a free worker, dispatch them.
   */
  private drainQueue(): void {
    while (this.queue.length > 0) {
      const worker = this.pickWorker();
      if (worker.pendingCount > 0) {
        // No idle workers -- wait for a response to free one up.
        break;
      }

      const queued = this.queue.shift()!;
      this.dispatch(worker, queued.chunk, queued.lod, queued.resolve, queued.reject);
    }
  }

  /**
   * Remove idle excess workers when pool has been downsized.
   * Only terminates workers with pendingCount === 0 to avoid
   * losing in-flight work.
   */
  private trimExcessWorkers(): void {
    while (this.workers.length > this.targetPoolSize) {
      // Find an idle worker to remove (search from the end)
      let removed = false;
      for (let i = this.workers.length - 1; i >= 0; i--) {
        const w = this.workers[i]!;
        if (w.pendingCount === 0) {
          w.worker.terminate();
          this.workers.splice(i, 1);
          removed = true;
          break;
        }
      }
      if (!removed) {
        // All excess workers are busy; they will be trimmed
        // when they finish their current task.
        break;
      }
    }
  }
}
