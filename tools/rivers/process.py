from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "processed"


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rivers = [
        {"name": "Nilus", "ancient_name": "Nilus", "width_tiles": 3, "is_navigable": True},
        {"name": "Tiberis", "ancient_name": "Tiber", "width_tiles": 1, "is_navigable": False},
    ]
    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "rivers": rivers,
    }
    path = OUT_DIR / "rivers.json"
    path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"rivers: wrote {path}")


if __name__ == "__main__":
    main()
