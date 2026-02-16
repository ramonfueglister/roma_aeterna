/**
 * Binary chunk encoder/decoder.
 * Format: 4104 bytes total
 *   Header (8 bytes): magic[2], version[1], padding[1], chunkX[2], chunkY[2]
 *   Heights (1024 bytes): 32x32 uint8 height values (0-127)
 *   Biomes (1024 bytes): 32x32 uint8 biome IDs
 *   Flags (1024 bytes): 32x32 uint8 flag bitfields
 *   Provinces (1024 bytes): 32x32 uint8 province IDs
 */

import { CHUNK_BYTES, CHUNK_SIZE } from '../config';
import type { ChunkData } from '../types';

const MAGIC = 0x494d; // 'IM' for Imperium
const VERSION = 1;
const HEADER_SIZE = 8;
const LAYER_SIZE = CHUNK_SIZE * CHUNK_SIZE; // 1024

/** Decode a binary chunk buffer into ChunkData. */
export function decodeChunk(buffer: ArrayBuffer): ChunkData {
  if (buffer.byteLength !== CHUNK_BYTES) {
    throw new Error(`Invalid chunk size: ${buffer.byteLength}, expected ${CHUNK_BYTES}`);
  }

  const view = new DataView(buffer);
  const magic = view.getUint16(0, true);
  if (magic !== MAGIC) {
    throw new Error(`Invalid chunk magic: 0x${magic.toString(16)}, expected 0x${MAGIC.toString(16)}`);
  }

  const version = view.getUint8(2);
  if (version !== VERSION) {
    throw new Error(`Unsupported chunk version: ${version}`);
  }

  const cx = view.getUint16(4, true);
  const cy = view.getUint16(6, true);

  const data = new Uint8Array(buffer);
  return {
    cx,
    cy,
    heights: data.slice(HEADER_SIZE, HEADER_SIZE + LAYER_SIZE),
    biomes: data.slice(HEADER_SIZE + LAYER_SIZE, HEADER_SIZE + 2 * LAYER_SIZE),
    flags: data.slice(HEADER_SIZE + 2 * LAYER_SIZE, HEADER_SIZE + 3 * LAYER_SIZE),
    provinces: data.slice(HEADER_SIZE + 3 * LAYER_SIZE, HEADER_SIZE + 4 * LAYER_SIZE),
  };
}

/** Encode ChunkData into a binary buffer. */
export function encodeChunk(chunk: ChunkData): ArrayBuffer {
  const buffer = new ArrayBuffer(CHUNK_BYTES);
  const view = new DataView(buffer);
  const data = new Uint8Array(buffer);

  // Header
  view.setUint16(0, MAGIC, true);
  view.setUint8(2, VERSION);
  view.setUint8(3, 0); // padding
  view.setUint16(4, chunk.cx, true);
  view.setUint16(6, chunk.cy, true);

  // Data layers
  data.set(chunk.heights, HEADER_SIZE);
  data.set(chunk.biomes, HEADER_SIZE + LAYER_SIZE);
  data.set(chunk.flags, HEADER_SIZE + 2 * LAYER_SIZE);
  data.set(chunk.provinces, HEADER_SIZE + 3 * LAYER_SIZE);

  return buffer;
}

/** Validate chunk data integrity. */
export function validateChunk(chunk: ChunkData): string[] {
  const errors: string[] = [];

  if (chunk.heights.length !== LAYER_SIZE) {
    errors.push(`Heights array length ${chunk.heights.length}, expected ${LAYER_SIZE}`);
  }
  if (chunk.biomes.length !== LAYER_SIZE) {
    errors.push(`Biomes array length ${chunk.biomes.length}, expected ${LAYER_SIZE}`);
  }
  if (chunk.flags.length !== LAYER_SIZE) {
    errors.push(`Flags array length ${chunk.flags.length}, expected ${LAYER_SIZE}`);
  }
  if (chunk.provinces.length !== LAYER_SIZE) {
    errors.push(`Provinces array length ${chunk.provinces.length}, expected ${LAYER_SIZE}`);
  }

  // Check height values in range
  for (let i = 0; i < chunk.heights.length; i++) {
    const h = chunk.heights[i];
    if (h !== undefined && h > 127) {
      errors.push(`Height at index ${i} is ${h}, max is 127`);
      break; // Report only first error
    }
  }

  return errors;
}
