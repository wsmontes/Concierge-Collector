#!/usr/bin/env python3
"""
File: import_entities.py
Purpose: Bulk-import a pre-normalized entities JSON file into the Concierge
         Collector API v3 via POST /entities/bulk.
Dependencies: requests, python-dotenv

Main Responsibilities:
- Load a JSON file containing a list of EntityCreate-compatible objects
- Validate required fields (entity_id, name, type) before sending
- Send entities in configurable chunks via POST /entities/bulk
- Report created / updated / skipped / error counts per chunk and in total
- Support dry-run (default) and --apply mode

Usage examples:
    # Dry-run: validate and preview without importing
    python scripts/python-tools/import_entities.py --input data/sp_restaurants_rich.json

    # Import with default chunk size (200)
    python scripts/python-tools/import_entities.py \\
        --input data/sp_restaurants_rich.json --apply

    # Import merged dataset with smaller chunks
    python scripts/python-tools/import_entities.py \\
        --input data/sp_restaurants_merged.json --chunk-size 100 --apply
"""

import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Tuple

import requests
from dotenv import load_dotenv


DEFAULT_CHUNK = 200
VALID_TYPES   = {"restaurant", "hotel", "venue", "bar", "cafe", "other"}
VALID_STATUS  = {"active", "inactive", "draft"}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Bulk-import a normalized entities JSON into API v3",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--input", required=True, metavar="PATH",
                   help="Path to JSON file containing a list of entity objects")
    p.add_argument("--chunk-size", type=int, default=DEFAULT_CHUNK, dest="chunk_size",
                   help=f"Entities per API request (default: {DEFAULT_CHUNK})")
    p.add_argument("--apply", action="store_true",
                   help="Send to API. Without this flag the script is a dry-run.")
    return p.parse_args()


def _find_env_file() -> Path:
    here = Path(__file__).resolve()
    for candidate in [
        here.parents[2] / "concierge-api-v3" / ".env",
        here.parents[2] / ".env",
        Path.cwd() / ".env",
    ]:
        if candidate.exists():
            return candidate
    return here.parents[2] / "concierge-api-v3" / ".env"


def load_settings() -> Tuple[str, str]:
    load_dotenv(_find_env_file())
    base_url = os.environ.get("API_BASE_URL", "https://concierge-collector.onrender.com/api/v3")
    api_key  = os.environ.get("API_SECRET_KEY", "")
    if not api_key:
        raise RuntimeError("API_SECRET_KEY not set. Add it to concierge-api-v3/.env")
    return base_url.rstrip("/") + "/entities/bulk", api_key


def validate(entities: List[Dict[str, Any]]) -> List[str]:
    """Return a list of validation error strings. Empty list means all OK."""
    errors: List[str] = []
    ids_seen: set = set()
    for i, e in enumerate(entities):
        eid = e.get("entity_id")
        if not eid:
            errors.append(f"[{i}] missing entity_id")
        elif eid in ids_seen:
            errors.append(f"[{i}] duplicate entity_id: {eid}")
        else:
            ids_seen.add(eid)
        if not e.get("name"):
            errors.append(f"[{i}] missing name")
        elif len(e["name"]) > 500:
            errors.append(f"[{i}] name > 500 chars: {e['name'][:60]}…")
        if e.get("type") not in VALID_TYPES:
            errors.append(f"[{i}] invalid type: {e.get('type')!r} (valid: {', '.join(sorted(VALID_TYPES))})")
        if e.get("status") and e["status"] not in VALID_STATUS:
            errors.append(f"[{i}] invalid status: {e.get('status')!r}")
        if len(errors) >= 20:
            errors.append("… (truncated after 20 errors)")
            break
    return errors


def post_bulk(
    api_bulk_url: str,
    api_key: str,
    entities: List[Dict[str, Any]],
    chunk_size: int,
) -> Dict[str, int]:
    headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
    totals = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}

    for start in range(0, len(entities), chunk_size):
        chunk   = entities[start : start + chunk_size]
        end_idx = min(start + chunk_size, len(entities))
        print(f"  [{start + 1:>6}–{end_idx:<6}] {len(chunk)} items… ", end="", flush=True)
        try:
            resp = requests.post(api_bulk_url, json={"entities": chunk},
                                 headers=headers, timeout=120)
            resp.raise_for_status()
            r = resp.json()
            c, u, s, e = (r.get("created", 0), r.get("updated", 0),
                          r.get("skipped", 0), len(r.get("errors", [])))
            totals["created"] += c
            totals["updated"] += u
            totals["skipped"] += s
            totals["errors"]  += e
            print(f"created={c} updated={u} skipped={s} errors={e}")
            for err in r.get("errors", []):
                print(f"    [item {err.get('index', '?')}] {err.get('error', 'unknown')}")
        except Exception as exc:
            totals["errors"] += len(chunk)
            print(f"FAILED — {exc}")

    return totals


def main() -> int:
    args = parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"ERROR: file not found: {input_path}")
        return 1

    print(f"Entity Importer")
    print("=" * 60)
    print(f"Input:  {input_path}")
    print(f"Mode:   {'APPLY' if args.apply else 'dry-run'}")
    print()

    print("Loading…", end="", flush=True)
    with input_path.open(encoding="utf-8") as fh:
        entities = json.load(fh)
    if not isinstance(entities, list):
        print(f"\nERROR: expected a JSON array, got {type(entities).__name__}")
        return 1
    print(f" {len(entities):,} entities")

    # ── Validate ──────────────────────────────────────────────────────────────
    print("Validating…", end="", flush=True)
    errors = validate(entities)
    if errors:
        print(f" {len(errors)} errors found:")
        for err in errors:
            print(f"  {err}")
        return 1
    print(f" OK")

    from collections import Counter
    type_dist = Counter(e.get("type") for e in entities)
    print(f"Types: {dict(type_dist)}")
    print()

    if not args.apply:
        print("=== DRY-RUN: first 2 entities ===")
        for e in entities[:2]:
            print(json.dumps(e, indent=2, ensure_ascii=False)[:400])
            print()
        print(f"(Add --apply to send {len(entities):,} entities to the API)")
        return 0

    # ── Import ────────────────────────────────────────────────────────────────
    try:
        api_bulk_url, api_key = load_settings()
    except RuntimeError as exc:
        print(f"ERROR: {exc}")
        return 1

    print(f"Endpoint:   {api_bulk_url}")
    print(f"Chunk size: {args.chunk_size}")
    print()

    totals = post_bulk(api_bulk_url, api_key, entities, args.chunk_size)

    print()
    print("=" * 60)
    print("Import summary")
    print(f"  Created: {totals['created']:,}")
    print(f"  Updated: {totals['updated']:,}")
    print(f"  Skipped: {totals['skipped']:,}")
    print(f"  Errors:  {totals['errors']:,}")
    return 0 if totals["errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
