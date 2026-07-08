#!/usr/bin/env python3
"""
File: merge_restaurant_datasets.py
Purpose: Merge OSM and Overture Maps restaurant datasets into a single enriched
         entity collection for São Paulo, then optionally bulk-import into the
         Concierge Collector API v3.
Dependencies: requests, python-dotenv

Main Responsibilities:
- Load normalized OSM entities (from extract_osm_restaurants.py output)
- Load normalized Overture entities (from extract_overture_restaurants.py output)
- Match venues across datasets using spatial proximity + name similarity:
    • Grid-based spatial index (no external dependencies required)
    • Haversine distance < 80 m for candidate pairs
    • Normalized name similarity ≥ 0.55 (difflib.SequenceMatcher)
    • Greedy bipartite assignment (best score wins, each venue matched once)
- Merge strategy: OSM entity is the primary record; Overture fills in missing
  contact fields (phone, email, postal_code, Facebook, website, Instagram)
- Add unmatched Overture venues as additional entities (source = "overture")
- Report match statistics and field-coverage improvements
- Optionally save merged list to JSON and/or bulk-import to API v3

Usage examples:
    # Dry-run: merge and save to default output, no API import
    python scripts/python-tools/merge_restaurant_datasets.py

    # Specify custom input files
    python scripts/python-tools/merge_restaurant_datasets.py \\
        --osm data/sp_restaurants_osm.json \\
        --overture data/sp_restaurants_overture.json \\
        --output data/sp_restaurants_merged.json

    # Only include Overture-only venues with confidence ≥ 0.7
    python scripts/python-tools/merge_restaurant_datasets.py \\
        --min-overture-confidence 0.7

    # Merge and import into API
    python scripts/python-tools/merge_restaurant_datasets.py --apply

    # Tighter matching (require very similar names)
    python scripts/python-tools/merge_restaurant_datasets.py \\
        --name-threshold 0.75 --distance-threshold 50
"""

import argparse
import difflib
import json
import math
import os
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from dotenv import load_dotenv


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_OSM_INPUT      = "data/sp_restaurants_osm.json"
DEFAULT_OVERTURE_INPUT = "data/sp_restaurants_overture.json"
DEFAULT_OUTPUT         = "data/sp_restaurants_merged.json"
DEFAULT_CHUNK          = 200

# Matching thresholds (adjustable via CLI)
DEFAULT_DISTANCE_M   = 80.0   # metres — candidate spatial window
DEFAULT_NAME_THRESH  = 0.55   # SequenceMatcher ratio on normalized names

# Grid cell ≈ 0.001° lat × 0.001° lng ≈ 111 m × 85 m in SP latitude
GRID_STEP = 0.001


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Merge OSM + Overture restaurant datasets",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--osm", default=DEFAULT_OSM_INPUT, metavar="PATH",
                   help=f"OSM normalized JSON (default: {DEFAULT_OSM_INPUT})")
    p.add_argument("--overture", default=DEFAULT_OVERTURE_INPUT, metavar="PATH",
                   help=f"Overture normalized JSON (default: {DEFAULT_OVERTURE_INPUT})")
    p.add_argument("--output", default=DEFAULT_OUTPUT, metavar="PATH",
                   help=f"Output merged JSON path (default: {DEFAULT_OUTPUT}). Pass - to skip.")
    p.add_argument("--distance-threshold", type=float, default=DEFAULT_DISTANCE_M,
                   dest="distance_threshold", metavar="METRES",
                   help=f"Max centre-to-centre distance in metres for a match (default: {DEFAULT_DISTANCE_M})")
    p.add_argument("--name-threshold", type=float, default=DEFAULT_NAME_THRESH,
                   dest="name_threshold", metavar="RATIO",
                   help=f"Min SequenceMatcher ratio (0–1) for name similarity (default: {DEFAULT_NAME_THRESH})")
    p.add_argument("--min-overture-confidence", type=float, default=0.0,
                   dest="min_overture_confidence", metavar="FLOAT",
                   help="Min Overture confidence to include unmatched Overture venues (default: 0.0 = all)")
    p.add_argument("--no-overture-only", action="store_true", dest="no_overture_only",
                   help="Exclude unmatched Overture venues (keep only OSM + enriched OSM)")
    p.add_argument("--apply", action="store_true",
                   help="Send merged entities to API. Without this flag, script is a dry-run.")
    p.add_argument("--chunk-size", type=int, default=DEFAULT_CHUNK, dest="chunk_size",
                   help=f"Entities per bulk API request (default: {DEFAULT_CHUNK})")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Return great-circle distance in metres between two WGS-84 points."""
    R = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi    = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _grid_key(lat: float, lng: float) -> Tuple[int, int]:
    """Return integer grid cell for a coordinate."""
    return (int(lat / GRID_STEP), int(lng / GRID_STEP))


def build_spatial_index(
    entities: List[Dict[str, Any]],
) -> Dict[Tuple[int, int], List[int]]:
    """Build a grid-based spatial index.

    Returns a mapping from grid cell → list of entity indices.
    Entities without coordinates are not indexed.
    """
    index: Dict[Tuple[int, int], List[int]] = defaultdict(list)
    for i, entity in enumerate(entities):
        coords = (entity.get("data") or {}).get("location", {}).get("coordinates")
        if coords:
            key = _grid_key(coords["lat"], coords["lng"])
            index[key].append(i)
    return index


def candidates_within(
    lat: float,
    lng: float,
    index: Dict[Tuple[int, int], List[int]],
    max_cells: int = 1,
) -> List[int]:
    """Return all entity indices within max_cells grid cells of (lat, lng)."""
    base_r, base_c = _grid_key(lat, lng)
    result: List[int] = []
    for dr in range(-max_cells, max_cells + 1):
        for dc in range(-max_cells, max_cells + 1):
            result.extend(index.get((base_r + dr, base_c + dc), []))
    return result


# ---------------------------------------------------------------------------
# Name similarity helpers
# ---------------------------------------------------------------------------

_STOP_WORDS = frozenset({
    "restaurante", "restaurant", "bar", "cafe", "cafeteria", "lanchonete",
    "lanche", "lanches", "padaria", "panificadora", "pizzaria", "choperia",
    "chopperia", "hamburgueria", "sorveteria", "sorvete", "pastelaria",
    "petiscaria", "churrascaria", "espetinho", "espetaria", "bistrô", "bistro",
    "cantina", "trattoria", "sushi", "yakissoba", "temakeria", "buffet",
    "doceria", "confeitaria", "e", "de", "do", "da", "dos", "das", "di",
    "the", "o", "a", "os", "as", "em", "no", "na", "nos", "nas",
})


def normalize_name(name: str) -> str:
    """Lowercase, remove accents, strip punctuation and stop words."""
    # Remove accents (NFD decomposition + strip combining marks)
    name = unicodedata.normalize("NFD", name)
    name = "".join(c for c in name if unicodedata.category(c) != "Mn")
    name = name.lower()
    # Replace punctuation with space
    name = re.sub(r"[^\w\s]", " ", name)
    # Remove extra whitespace
    name = " ".join(w for w in name.split() if w and w not in _STOP_WORDS)
    return name


def name_similarity(a: str, b: str) -> float:
    """Return SequenceMatcher ratio for normalized versions of a and b."""
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        return 0.0
    return difflib.SequenceMatcher(None, na, nb).ratio()


# ---------------------------------------------------------------------------
# Coordinate extractor helpers
# ---------------------------------------------------------------------------

def get_coords(entity: Dict[str, Any]) -> Optional[Tuple[float, float]]:
    """Return (lat, lng) or None for an entity."""
    coords = (entity.get("data") or {}).get("location", {}).get("coordinates")
    if coords and coords.get("lat") is not None and coords.get("lng") is not None:
        return coords["lat"], coords["lng"]
    return None


# ---------------------------------------------------------------------------
# Merge logic
# ---------------------------------------------------------------------------

def _enrich_osm_with_overture(
    osm: Dict[str, Any],
    overture: Dict[str, Any],
) -> Dict[str, Any]:
    """Return a copy of the OSM entity with Overture contact data merged in.

    Overture fills in only fields that are absent in OSM to avoid overwriting
    higher-quality manual/OSM data.  Overture metadata (id, confidence,
    category) is always stored under data.overture_* keys.
    """
    import copy
    merged = copy.deepcopy(osm)
    data = merged["data"]
    o_data = overture.get("data") or {}

    # ── Overture metadata ─────────────────────────────────────────────────────
    if o_data.get("overture_id"):
        data["overture_id"]         = o_data["overture_id"]
    if o_data.get("confidence") is not None:
        data["overture_confidence"] = o_data["confidence"]
    if o_data.get("category"):
        data["overture_category"]           = o_data["category"]
    if o_data.get("category_hierarchy"):
        data["overture_category_hierarchy"] = o_data["category_hierarchy"]

    # ── Contact enrichment (fill-in-blank only) ────────────────────────────────
    osm_contact  = data.setdefault("contact", {})
    over_contact = o_data.get("contact") or {}

    for field in ("phone", "email", "website", "facebook", "instagram",
                  "twitter", "delivery_links"):
        if not osm_contact.get(field) and over_contact.get(field):
            osm_contact[field] = over_contact[field]

    # ── Location enrichment (fill-in-blank only) ──────────────────────────────
    osm_loc  = data.setdefault("location", {})
    over_loc = o_data.get("location") or {}

    for field in ("postal_code", "address", "city", "state"):
        if not osm_loc.get(field) and over_loc.get(field):
            osm_loc[field] = over_loc[field]

    return merged


def match_datasets(
    osm_entities: List[Dict[str, Any]],
    overture_entities: List[Dict[str, Any]],
    distance_threshold: float,
    name_threshold: float,
) -> Tuple[List[Tuple[int, int, float]], List[int], List[int]]:
    """Find best matches between OSM and Overture entities.

    Returns:
        matches       — list of (osm_idx, overture_idx, score)
        unmatched_osm — indices of OSM entities with no Overture match
        unmatched_ov  — indices of Overture entities with no OSM match
    """
    print("  Building Overture spatial index…", flush=True)
    ov_index = build_spatial_index(overture_entities)

    # How many grid cells to search — ceil(distance_threshold / cell_size_m)
    # Each cell ≈ GRID_STEP * 111_000 m at equator
    cell_m    = GRID_STEP * 111_000
    max_cells = max(1, math.ceil(distance_threshold / cell_m))

    print(f"  Matching {len(osm_entities):,} OSM × {len(overture_entities):,} Overture"
          f"  (dist ≤ {distance_threshold} m, name ≥ {name_threshold})…", flush=True)

    # Collect all candidate pairs: (score, dist, osm_idx, ov_idx)
    candidate_pairs: List[Tuple[float, float, int, int]] = []

    for osm_idx, osm in enumerate(osm_entities):
        osm_coords = get_coords(osm)
        if not osm_coords:
            continue

        osm_lat, osm_lng = osm_coords
        osm_name = osm.get("name") or ""
        neighbour_idxs = candidates_within(osm_lat, osm_lng, ov_index, max_cells)

        for ov_idx in neighbour_idxs:
            ov = overture_entities[ov_idx]
            ov_coords = get_coords(ov)
            if not ov_coords:
                continue

            dist = haversine(osm_lat, osm_lng, *ov_coords)
            if dist > distance_threshold:
                continue

            sim = name_similarity(osm_name, ov.get("name") or "")
            if sim < name_threshold:
                continue

            # Score: name similarity weighted by 1/distance (closer = better)
            score = sim * (1.0 - dist / (distance_threshold * 2))
            candidate_pairs.append((score, dist, osm_idx, ov_idx))

    # Greedy assignment: sort by score desc, assign each index only once
    candidate_pairs.sort(key=lambda x: x[0], reverse=True)

    matched_osm: set  = set()
    matched_ov:  set  = set()
    matches: List[Tuple[int, int, float]] = []

    for score, dist, osm_idx, ov_idx in candidate_pairs:
        if osm_idx in matched_osm or ov_idx in matched_ov:
            continue
        matches.append((osm_idx, ov_idx, score))
        matched_osm.add(osm_idx)
        matched_ov.add(ov_idx)

    unmatched_osm = [i for i in range(len(osm_entities)) if i not in matched_osm]
    unmatched_ov  = [i for i in range(len(overture_entities)) if i not in matched_ov]

    return matches, unmatched_osm, unmatched_ov


# ---------------------------------------------------------------------------
# Bulk API sender (same pattern as other extractor scripts)
# ---------------------------------------------------------------------------

def post_entities_bulk(
    api_bulk_url: str,
    api_key: str,
    entities: List[Dict[str, Any]],
    chunk_size: int,
) -> Dict[str, int]:
    """Send entities in chunks via POST /entities/bulk and return aggregate counts."""
    headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
    totals = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}

    for start in range(0, len(entities), chunk_size):
        chunk = entities[start : start + chunk_size]
        end_idx = min(start + chunk_size, len(entities))
        print(f"  Chunk [{start + 1}–{end_idx}] ({len(chunk)} items)… ", end="", flush=True)
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
            print(f"FAILED: {exc}")

    return totals


# ---------------------------------------------------------------------------
# Settings loader
# ---------------------------------------------------------------------------

def load_settings() -> Tuple[str, str]:
    env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(dotenv_path=env_path)
    base_url = os.environ.get("API_BASE_URL", "https://concierge-collector.onrender.com/api/v3")
    api_key  = os.environ.get("API_KEY", "")
    if not api_key:
        raise RuntimeError("API_KEY not set. Add it to .env as API_KEY=<your_key>")
    return base_url.rstrip("/") + "/entities/bulk", api_key


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    args = parse_args()

    print("Restaurant Dataset Merger (OSM + Overture Maps)")
    print("=" * 60)

    # ── Load inputs ───────────────────────────────────────────────────────────
    osm_path = Path(args.osm)
    ov_path  = Path(args.overture)

    for path in (osm_path, ov_path):
        if not path.exists():
            print(f"ERROR: File not found: {path}")
            return 1

    print(f"OSM input:      {osm_path}")
    print(f"Overture input: {ov_path}")
    print(f"Mode:           {'APPLY' if args.apply else 'dry-run'}")
    print()

    print("Loading datasets…", flush=True)
    with osm_path.open(encoding="utf-8") as fh:
        osm_entities: List[Dict[str, Any]] = json.load(fh)
    print(f"  OSM:      {len(osm_entities):,} entities")

    with ov_path.open(encoding="utf-8") as fh:
        ov_entities: List[Dict[str, Any]] = json.load(fh)
    print(f"  Overture: {len(ov_entities):,} entities")

    if args.min_overture_confidence > 0:
        before = len(ov_entities)
        ov_entities = [
            e for e in ov_entities
            if (e.get("data") or {}).get("confidence", 0.0) >= args.min_overture_confidence
        ]
        print(f"  Overture after confidence filter (≥{args.min_overture_confidence}): {len(ov_entities):,}"
              f" (dropped {before - len(ov_entities):,})")

    # ── Match ─────────────────────────────────────────────────────────────────
    print()
    matches, unmatched_osm_idx, unmatched_ov_idx = match_datasets(
        osm_entities, ov_entities,
        args.distance_threshold, args.name_threshold,
    )

    print()
    print("Match results:")
    print(f"  Matched pairs:      {len(matches):,}")
    print(f"  Unmatched OSM:      {len(unmatched_osm_idx):,}")
    print(f"  Unmatched Overture: {len(unmatched_ov_idx):,}")

    # ── Build merged list ─────────────────────────────────────────────────────
    merged: List[Dict[str, Any]] = []

    # 1. Matched: OSM enriched with Overture
    for osm_idx, ov_idx, score in matches:
        enriched = _enrich_osm_with_overture(osm_entities[osm_idx], ov_entities[ov_idx])
        merged.append(enriched)

    # 2. Unmatched OSM: unchanged
    for i in unmatched_osm_idx:
        merged.append(osm_entities[i])

    # 3. Unmatched Overture: added as new entries (unless --no-overture-only)
    ov_only_count = 0
    if not args.no_overture_only:
        for i in unmatched_ov_idx:
            merged.append(ov_entities[i])
            ov_only_count += 1

    print()
    print(f"Merged total:       {len(merged):,}")
    print(f"  - OSM enriched:   {len(matches):,}")
    print(f"  - OSM-only:       {len(unmatched_osm_idx):,}")
    print(f"  - Overture-only:  {ov_only_count:,}")

    # ── Field coverage comparison ─────────────────────────────────────────────
    def count_field(entities: List[Dict[str, Any]], *keys: str) -> int:
        """Count entities that have a non-empty value at data[keys[0]][keys[1]]..."""
        n = 0
        for e in entities:
            obj: Any = e.get("data") or {}
            for k in keys:
                if not isinstance(obj, dict):
                    obj = None
                    break
                obj = obj.get(k)
            if obj:
                n += 1
        return n

    total_m = len(merged)

    def pct(n: int) -> str:
        return f"{n:>8,}  ({n * 100 // total_m if total_m else 0}%)"

    print()
    print("Field coverage in merged dataset:")
    print(f"  coordinates: {pct(count_field(merged, 'location', 'coordinates'))}")
    print(f"  postal_code: {pct(count_field(merged, 'location', 'postal_code'))}")
    print(f"  phone:       {pct(count_field(merged, 'contact', 'phone'))}")
    print(f"  email:       {pct(count_field(merged, 'contact', 'email'))}")
    print(f"  website:     {pct(count_field(merged, 'contact', 'website'))}")
    print(f"  facebook:    {pct(count_field(merged, 'contact', 'facebook'))}")
    print(f"  instagram:   {pct(count_field(merged, 'contact', 'instagram'))}")
    print(f"  cuisine:     {pct(count_field(merged, 'cuisine'))}")
    print(f"  opening_hrs: {pct(count_field(merged, 'opening_hours'))}")

    # ── Save output ───────────────────────────────────────────────────────────
    if args.output != "-":
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("w", encoding="utf-8") as fh:
            json.dump(merged, fh, ensure_ascii=False, indent=2)
        size_mb = out_path.stat().st_size / 1024 / 1024
        print(f"\nSaved: {out_path}  ({size_mb:.1f} MB)")

    # ── Import ────────────────────────────────────────────────────────────────
    if args.apply:
        try:
            api_bulk_url, api_key = load_settings()
        except RuntimeError as exc:
            print(f"ERROR: {exc}")
            return 1

        print(f"\nPushing {len(merged):,} entities to {api_bulk_url}")
        print(f"Chunk size: {args.chunk_size}")
        print()

        totals = post_entities_bulk(api_bulk_url, api_key, merged, args.chunk_size)

        print()
        print("=== Import summary ===")
        print(f"  Created: {totals['created']:,}")
        print(f"  Updated: {totals['updated']:,}")
        print(f"  Skipped: {totals['skipped']:,}")
        print(f"  Errors:  {totals['errors']:,}")
    else:
        print("\n(Add --apply to send merged entities to the API)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
