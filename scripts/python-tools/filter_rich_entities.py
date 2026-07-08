#!/usr/bin/env python3
"""
File: filter_rich_entities.py
Purpose: Filter a normalized/merged entities JSON down to "rich" entities —
         those with substantial contact/location data worth importing.
Dependencies: (stdlib only)

Background:
    For São Paulo we imported a "rich" subset of the merged OSM+Overture dataset
    (~13k of ~79k). The rich records were characterized by dense contact info:
    ~99% had phone, ~99% postal_code, ~96% website, ~84% email, and a mean of
    3.8 populated contact fields (vs 2.3 across the full merged set).

    This script encodes that idea as an explicit, tunable richness rule so the
    step is reproducible for other cities (e.g. Rio).

Richness rule (default):
    An entity is "rich" when it has coordinates AND scores >= --min-score points:
      +1 phone
      +1 website
      +1 email
      +1 facebook
      +1 instagram
      +1 postal_code
      +1 address
      +1 cuisine
    Contact fields (phone/website/email/facebook/instagram) carry the weight,
    matching what made the SP rich set dense. Tune with --min-score.

Usage:
    # Dry-run: show how many pass at the default threshold + coverage
    python scripts/python-tools/filter_rich_entities.py \
        --input data/rio_restaurants_merged.json

    # Write the rich subset out
    python scripts/python-tools/filter_rich_entities.py \
        --input data/rio_restaurants_merged.json \
        --output data/rio_restaurants_rich.json --min-score 4

    # Preview thresholds side by side, no file written
    python scripts/python-tools/filter_rich_entities.py \
        --input data/rio_restaurants_merged.json --sweep
"""

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List


CONTACT_KEYS = ("phone", "website", "email", "facebook", "instagram")


def richness_score(entity: Dict[str, Any]) -> int:
    """Count populated quality signals for an entity."""
    data = entity.get("data") or {}
    contact = data.get("contact") or {}
    location = data.get("location") or {}

    score = 0
    for k in CONTACT_KEYS:
        if contact.get(k):
            score += 1
    if location.get("postal_code"):
        score += 1
    if location.get("address"):
        score += 1
    if data.get("cuisine"):
        score += 1
    return score


def has_coordinates(entity: Dict[str, Any]) -> bool:
    return bool((entity.get("data") or {}).get("location", {}).get("coordinates"))


def is_rich(entity: Dict[str, Any], min_score: int) -> bool:
    return has_coordinates(entity) and richness_score(entity) >= min_score


def coverage(entities: List[Dict[str, Any]]) -> None:
    total = len(entities)
    if not total:
        print("  (empty)")
        return

    def pct(pred) -> str:
        n = sum(1 for e in entities if pred(e))
        return f"{n:>7,} ({n * 100 // total:>3}%)"

    def contact(e, k):
        return bool((e.get("data") or {}).get("contact", {}).get(k))

    def loc(e, k):
        return bool((e.get("data") or {}).get("location", {}).get(k))

    print(f"  phone:      {pct(lambda e: contact(e, 'phone'))}")
    print(f"  website:    {pct(lambda e: contact(e, 'website'))}")
    print(f"  email:      {pct(lambda e: contact(e, 'email'))}")
    print(f"  facebook:   {pct(lambda e: contact(e, 'facebook'))}")
    print(f"  instagram:  {pct(lambda e: contact(e, 'instagram'))}")
    print(f"  postal:     {pct(lambda e: loc(e, 'postal_code'))}")
    print(f"  address:    {pct(lambda e: loc(e, 'address'))}")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Filter merged entities down to a 'rich' subset",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--input", required=True, metavar="PATH",
                   help="Merged entities JSON (list of EntityCreate objects)")
    p.add_argument("--output", metavar="PATH", default=None,
                   help="Write rich subset here (omit for dry-run)")
    p.add_argument("--min-score", type=int, default=4, dest="min_score",
                   help="Minimum richness score to keep (default: 4)")
    p.add_argument("--sweep", action="store_true",
                   help="Show pass counts for scores 2–6 and exit")
    return p.parse_args()


def main() -> int:
    args = parse_args()

    path = Path(args.input)
    if not path.exists():
        print(f"ERROR: file not found: {path}")
        return 1

    print("Rich Entity Filter")
    print("=" * 60)
    print(f"Input: {path}")
    with path.open(encoding="utf-8") as fh:
        entities = json.load(fh)
    print(f"Loaded: {len(entities):,} entities")
    print()

    if args.sweep:
        print("Threshold sweep (min-score → kept):")
        for s in range(2, 7):
            kept = sum(1 for e in entities if is_rich(e, s))
            pct = kept * 100 // max(len(entities), 1)
            print(f"  score >= {s}: {kept:>7,}  ({pct}%)")
        return 0

    rich = [e for e in entities if is_rich(e, args.min_score)]
    pct = len(rich) * 100 // max(len(entities), 1)
    print(f"Rich (score >= {args.min_score}): {len(rich):,}  ({pct}% of input)")
    print()
    print("Coverage in rich subset:")
    coverage(rich)

    if args.output:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w", encoding="utf-8") as fh:
            json.dump(rich, fh, ensure_ascii=False, indent=2)
        size_mb = out.stat().st_size / 1024 / 1024
        print()
        print(f"Saved: {out}  ({size_mb:.1f} MB, {len(rich):,} entities)")
    else:
        print()
        print("(dry-run — pass --output PATH to write the rich subset)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
