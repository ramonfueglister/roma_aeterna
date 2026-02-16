from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "processed"


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    provinces = [
        {"id": "italia", "name": "Italia", "number": 27, "culture": "roman", "color": "#d3b37d"},
        {"id": "aegyptus", "name": "Aegyptus", "number": 2, "culture": "egyptian", "color": "#d29a58"},
        {"id": "africa", "name": "Africa Proconsularis", "number": 3, "culture": "roman", "color": "#d9ad62"},
        {"id": "achaea", "name": "Achaea", "number": 1, "culture": "greek", "color": "#8f8be3"},
    ]
    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "provinces": provinces,
    }
    path = OUT_DIR / "provinces.json"
    path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"provinces: wrote {path}")


if __name__ == "__main__":
    main()
