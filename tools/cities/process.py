from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "processed"


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    cities = [
        {
            "id": "roma",
            "name": "Roma",
            "ancient_name": "Urbs Roma",
            "culture": "roman",
            "size": "metropolis",
            "population": 300000,
            "tile_x": 1024,
            "tile_y": 1000,
            "province_number": 27,
            "accuracy_tier": "A",
            "confidence": 0.98,
            "source_refs": [{"source": "bootstrap"}],
            "name_status": "attested",
            "is_harbor": True,
            "is_capital": True,
            "buildings": [],
            "features": ["forum", "colosseum", "harbor"],
        },
        {
            "id": "alexandria",
            "name": "Alexandria",
            "ancient_name": "Alexandreia",
            "culture": "egyptian",
            "size": "metropolis",
            "population": 500000,
            "tile_x": 1260,
            "tile_y": 1230,
            "province_number": 2,
            "accuracy_tier": "A",
            "confidence": 0.95,
            "source_refs": [{"source": "bootstrap"}],
            "name_status": "attested",
            "is_harbor": True,
            "is_capital": True,
            "buildings": [],
            "features": ["library", "harbor", "causeway"],
        },
        {
            "id": "carthago",
            "name": "Carthago",
            "ancient_name": "Carthago",
            "culture": "roman",
            "size": "metropolis",
            "population": 140000,
            "tile_x": 835,
            "tile_y": 1182,
            "province_number": 3,
            "accuracy_tier": "B",
            "confidence": 0.88,
            "source_refs": [{"source": "bootstrap"}],
            "name_status": "attested",
            "is_harbor": True,
            "is_capital": False,
            "buildings": [],
            "features": ["harbor", "amphitheater", "forum"],
        },
    ]

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cities": cities,
    }
    city_path = OUT_DIR / "cities.json"
    city_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"cities: wrote {city_path}")


if __name__ == "__main__":
    main()
