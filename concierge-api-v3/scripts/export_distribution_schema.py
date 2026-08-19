#!/usr/bin/env python3
"""Write/check the canonical public Collection distribution DTO schema."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
CONTRACT = API_ROOT.parent / "contracts/json-schema/distribution-item.v1.schema.json"


def rendered() -> str:
    if str(API_ROOT) not in sys.path:
        sys.path.insert(0, str(API_ROOT))
    from app.models.distribution_api import PublicCurationItemV1

    return json.dumps(PublicCurationItemV1.model_json_schema(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    value = rendered()
    if args.check:
        if not CONTRACT.exists() or CONTRACT.read_text(encoding="utf-8") != value:
            print(f"Distribution schema is stale: {CONTRACT}", file=sys.stderr)
            return 1
        return 0
    CONTRACT.parent.mkdir(parents=True, exist_ok=True)
    CONTRACT.write_text(value, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
