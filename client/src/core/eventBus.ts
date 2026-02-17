/**
 * Typed event bus for game events.
 * Zero-dependency pub/sub with type safety.
 */

type Listener<T> = (payload: T) => void;

export class EventBus<EventMap extends { [K in keyof EventMap]: unknown }> {
  private listeners = new Map<keyof EventMap, Set<Listener<never>>>();

  on<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);

    // Return unsubscribe function
    return () => {
      set!.delete(listener as Listener<never>);
      if (set!.size === 0) this.listeners.delete(event);
    };
  }

  once<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): () => void {
    const unsub = this.on(event, (payload) => {
      unsub();
      listener(payload);
    });
    return unsub;
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      (listener as Listener<EventMap[K]>)(payload);
    }
  }

  off<K extends keyof EventMap>(event: K): void {
    this.listeners.delete(event);
  }

  clear(): void {
    this.listeners.clear();
  }
}

// ── Game Event Map ──────────────────────────────────────────────

import type { ChunkCoord, CityData, AgentData, LODLevel, ViewportRect } from '../types';

export interface GameEventMap {
  chunk_loaded: ChunkCoord;
  chunk_unloaded: ChunkCoord;
  city_selected: CityData | null;
  agent_selected: AgentData | null;
  province_selected: { id: number; name: string } | null;
  camera_moved: { x: number; y: number; z: number };
  viewport_changed: ViewportRect;
  lod_changed: { cx: number; cy: number; lod: LODLevel };
  toggle_overlay: void;
  close_panel: void;
}

/** Singleton game event bus. */
export const gameEvents = new EventBus<GameEventMap>();
