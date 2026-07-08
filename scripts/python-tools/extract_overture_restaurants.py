#!/usr/bin/env python3
"""
File: extract_overture_restaurants.py
Purpose: Parse a locally downloaded Overture Maps places GeoJSON file, filter to
         food_and_drink venues, normalize to the API v3 EntityCreate schema,
         and optionally bulk-import into the Concierge Collector API v3.
Dependencies: requests, python-dotenv

Main Responsibilities:
- Filter features by taxonomy.hierarchy containing "food_and_drink"
- Normalize Overture feature properties to the API v3 EntityCreate schema
- Classify social/website URLs (Facebook, Instagram, iFood, real website)
- Support dry-run preview (default) and --apply import mode
- Bulk-import via POST /entities/bulk in configurable chunk sizes
- Save normalized entities to a JSON file for downstream merge pipeline

Usage examples:
    # Dry-run (preview first 5 results, no API call)
    python scripts/python-tools/extract_overture_restaurants.py

    # Custom input file, save output, then import
    python scripts/python-tools/extract_overture_restaurants.py \\
        --input data/sp_overture_places.geojson \\
        --output data/sp_restaurants_overture.json \\
        --apply

    # Only high-confidence venues (≥ 0.7), dry-run first 10
    python scripts/python-tools/extract_overture_restaurants.py \\
        --min-confidence 0.7 --limit 10

    # Import with smaller chunks (useful if API rate-limits)
    python scripts/python-tools/extract_overture_restaurants.py \\
        --apply --chunk-size 100
"""

import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from dotenv import load_dotenv


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_INPUT  = "data/sp_overture_places.geojson"
DEFAULT_OUTPUT = "data/sp_restaurants_overture.json"
DEFAULT_CHUNK  = 200

# Only import food_and_drink taxonomy — use broad filter so bars, cafes, bakeries
# are all included along with dedicated restaurant categories.
FOOD_TAXONOMY = "food_and_drink"

# Maps Overture primary category values to the API v3 EntityType literals.
# Only "bar" and "cafe" get distinct types; everything else stays "restaurant".
_CATEGORY_TO_ENTITY_TYPE: Dict[str, str] = {
    "bar": "bar",
    "pub": "bar",
    "sports_bar": "bar",
    "wine_bar": "bar",
    "cocktail_bar": "bar",
    "beer_garden": "bar",
    "biergarten": "bar",
    "cafe": "cafe",
    "coffee_shop": "cafe",
    "tea_house": "cafe",
}


def _entity_type(primary_category: str) -> str:
    """Return the API v3 EntityType string for an Overture primary category."""
    return _CATEGORY_TO_ENTITY_TYPE.get((primary_category or "").lower(), "restaurant")

# Social/website URL classifiers
_SOCIAL_MAP = {
    "facebook.com": "facebook",
    "instagram.com": "instagram",
    "twitter.com": "twitter",
    "x.com": "twitter",
    "tiktok.com": "tiktok",
    "youtube.com": "youtube",
    "linkedin.com": "linkedin",
    "whatsapp.com": "whatsapp",
}

# Delivery / menu platforms are kept as a separate field, not as the main website
_DELIVERY_HOSTS = {
    "ifood.com.br", "rappi.com", "aiqfome.com", "uber.com",
    "goomer.app", "cardapio.menu", "loggi.com",
}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Normalize Overture Maps places GeoJSON → API v3 entities",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--input", metavar="PATH", default=DEFAULT_INPUT,
        help=f"Path to Overture GeoJSON file (default: {DEFAULT_INPUT})",
    )
    parser.add_argument(
        "--output", metavar="PATH", default=None,
        help=f"Path to write normalized entities JSON (default: {DEFAULT_OUTPUT}). "
             "Pass - to disable file output.",
    )
    parser.add_argument(
        "--min-confidence", type=float, default=0.0, metavar="FLOAT",
        help="Minimum Overture confidence score to include (0.0–1.0, default: 0.0)",
    )
    parser.add_argument(
        "--limit", type=int, default=0, metavar="N",
        help="Process only the first N food venues (0 = no limit)",
    )
    parser.add_argument(
        "--apply", action="store_true",
        help="Send entities to API. Without this flag, the script is a dry-run.",
    )
    parser.add_argument(
        "--chunk-size", type=int, default=DEFAULT_CHUNK, dest="chunk_size",
        help=f"Entities per bulk API request (default: {DEFAULT_CHUNK})",
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# URL classifier helpers
# ---------------------------------------------------------------------------

def _classify_social(url: str) -> Tuple[str, str]:
    """Return (platform_key, url) for a social media URL.

    platform_key is one of the _SOCIAL_MAP keys or 'other'.
    """
    lower = url.lower()
    for domain, platform in _SOCIAL_MAP.items():
        if domain in lower:
            return platform, url
    return "other", url


def _classify_website(url: str) -> str:
    """Return 'delivery', 'instagram', 'facebook', or 'website' for a URL."""
    lower = url.lower()
    for host in _DELIVERY_HOSTS:
        if host in lower:
            return "delivery"
    if "instagram.com" in lower:
        return "instagram"
    if "facebook.com" in lower:
        return "facebook"
    return "website"


# ---------------------------------------------------------------------------
# Normalizer → API v3 EntityCreate schema
# ---------------------------------------------------------------------------

def normalize_feature(feature: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Convert a single Overture GeoJSON feature to the API v3 EntityCreate schema.

    Returns None if the feature has no usable name (unnamed venues are skipped).
    Also returns None if the feature is not in the food_and_drink taxonomy.
    """
    props = feature.get("properties", {}) or {}

    # ── Taxonomy filter ────────────────────────────────────────────────────────
    taxonomy = (props.get("taxonomy") or {})
    hierarchy = taxonomy.get("hierarchy") or []
    if FOOD_TAXONOMY not in hierarchy:
        return None

    # ── Name ──────────────────────────────────────────────────────────────────
    name = (props.get("names") or {}).get("primary") or ""
    name = name.strip()
    if not name:
        return None  # unnamed venues are not useful

    # ── ID ────────────────────────────────────────────────────────────────────
    overture_id = feature.get("id", "")
    entity_id = "overture_" + overture_id.replace("-", "")

    # ── Geometry ──────────────────────────────────────────────────────────────
    geometry = feature.get("geometry") or {}
    coords = geometry.get("coordinates") or []
    lat: Optional[float] = None
    lng: Optional[float] = None
    if geometry.get("type") == "Point" and len(coords) >= 2:
        lng, lat = coords[0], coords[1]  # GeoJSON is [lng, lat]

    # ── Address ───────────────────────────────────────────────────────────────
    addresses = props.get("addresses") or []
    addr_obj = addresses[0] if addresses else {}
    address     = (addr_obj.get("freeform") or "").strip() or None
    city        = (addr_obj.get("locality") or "").strip() or None
    state       = (addr_obj.get("region") or "").strip() or None
    country     = (addr_obj.get("country") or "BR").strip() or "BR"
    postal_code = (addr_obj.get("postcode") or "").strip() or None

    location: Dict[str, Any] = {}
    if lat is not None and lng is not None:
        location["coordinates"] = {"lat": lat, "lng": lng}
    if address:
        location["address"] = address
    if city:
        location["city"] = city
    if state:
        location["state"] = state
    if country:
        location["country"] = country
    if postal_code:
        location["postal_code"] = postal_code

    # ── Contact ───────────────────────────────────────────────────────────────
    contact: Dict[str, Any] = {}

    phones = [p for p in (props.get("phones") or []) if p]
    if phones:
        # Store primary phone as string, additional as list
        contact["phone"] = phones[0]
        if len(phones) > 1:
            contact["phones_extra"] = phones[1:]

    emails = [e for e in (props.get("emails") or []) if e]
    if emails:
        contact["email"] = emails[0]

    # Websites: separate real sites from delivery platforms and misplaced socials
    websites_raw = [w for w in (props.get("websites") or []) if w]
    real_websites: List[str] = []
    delivery_links: List[str] = []
    for w in websites_raw:
        kind = _classify_website(w)
        if kind == "website":
            real_websites.append(w)
        elif kind == "delivery":
            delivery_links.append(w)
        elif kind == "instagram" and "instagram" not in contact:
            contact["instagram"] = w
        elif kind == "facebook" and "facebook" not in contact:
            contact["facebook"] = w

    if real_websites:
        contact["website"] = real_websites[0]
        if len(real_websites) > 1:
            contact["websites_extra"] = real_websites[1:]
    if delivery_links:
        contact["delivery_links"] = delivery_links

    # Socials: Facebook, Instagram, Twitter, etc.
    for social_url in (props.get("socials") or []):
        if not social_url:
            continue
        platform, url = _classify_social(social_url)
        if platform in ("facebook", "instagram", "twitter", "tiktok") and platform not in contact:
            contact[platform] = url
        # other platforms are not stored to keep schema lean

    # ── Categories ────────────────────────────────────────────────────────────
    categories_obj = props.get("categories") or {}
    primary_cat   = categories_obj.get("primary") or ""
    alternate_cats = [c for c in (categories_obj.get("alternate") or []) if c]

    # ── Brand ─────────────────────────────────────────────────────────────────
    brand_obj = props.get("brand") or {}
    brand_names = brand_obj.get("names") or {}
    brand_name = (brand_names.get("primary") or "").strip() or None
    brand_wikidata = (brand_obj.get("wikidata") or "").strip() or None

    # ── Sources ───────────────────────────────────────────────────────────────
    sources = props.get("sources") or []
    source_datasets = list({s.get("dataset") for s in sources if s.get("dataset")})

    # ── Confidence ────────────────────────────────────────────────────────────
    confidence = props.get("confidence")

    # ── Assemble data dict ────────────────────────────────────────────────────
    data: Dict[str, Any] = {
        "source": "overture",
        "overture_id": overture_id,
        "category": primary_cat,
        "category_hierarchy": hierarchy,
    }

    if alternate_cats:
        data["category_alternate"] = alternate_cats

    if confidence is not None:
        data["confidence"] = round(confidence, 4)

    if source_datasets:
        data["overture_sources"] = source_datasets

    if location:
        data["location"] = location

    if contact:
        data["contact"] = contact

    if brand_name:
        data["brand"] = brand_name
    if brand_wikidata:
        data["brand_wikidata"] = brand_wikidata

    return {
        "entity_id": entity_id,
        "type": _entity_type(primary_cat),
        "name": name,
        "status": "active",
        "data": data,
    }


# ---------------------------------------------------------------------------
# Bulk API sender (same pattern as extract_osm_restaurants.py)
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
# Settings loader
# ---------------------------------------------------------------------------

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
    """Load API base URL and API key from .env file.

    Returns (api_bulk_url, api_key).
    """
    load_dotenv(_find_env_file())

    base_url = os.environ.get("API_BASE_URL", "https://concierge-collector.onrender.com/api/v3")
    api_key  = os.environ.get("API_SECRET_KEY", "")
    if not api_key:
        raise RuntimeError(
            "API_SECRET_KEY not set. Add it to concierge-api-v3/.env"
        )
    bulk_url = base_url.rstrip("/") + "/entities/bulk"
    return bulk_url, api_key


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    args = parse_args()

    print("Overture Maps Restaurant Extractor")
    print("=" * 60)

    # ── Load GeoJSON ──────────────────────────────────────────────────────────
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"ERROR: Input file not found: {input_path}")
        print("  Run: overturemaps download --bbox=<west,south,east,north> -f geojson --type=place -o data/sp_overture_places.geojson")
        return 1

    print(f"Input:     {input_path}")
    print(f"Loading…", end="", flush=True)
    with input_path.open(encoding="utf-8") as fh:
        raw = json.load(fh)
    features = raw.get("features", raw) if isinstance(raw, dict) else raw
    print(f" {len(features):,} features loaded")

    # ── Filter & normalize ────────────────────────────────────────────────────
    print(f"Filter:    taxonomy = {FOOD_TAXONOMY}")
    if args.min_confidence > 0:
        print(f"Min confidence: {args.min_confidence}")
    print()

    entities: List[Dict[str, Any]] = []
    skipped_unnamed = 0
    skipped_non_food = 0
    skipped_confidence = 0

    for feature in features:
        props = feature.get("properties", {}) or {}
        taxonomy = (props.get("taxonomy") or {})
        hierarchy = taxonomy.get("hierarchy") or []

        if FOOD_TAXONOMY not in hierarchy:
            skipped_non_food += 1
            continue

        conf = props.get("confidence") or 0.0
        if conf < args.min_confidence:
            skipped_confidence += 1
            continue

        entity = normalize_feature(feature)
        if entity is None:
            skipped_unnamed += 1
            continue

        entities.append(entity)
        if args.limit and len(entities) >= args.limit:
            break

    print(f"Results:")
    print(f"  Food venues found:   {len(entities):,}")
    print(f"  Skipped (non-food):  {skipped_non_food:,}")
    print(f"  Skipped (unnamed):   {skipped_unnamed:,}")
    if skipped_confidence:
        print(f"  Skipped (low-conf):  {skipped_confidence:,}")

    if not entities:
        print("\nNo entities to process.")
        return 0

    # ── Field coverage summary ────────────────────────────────────────────────
    total = len(entities)
    has_coords   = sum(1 for e in entities if e["data"].get("location", {}).get("coordinates"))
    has_postcode = sum(1 for e in entities if e["data"].get("location", {}).get("postal_code"))
    has_phone    = sum(1 for e in entities if e["data"].get("contact", {}).get("phone"))
    has_email    = sum(1 for e in entities if e["data"].get("contact", {}).get("email"))
    has_website  = sum(1 for e in entities if e["data"].get("contact", {}).get("website"))
    has_facebook = sum(1 for e in entities if e["data"].get("contact", {}).get("facebook"))
    has_instagram= sum(1 for e in entities if e["data"].get("contact", {}).get("instagram"))
    high_conf    = sum(1 for e in entities if (e["data"].get("confidence") or 0) >= 0.7)

    def pct(n: int) -> str:
        return f"{n:>8,}  ({n * 100 // total}%)"

    print()
    print("Field coverage:")
    print(f"  coordinates: {pct(has_coords)}")
    print(f"  postal_code: {pct(has_postcode)}")
    print(f"  phone:       {pct(has_phone)}")
    print(f"  email:       {pct(has_email)}")
    print(f"  website:     {pct(has_website)}")
    print(f"  facebook:    {pct(has_facebook)}")
    print(f"  instagram:   {pct(has_instagram)}")
    print(f"  conf ≥ 0.7:  {pct(high_conf)}")

    # ── Preview (dry-run) ─────────────────────────────────────────────────────
    if not args.apply:
        print()
        print("=== DRY-RUN: first 3 entities ===")
        for e in entities[:3]:
            print(json.dumps(e, indent=2, ensure_ascii=False))
            print()
        print("(Add --apply to send to API)")
        mode_label = "dry-run"
    else:
        mode_label = "APPLY"

    print(f"\nMode: {mode_label}")

    # ── Save output file ──────────────────────────────────────────────────────
    output_path = None
    if args.output != "-":
        output_path = Path(args.output) if args.output else Path(DEFAULT_OUTPUT)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("w", encoding="utf-8") as fh:
            json.dump(entities, fh, ensure_ascii=False, indent=2)
        print(f"Saved:     {output_path}  ({output_path.stat().st_size / 1024 / 1024:.1f} MB)")

    # ── Import ────────────────────────────────────────────────────────────────
    if args.apply:
        try:
            api_bulk_url, api_key = load_settings()
        except RuntimeError as exc:
            print(f"ERROR: {exc}")
            return 1

        print(f"\nPushing {len(entities):,} entities to {api_bulk_url}")
        print(f"Chunk size: {args.chunk_size}")
        print()

        totals = post_entities_bulk(api_bulk_url, api_key, entities, args.chunk_size)

        print()
        print("=== Import summary ===")
        print(f"  Created: {totals['created']:,}")
        print(f"  Updated: {totals['updated']:,}")
        print(f"  Skipped: {totals['skipped']:,}")
        print(f"  Errors:  {totals['errors']:,}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
