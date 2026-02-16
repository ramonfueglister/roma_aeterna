from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "processed"


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    trades = [
        {"name": "Mediterranean Grain Corridor", "from_city_id": "roma", "to_city_id": "carthago", "route_type": "sea", "distance_km": 520},
        {"name": "Via Appia Coastal Spine", "from_city_id": "roma", "to_city_id": "puteoli", "route_type": "land", "distance_km": 190},
    ]
    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "trade_routes": trades,
    }
    path = OUT_DIR / "trade_routes.json"
    path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"trade routes: wrote {path}")

if __name__ == "__main__":
    main()
