from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "processed"


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    roads = [
        {
            "name": "Via Appia",
            "from_city": "roma",
            "to_city": "brundisium",
            "road_type": "major",
            "geometry": {
                "type": "LineString",
                "coordinates": [[1024, 1020], [1100, 1034], [1170, 1089]],
            },
        },
        {
            "name": "Via Traiana",
            "from_city": "roma",
            "to_city": "brundisium",
            "road_type": "major",
            "geometry": {
                "type": "LineString",
                "coordinates": [[1024, 1020], [1060, 1080], [1128, 1122]],
            },
        },
    ]
    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "roads": roads,
    }
    path = OUT_DIR / "roads.json"
    path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"roads: wrote {path}")


if __name__ == "__main__":
    main()
