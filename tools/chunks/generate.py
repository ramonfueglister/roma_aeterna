from __future__ import annotations

import json
import math
import struct
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHUNK_DIR = ROOT / "data" / "chunks"
CHUNK_DIR.mkdir(parents=True, exist_ok=True)

MAP_CHUNKS = 64
CHUNK_SIZE = 32
HEADER_BYTES = 8
TILE_BYTES = CHUNK_SIZE * CHUNK_SIZE
BYTES_PER_CHUNK = HEADER_BYTES + TILE_BYTES * 4


def simple_noise(x: int, y: int, lod: int) -> int:
    scale = (lod + 1) * 0.001
    h = 32 + int(46 * (0.5 + 0.5 * (math.sin((x * 0.11 + lod * 17.0) * scale) * math.cos((y * 0.13 + lod * 23.0) * scale)))
    return max(0, min(127, h))


def build_chunk_bytes(chunk_x: int, chunk_y: int, lod: int) -> bytes:
    payload = bytearray(BYTES_PER_CHUNK)
    struct.pack_into("<HHHH", payload, 0, 0x494D, 1, chunk_x, chunk_y)
    cursor = HEADER_BYTES
    for local_y in range(CHUNK_SIZE):
        for local_x in range(CHUNK_SIZE):
            world_x = chunk_x * CHUNK_SIZE + local_x
            world_y = chunk_y * CHUNK_SIZE + local_y
            heights = simple_noise(world_x, world_y, lod)
            payload[cursor] = heights
            cursor += 1
    for _ in range(TILE_BYTES):
        payload[cursor] = 2  # mediterranean-like default biome
        cursor += 1
    for _ in range(TILE_BYTES):
        payload[cursor] = 0
        cursor += 1
    for _ in range(TILE_BYTES):
        payload[cursor] = (chunk_x + chunk_y) % 2  # alternating province hints
        cursor += 1
    return bytes(payload)


def main() -> None:
    manifest = []
    for lod in range(4):
        for chunk_x in range(MAP_CHUNKS):
            for chunk_y in range(MAP_CHUNKS):
                chunk_bytes = build_chunk_bytes(chunk_x, chunk_y, lod)
                file_path = CHUNK_DIR / f"chunk_{lod:02d}_{chunk_x:02d}_{chunk_y:02d}.bin"
                file_path.write_bytes(chunk_bytes)
                manifest.append({
                    "lod": lod,
                    "chunk_x": chunk_x,
                    "chunk_y": chunk_y,
                    "path": str(file_path.name),
                    "bytes": len(chunk_bytes),
                })
    meta_path = CHUNK_DIR / "manifest.json"
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "map_chunks": MAP_CHUNKS,
        "chunk_size": CHUNK_SIZE,
        "tile_bytes": TILE_BYTES,
        "lod_levels": 4,
        "items": manifest[:4],  # sample of first tiles
        "total_chunks": len(manifest),
    }
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"chunks: wrote {len(manifest)} files into {CHUNK_DIR}")


if __name__ == "__main__":
    main()
