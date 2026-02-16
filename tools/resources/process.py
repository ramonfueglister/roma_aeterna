from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "processed"


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    resources = [
        {"type": "grain", "tile_x": 1030, "tile_y": 1010, "province_number": 27, "field_type": "grain_field", "quantity": 1.2},
        {"type": "wine", "tile_x": 1180, "tile_y": 1110, "province_number": 39, "field_type": "vineyard", "quantity": 0.85},
        {"type": "marble", "tile_x": 940, "tile_y": 1330, "province_number": 1, "field_type": "quarry", "quantity": 0.66},
    ]
    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "resources": resources,
    }
    path = OUT_DIR / "resources.json"
    path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"resources: wrote {path}")


if __name__ == "__main__":
    main()
