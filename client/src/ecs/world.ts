/**
 * ECS world singleton.
 *
 * A single bitECS world holds all component stores and entity metadata.
 * Created once at client startup, before the render loop begins.
 */

import { createWorld } from 'bitecs';

/**
 * Maximum entity count across all archetypes. See ECS.md Section 2 for sizing rationale.
 * Enforced by component TypedArray sizes in components.ts (all pre-allocated to N=20,000).
 * The bitECS world itself uses a dynamically-sized entity index.
 */
export const MAX_ENTITIES = 20_000;

/**
 * The singleton ECS world.
 *
 * All systems, archetypes, and entity operations use this world instance.
 * Components are pre-allocated TypedArrays sized to MAX_ENTITIES.
 */
export const world = createWorld();
