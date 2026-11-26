#!/usr/bin/env python3
"""
File: prefill_menus.py
Purpose: fill (or refresh) the menu of a list of entities through the API —
         POST /api/v3/entities/{id}/menu/refresh — and write a report for the curator's review.
Dependencies: requests, python-dotenv. Spec: docs/superpowers/specs/2026-11-26-entity-menu-design.md.

Main Responsibilities:
- Read entity ids (one per line, `#` comments allowed) from --ids-file and/or --ids
- Call refresh with low concurrency (each call reads the site and the model: seconds, and costs)
- Report per entity: status, sources (kind/covers), items, price per person, error/rejections
- Dry-run by default (prints what it would call); --apply calls the API

The API decides what is new: a document whose text did not change is not read by the model again,
and a refresh inside the minimum interval returns what is stored (use --force to re-read).

Usage:
    python scripts/python-tools/prefill_menus.py --ids-file data/catalog_entity_ids.txt
    python scripts/python-tools/prefill_menus.py --ids-file data/catalog_entity_ids.txt --apply \\
        --report data/menus/prefill-2026-11-26.jsonl
Env: API_V3_BASE_URL (default https://api.concierge-collector.com/api/v3), API_SECRET_KEY or the first of
     ADMIN_API_KEYS (from concierge-api-v3/.env). The key is never printed.
"""

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_API = "https://api.concierge-collector.com/api/v3"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--ids-file", type=Path, help="entity ids, one per line")
    p.add_argument("--ids", nargs="*", default=[], help="entity ids on the command line")
    p.add_argument("--apply", action="store_true", help="call the API (default: dry-run)")
    p.add_argument("--force", action="store_true", help="re-read documents even when unchanged")
    p.add_argument("--concurrency", type=int, default=2)
    p.add_argument("--timeout", type=float, default=180.0, help="seconds per refresh call")
    p.add_argument("--report", type=Path, help="JSONL report path (one line per entity)")
    return p.parse_args()


def load_ids(args: argparse.Namespace) -> List[str]:
    ids = list(args.ids)
    if args.ids_file:
        for line in args.ids_file.read_text().splitlines():
            line = line.split("#", 1)[0].strip()
            if line:
                ids.append(line)
    return list(dict.fromkeys(ids))


def api_key() -> str:
    load_dotenv(ROOT / "concierge-api-v3" / ".env")
    key = (os.getenv("API_SECRET_KEY") or "").strip()
    if not key:
        key = next((k.strip() for k in (os.getenv("ADMIN_API_KEYS") or "").split(",") if k.strip()), "")
    if not key:
        sys.exit("API_SECRET_KEY / ADMIN_API_KEYS not set (concierge-api-v3/.env)")
    return key


def summarize(entity_id: str, status_code: int, body: Dict[str, Any], seconds: float) -> Dict[str, Any]:
    if status_code != 200:
        return {"entity_id": entity_id, "http": status_code, "error": (body or {}).get("detail"), "seconds": seconds}
    derived = body.get("derived") or {}
    per_person = derived.get("per_person_brl") or {}
    return {
        "entity_id": entity_id,
        "status": body.get("status"),
        "website": body.get("website"),
        "sources": [f"{s.get('kind')}:{s.get('covers')}" for s in body.get("sources") or []],
        "items": len(body.get("items") or []),
        "per_person_dinner": per_person.get("dinner"),
        "per_person_lunch": per_person.get("lunch"),
        "partial": per_person.get("partial"),
        "main_median": (derived.get("main_brl") or {}).get("median"),
        "tasting": [t.get("price_brl") for t in derived.get("tasting_menus") or []],
        "wine_labels": (derived.get("drinks") or {}).get("wine_labels"),
        "last_error": body.get("last_error"),
        "rejected": body.get("rejected") or [],
        "seconds": seconds,
    }


def main() -> None:
    args = parse_args()
    ids = load_ids(args)
    if not ids:
        sys.exit("no entity ids (use --ids-file or --ids)")
    base = (os.getenv("API_V3_BASE_URL") or DEFAULT_API).rstrip("/")
    if not args.apply:
        print(f"dry-run: would refresh {len(ids)} entities at {base} (force={args.force}); add --apply")
        for entity_id in ids[:10]:
            print("  ", entity_id)
        return
    headers = {"X-API-Key": api_key()}

    def one(entity_id: str) -> Dict[str, Any]:
        started = time.monotonic()
        try:
            response = requests.post(
                f"{base}/entities/{entity_id}/menu/refresh",
                params={"force": "true"} if args.force else None,
                headers=headers,
                timeout=args.timeout,
            )
            body = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
            return summarize(entity_id, response.status_code, body, round(time.monotonic() - started, 1))
        except requests.RequestException as exc:
            return {"entity_id": entity_id, "error": type(exc).__name__, "seconds": round(time.monotonic() - started, 1)}

    report = args.report.open("w") if args.report else None
    counts: Dict[str, int] = {}
    with ThreadPoolExecutor(max(1, args.concurrency)) as pool:
        for row in pool.map(one, ids):
            key = row.get("status") or (f"http_{row['http']}" if row.get("http") else "error")
            counts[key] = counts.get(key, 0) + 1
            print(json.dumps(row, ensure_ascii=False), flush=True)
            if report:
                report.write(json.dumps(row, ensure_ascii=False) + "\n")
    if report:
        report.close()
    print("summary:", json.dumps(counts))


if __name__ == "__main__":
    main()
