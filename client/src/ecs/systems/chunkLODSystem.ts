/**
 * System #4: ChunkLODSystem
 *
 * Computes the target LOD level and blend alpha for each chunk entity
 * based on Chebyshev distance from the camera chunk position.
 *
 * LOD thresholds (matching ChunkLoader.getLOD):
 *   dist <= 2  → LOD 0 (full detail)
 *   dist <= 5  → LOD 1
 *   dist <= 9  → LOD 2
 *   dist >= 10 → LOD 3 (lowest detail)
 *
 * Blend alpha is computed per-chunk based on distance to the nearest
 * LOD boundary, creating smooth transitions in the overlap zone.
 *
 * This system writes LODLevel.target and LODLevel.blendAlpha.
 * ChunkLoader reads LODLevel.target changes to trigger LOD swaps,
 * and uses blendAlpha for per-instance alpha via BatchedMesh.setColorAt.
 *
 * Frequency: every frame
 */

import type { World } from 'bitecs';
import { query } from 'bitecs';
import { IsChunk, ChunkCoord, LODLevel } from '../components';
import { getCameraChunkX, getCameraChunkY } from './viewportSystem';
import { LOD_TRANSITION_RANGE, CHUNK_SIZE } from '../../config';

/** LOD boundary distances in chunk units (must match ChunkLoader.getLOD). */
const LOD_BOUNDARIES = [2, 5, 9] as const;

/** Transition half-range in chunk units. */
const LOD_BLEND_CHUNKS = LOD_TRANSITION_RANGE / CHUNK_SIZE;

function getLOD(dist: number): number {
  if (dist <= 2) return 0;
  if (dist <= 5) return 1;
  if (dist <= 9) return 2;
  return 3;
}

export function chunkLODSystem(world: World, _delta: number): void {
  const camCx = getCameraChunkX();
  const camCy = getCameraChunkY();

  const eids = query(world, [IsChunk, ChunkCoord, LODLevel]);

  for (let i = 0; i < eids.length; i++) {
    const eid = eids[i]!;

    const cx = ChunkCoord.cx[eid]!;
    const cy = ChunkCoord.cy[eid]!;

    // Chebyshev distance
    const dist = Math.max(Math.abs(cx - camCx), Math.abs(cy - camCy));

    // Target LOD
    const target = getLOD(dist);
    LODLevel.target[eid] = target;

    // Blend alpha: fade at LOD boundaries
    let alpha = 1.0;
    for (let b = 0; b < LOD_BOUNDARIES.length; b++) {
      const boundary = LOD_BOUNDARIES[b]!;
      const distToBoundary = Math.abs(dist - boundary);
      if (distToBoundary < LOD_BLEND_CHUNKS) {
        const t = distToBoundary / LOD_BLEND_CHUNKS;
        alpha = dist > boundary ? t : 1 - t;
        alpha = Math.max(0.05, alpha);
        break;
      }
    }
    LODLevel.blendAlpha[eid] = alpha;
  }
}
