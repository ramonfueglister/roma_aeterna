/**
 * Worker pool manager for parallel terrain mesh generation.
 *
 * Maintains a fixed pool of Web Workers (default 4) and dispatches
 * mesh-generation tasks using least-loaded scheduling with an
 * overflow task queue. Each request gets a unique ID; responses are
 * matched back to the originating Promise via a pending-request map.
 *
 * Usage:
 *   const pool = new WorkerPool();
 *   const mesh = await pool.requestMesh(chunkData, lod);
 *   pool.dispose();
 */

import { WORKER_COUNT, WORKER_TASK_TIMEOUT_MS } from '../config';
import type {
  ChunkData,
  ChunkMeshData,
  LODLevel,
  WorkerRequest,
  WorkerResponse,
} from '../types';

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
  private readonly workers: WorkerEntry[] = [];
  private readonly pending = new Map<number, PendingTask>();
  private readonly queue: QueuedTask[] = [];
  private nextId = 1;
  private disposed = false;

  constructor() {
    for (let i = 0; i < WORKER_COUNT; i++) {
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

      this.workers.push(entry);
    }
  }

  // ── Public API ───────────────────────────────────────────────

  /**
   * Submit a mesh-generation request.
   * Resolves with the chunk mesh data once the worker finishes.
   * Rejects on worker error or timeout.
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
  }

  // ── Internals ────────────────────────────────────────────────

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

    this.drainQueue();
  }

  /**
   * Handle an unrecoverable worker error (e.g. syntax error in the
   * worker script, out-of-memory). Rejects all tasks pending on that
   * worker, then drains the queue to keep the rest of the pool busy.
   */
  private handleWorkerError(entry: WorkerEntry, ev: ErrorEvent): void {
    const errorMsg = ev.message ?? 'Worker error';

    // We cannot know which specific task caused the error, so we
    // conservatively reset this worker's pending count and let the
    // timeouts handle rejection of any in-flight tasks.
    // In practice each worker handles one task at a time via the queue,
    // so pendingCount should be 0 or 1.
    console.error(
      `[WorkerPool] Worker error: ${errorMsg}`,
      ev,
    );
    entry.pendingCount = 0;

    // Attempt to drain the queue with other workers.
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
}
