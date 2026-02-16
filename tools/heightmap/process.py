from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
import math


ROOT = Path(__file__).resolve().parents[1]
DATA_PROCESSED_DIR = ROOT / "data" / "processed"
DATA_RAW_DIR = ROOT / "data" / "raw"


def ensure_dirs() -> None:
    DATA_PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    DATA_RAW_DIR.mkdir(parents=True, exist_ok=True)


def generate_heightmap(width: int, height: int) -> list[int]:
    values = []
    for y in range(height):
        for x in range(width):
            u = (x / width - 0.5) * 2 * math.pi
            v = (y / height - 0.5) * 2 * math.pi
            value = 32 + int(24 * (math.sin(u * 3.1) * math.cos(v * 2.3) + 1.0) // 2
            value += int(8.0 * math.sin(u * 18.0) * math.cos(v * 21.0))
            value = max(0, min(127, value))
            values.append(value)
    return values


def main() -> None:
    ensure_dirs()
    width = 2048
    height = 2048
    values = generate_heightmap(width, height)
    raw_path = DATA_PROCESSED_DIR / "heightmap_2048.raw"
    raw_path.write_bytes(bytes(values))

    meta_path = DATA_PROCESSED_DIR / "heightmap_2048.json"
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "width": width,
        "height": height,
        "min": min(values) if values else 0,
        "max": max(values) if values else 0,
        "format": "uint8",
        "sea_level": 32,
    }
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"heightmap: wrote {raw_path} and {meta_path}")


if __name__ == "__main__":
    main()
