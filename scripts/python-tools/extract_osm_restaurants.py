#!/usr/bin/env python3
"""
File: extract_osm_restaurants.py
Purpose: Extract restaurant (and similar venue) data from OpenStreetMap via Overpass API
         and bulk-import into the Concierge Collector API v3.
Dependencies: requests, python-dotenv

Main Responsibilities:
- Build and execute Overpass QL queries for amenity=restaurant|cafe|bar|pub|fast_food
- Support area search by city name OR by explicit bounding box (south,west,north,east)
- Normalize OSM element tags to the API v3 EntityCreate schema
- Support dry-run preview (default) and --apply mode
- Bulk-import via POST /entities/bulk in configurable chunk sizes
- Optionally save normalized entities to a JSON file

Usage examples:
    # Dry-run for São Paulo (shows first 5 results)
    python scripts/python-tools/extract_osm_restaurants.py --city "São Paulo"

    # Apply import for São Paulo
    python scripts/python-tools/extract_osm_restaurants.py --city "São Paulo" --apply

    # Bounding box (south,west,north,east) — precise geographic area
    python scripts/python-tools/extract_osm_restaurants.py \\
        --bbox "-23.70,-46.82,-23.51,-46.57" --apply

    # Only restaurants (skip cafe/bar), save to JSON, then import
    python scripts/python-tools/extract_osm_restaurants.py \\
        --city "São Paulo" --amenity restaurant \\
        --output /tmp/sp_restaurants.json --apply

    # Test with first 50 results
    python scripts/python-tools/extract_osm_restaurants.py \\
        --city "Rio de Janeiro" --limit 50 --apply
"""

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from dotenv import load_dotenv


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
DEFAULT_AMENITIES = ["restaurant", "cafe", "bar", "pub", "fast_food"]

# Respectful delay between Overpass requests (seconds).
# Overpass is a volunteer-run public service — do not hammer it.
OVERPASS_REQUEST_DELAY = 3

# Overpass servers require a descriptive User-Agent; generic/missing UA returns 406.
OVERPASS_HEADERS = {
    "User-Agent": "ConciergeCollector/1.0 (restaurant data import; https://github.com/wsmontes/Concierge-Collector)"
}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract OSM restaurant data and import into API v3",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    area_group = parser.add_mutually_exclusive_group(required=True)
    area_group.add_argument(
        "--city", metavar="NAME",
        help='City/area name for Overpass area search (e.g., "São Paulo")',
    )
    area_group.add_argument(
        "--bbox", metavar="S,W,N,E",
        help="Bounding box as south,west,north,east (e.g., -23.70,-46.82,-23.51,-46.57)",
    )

    parser.add_argument(
        "--state", metavar="NAME",
        help='State to narrow city search (e.g., "São Paulo"). Ignored with --bbox.',
    )
    parser.add_argument(
        "--amenity",
        nargs="+",
        default=DEFAULT_AMENITIES,
        metavar="TYPE",
        help=f"OSM amenity types to fetch (default: {' '.join(DEFAULT_AMENITIES)})",
    )
    parser.add_argument(
        "--limit", type=int, default=0,
        help="Cap results at N elements before normalizing (0 = all)",
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="Send to API. Without this flag the script runs as dry-run.",
    )
    parser.add_argument(
        "--chunk-size", type=int, default=200,
        help="Entities per bulk API request (default: 200)",
    )
    parser.add_argument(
        "--output", type=Path, default=None,
        help="Save normalized entities to this JSON file (optional)",
    )
    parser.add_argument(
        "--timeout", type=int, default=120,
        help="Overpass query timeout in seconds (default: 120)",
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# API credentials
# ---------------------------------------------------------------------------

def find_env_file() -> Path:
    here = Path(__file__).resolve()
    candidates = [
        here.parents[2] / "concierge-api-v3" / ".env",
        here.parents[2] / ".env",
        Path.cwd() / ".env",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def load_settings() -> Tuple[str, str]:
    load_dotenv(find_env_file())
    api_base_url = os.getenv("API_BASE_URL", "https://concierge-collector.onrender.com").rstrip("/")
    api_key = os.getenv("API_SECRET_KEY")
    if not api_key:
        raise RuntimeError("API_SECRET_KEY not found in .env")
    return api_base_url, api_key


# ---------------------------------------------------------------------------
# Overpass query builder & fetcher
# ---------------------------------------------------------------------------

def build_overpass_query(
    amenities: List[str],
    city: Optional[str] = None,
    state: Optional[str] = None,
    bbox: Optional[str] = None,
    timeout: int = 120,
) -> str:
    """Build an Overpass QL query string for the requested amenity types and area.

    Two modes:
    - bbox: direct coordinate filter — most precise and fastest
    - city name: area lookup by name; --state is used only as display hint
      (OSM area-within-area nesting is unreliable across regions)
    """
    amenity_regex = "|".join(amenities)
    filter_expr = f'["amenity"~"^({amenity_regex})$"]'

    if bbox:
        parts = [p.strip() for p in bbox.split(",")]
        if len(parts) != 4:
            raise ValueError("--bbox must be exactly 4 comma-separated values: south,west,north,east")
        bbox_str = ",".join(parts)
        return (
            f"[out:json][timeout:{timeout}];\n"
            f"(\n"
            f"  nwr{filter_expr}({bbox_str});\n"
            f");\n"
            f"out center tags;"
        )

    # Area-based query: match the city/neighborhood by name only.
    # OSM admin_level varies by country; using a wide range avoids misses.
    return (
        f'[out:json][timeout:{timeout}];\n'
        f'area["name"="{city}"]->.searchArea;\n'
        f"(\n"
        f"  nwr{filter_expr}(area.searchArea);\n"
        f");\n"
        f"out center tags;"
    )


def fetch_overpass(query: str) -> List[Dict[str, Any]]:
    """Execute the Overpass query via GET and return the elements list.

    Uses GET (not POST) to avoid Apache content-negotiation issues.
    A descriptive User-Agent is required by public Overpass instances.
    """
    print(f"  Querying Overpass API (this can take 10–60 s for large cities)…")
    time.sleep(OVERPASS_REQUEST_DELAY)  # be polite to the public server

    response = requests.get(
        OVERPASS_URL,
        params={"data": query},
        headers=OVERPASS_HEADERS,
        timeout=300,  # network timeout — separate from Overpass query timeout
    )
    response.raise_for_status()
    data = response.json()
    elements = data.get("elements", [])
    print(f"  → {len(elements)} elements returned by Overpass")
    return elements


# ---------------------------------------------------------------------------
# OSM element normalizer → API v3 EntityCreate schema
# ---------------------------------------------------------------------------

def _split_tag(raw: str) -> List[str]:
    """Split an OSM multi-value tag (separated by ; or ,) into a list."""
    if not raw:
        return []
    parts = raw.replace(";", ",").split(",")
    return [p.strip() for p in parts if p.strip()]


def _build_address(tags: Dict[str, str]) -> Optional[str]:
    street = tags.get("addr:street", "").strip()
    number = tags.get("addr:housenumber", "").strip()
    if street and number:
        return f"{street}, {number}"
    return street or None


def normalize_element(
    element: Dict[str, Any],
    city_hint: Optional[str],
) -> Optional[Dict[str, Any]]:
    """Convert a single OSM element dict to the API v3 EntityCreate schema.

    Returns None if the element has no usable name (unnamed venues are skipped).
    """
    tags = element.get("tags", {})
    name = tags.get("name", "").strip()
    if not name:
        return None  # unnamed venues are not useful

    osm_type = element.get("type", "node")  # node | way | relation
    osm_id = element.get("id")
    # Prefix: n = node, w = way, r = relation — avoids ID collisions across types
    prefix = {"node": "n", "way": "w", "relation": "r"}.get(osm_type, "n")
    entity_id = f"osm_{prefix}_{osm_id}"

    # Coordinates: nodes expose lat/lon directly; ways/relations have a center point
    center = element.get("center", {})
    lat = element.get("lat") or center.get("lat")
    lon = element.get("lon") or center.get("lon")

    amenity = tags.get("amenity", "restaurant")
    city = tags.get("addr:city", "").strip() or city_hint or None
    state_tag = tags.get("addr:state", "").strip() or None
    country = tags.get("addr:country", "BR").strip() or "BR"
    postal_code = tags.get("addr:postcode", "").strip() or None
    address = _build_address(tags)
    phone = (tags.get("phone") or tags.get("contact:phone") or "").strip() or None
    website = (tags.get("website") or tags.get("contact:website") or "").strip() or None
    opening_hours = tags.get("opening_hours", "").strip() or None
    description = tags.get("description", "").strip() or None
    cuisine = _split_tag(tags.get("cuisine", ""))
    stars_raw = tags.get("stars") or tags.get("michelin:stars")

    # --- Build nested data dict ---
    data: Dict[str, Any] = {
        "amenity": amenity,
        "osm_id": osm_id,
        "osm_type": osm_type,
        "source": "openstreetmap",
    }

    location: Dict[str, Any] = {}
    if city:
        location["city"] = city
    if state_tag:
        location["state"] = state_tag
    if country:
        location["country"] = country
    if postal_code:
        location["postal_code"] = postal_code
    if address:
        location["address"] = address
    if lat is not None and lon is not None:
        location["coordinates"] = {"lat": lat, "lng": lon}
    if location:
        data["location"] = location

    contact: Dict[str, Any] = {}
    if phone:
        contact["phone"] = phone
    if website:
        contact["website"] = website
    if contact:
        data["contact"] = contact

    if cuisine:
        data["cuisine"] = cuisine
    if opening_hours:
        data["opening_hours"] = opening_hours
    if description:
        data["description"] = description
    if stars_raw:
        try:
            data["stars"] = int(stars_raw)
        except (ValueError, TypeError):
            data["stars"] = stars_raw

    return {
        "entity_id": entity_id,
        "type": "restaurant",
        "name": name,
        "status": "active",
        "data": data,
    }


# ---------------------------------------------------------------------------
# Bulk API sender
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
        chunk = entities[start:start + chunk_size]
        end_idx = min(start + chunk_size, len(entities))
        print(f"  Chunk [{start + 1}–{end_idx}] ({len(chunk)} items)… ", end="", flush=True)
        try:
            response = requests.post(
                api_bulk_url,
                json={"entities": chunk},
                headers=headers,
                timeout=120,
            )
            response.raise_for_status()
            result = response.json()
            c = result.get("created", 0)
            u = result.get("updated", 0)
            s = result.get("skipped", 0)
            e = len(result.get("errors", []))
            totals["created"] += c
            totals["updated"] += u
            totals["skipped"] += s
            totals["errors"] += e
            print(f"created={c} updated={u} skipped={s} errors={e}")
            for err in result.get("errors", []):
                print(f"    [item {err.get('index', '?')}] {err.get('error', 'unknown')}")
        except Exception as exc:
            totals["errors"] += len(chunk)
            print(f"FAILED: {exc}")

    return totals


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    args = parse_args()

    print("OpenStreetMap Restaurant Extractor")
    print("=" * 60)

    if args.city:
        location_label = args.city + (f", {args.state}" if args.state else "")
    else:
        location_label = f"bbox={args.bbox}"
    print(f"Area:      {location_label}")
    print(f"Amenities: {', '.join(args.amenity)}")
    print(f"Mode:      {'APPLY' if args.apply else 'DRY-RUN'}")

    # Build Overpass query
    try:
        query = build_overpass_query(
            amenities=args.amenity,
            city=args.city,
            state=args.state,
            bbox=args.bbox,
            timeout=args.timeout,
        )
    except ValueError as exc:
        print(f"ERROR: {exc}")
        return 1

    # Fetch from Overpass
    try:
        elements = fetch_overpass(query)
    except requests.HTTPError as exc:
        print(f"Overpass API HTTP error: {exc}")
        return 1
    except requests.Timeout:
        print("Overpass API timed out. Try reducing the area or increasing --timeout.")
        return 1
    except Exception as exc:
        print(f"Failed to fetch OSM data: {exc}")
        return 1

    if not elements:
        print("No elements returned. Check the city name or bounding box.")
        return 0

    if args.limit > 0:
        elements = elements[:args.limit]
        print(f"  Capped at first {args.limit} elements (--limit)")

    # Normalize
    normalized: List[Dict[str, Any]] = []
    skipped_no_name = 0
    for element in elements:
        entity = normalize_element(element, city_hint=args.city)
        if entity:
            normalized.append(entity)
        else:
            skipped_no_name += 1

    print(f"\nNormalized: {len(normalized)} entities | Skipped (no name): {skipped_no_name}")

    # Save to file if requested
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(normalized, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"Saved to {args.output}")

    # Dry-run preview
    if not args.apply:
        preview_count = min(5, len(normalized))
        print(f"\nPreview (first {preview_count}):")
        for entity in normalized[:preview_count]:
            loc = entity.get("data", {}).get("location", {})
            city_out = loc.get("city", "?")
            cuisine = ", ".join(entity.get("data", {}).get("cuisine", []) or ["—"])
            coords = loc.get("coordinates", {})
            lat = coords.get("lat", "?")
            lng = coords.get("lng", "?")
            print(
                f"  {entity['entity_id']} | {entity['name']}"
                f" | city={city_out} | cuisine={cuisine}"
                f" | coords=({lat}, {lng})"
            )
        if len(normalized) > preview_count:
            print(f"  … and {len(normalized) - preview_count} more")
        print(f"\nDry-run complete. Use --apply to send to the API.")
        return 0

    # Load credentials and send
    try:
        api_base_url, api_key = load_settings()
    except Exception as exc:
        print(f"ERROR: {exc}")
        return 1

    api_bulk_url = f"{api_base_url}/api/v3/entities/bulk"
    print(f"\nSending {len(normalized)} entities to {api_bulk_url}…")
    totals = post_entities_bulk(api_bulk_url, api_key, normalized, args.chunk_size)

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"OSM elements fetched:  {len(elements)}")
    print(f"Normalized:            {len(normalized)}")
    print(f"Skipped (no name):     {skipped_no_name}")
    print(f"Created in API:        {totals['created']}")
    print(f"Updated in API:        {totals['updated']}")
    print(f"Skipped (duplicate):   {totals['skipped']}")
    print(f"Errors:                {totals['errors']}")

    return 0 if totals["errors"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
