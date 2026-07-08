#!/usr/bin/env python3
"""
File: import_curations.py
Purpose: Import curation documents from JSON into API v3 with schema normalization.
Dependencies: requests, python-dotenv

Main Responsibilities:
- Read curation JSON in object/array/wrapper formats
- Normalize legacy curation fields to API v3 contract
- Support dry-run preview and apply mode for real import
- Send curations in bulk batches via POST /curations/bulk (default)
- Fall back to one-by-one POST /curations via --no-bulk flag
- Report per-item and aggregate import results
"""

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import requests
from dotenv import load_dotenv


class Colors:
    HEADER = '\033[95m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'


def find_env_file() -> Path:
    """Locate .env file for API credentials."""
    here = Path(__file__).resolve()
    candidates = [
        here.parents[2] / 'concierge-api-v3' / '.env',
        here.parents[2] / '.env',
        Path.cwd() / '.env',
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def load_settings() -> Tuple[str, str]:
    """Load API base URL and API key from environment."""
    load_dotenv(find_env_file())
    api_base_url = os.getenv('API_BASE_URL', 'https://concierge-collector.onrender.com').rstrip('/')
    api_key = os.getenv('API_SECRET_KEY')
    if not api_key:
        raise RuntimeError('API_SECRET_KEY not found in .env')
    return api_base_url, api_key


def load_input_data(input_file: Path) -> List[Dict[str, Any]]:
    """Load curations from file, supporting object/list/wrapped list structures."""
    payload = json.loads(input_file.read_text(encoding='utf-8'))

    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]

    if isinstance(payload, dict):
        if 'items' in payload and isinstance(payload['items'], list):
            return [item for item in payload['items'] if isinstance(item, dict)]
        if 'curations' in payload and isinstance(payload['curations'], list):
            return [item for item in payload['curations'] if isinstance(item, dict)]
        return [payload]

    raise ValueError('Unsupported JSON format. Expected object, list, or wrapper with items/curations.')


def clean_categories(raw_categories: Any) -> Dict[str, List[str]]:
    """Keep only valid category arrays of non-empty strings."""
    if not isinstance(raw_categories, dict):
        return {}

    cleaned: Dict[str, List[str]] = {}
    for key, values in raw_categories.items():
        if not isinstance(values, list):
            continue
        normalized_values = []
        for value in values:
            if isinstance(value, str):
                candidate = value.strip()
                if candidate:
                    normalized_values.append(candidate)
        if normalized_values:
            cleaned[key] = normalized_values
    return cleaned


def extract_categories_from_legacy(raw: Dict[str, Any]) -> Dict[str, List[str]]:
    """Extract categories from legacy format where categories are top-level keys."""
    reserved_keys = {
        'metadata',
        'curation_id',
        '_id',
        'curator_id',
        'curator',
        'status',
        'notes',
        'sources',
        'items',
        'entity_id',
        'restaurant_name',
        'name',
        'transcript',
        'unstructured_text',
        'transcription',
        'createdAt',
        'updatedAt',
        'version',
    }

    candidate_categories: Dict[str, Any] = {}
    for key, value in raw.items():
        if key in reserved_keys:
            continue
        candidate_categories[key] = value

    return clean_categories(candidate_categories)


def normalize_sources(raw_sources: Any) -> Dict[str, Any]:
    """Normalize legacy/list sources into structured source dictionary."""
    if isinstance(raw_sources, dict):
        return raw_sources

    if isinstance(raw_sources, list):
        source_entries = []
        for source in raw_sources:
            if isinstance(source, str) and source.strip():
                source_entries.append({'source': source.strip()})
        if source_entries:
            return {'import': source_entries}

    return {'manual': [{'source': 'import_curations.py'}]}


def resolve_transcript(raw: Dict[str, Any], sources: Dict[str, Any]) -> Any:
    """Resolve transcript from top-level fields or audio source fallback."""
    transcript = raw.get('transcript') or raw.get('unstructured_text') or raw.get('transcription')
    if transcript:
        return transcript

    metadata = raw.get('metadata')
    if isinstance(metadata, list):
        for entry in metadata:
            if not isinstance(entry, dict):
                continue
            data = entry.get('data')
            if not isinstance(data, dict):
                continue
            metadata_transcript = data.get('transcription') or data.get('transcript')
            if isinstance(metadata_transcript, str) and metadata_transcript.strip():
                return metadata_transcript.strip()

    audio_sources = sources.get('audio') if isinstance(sources, dict) else None
    if isinstance(audio_sources, list) and audio_sources:
        first_audio = audio_sources[0]
        if isinstance(first_audio, dict):
            return first_audio.get('transcript')
    return None


def resolve_restaurant_name(raw: Dict[str, Any]) -> Any:
    """Resolve curation display name from common fields."""
    candidate = raw.get('restaurant_name') or raw.get('name')
    if isinstance(candidate, str) and candidate.strip():
        return candidate.strip()

    metadata = raw.get('metadata')
    if isinstance(metadata, list):
        for entry in metadata:
            if not isinstance(entry, dict):
                continue
            data = entry.get('data')
            if not isinstance(data, dict):
                continue
            metadata_name = data.get('name')
            if isinstance(metadata_name, str) and metadata_name.strip():
                return metadata_name.strip()

    categories = raw.get('categories')
    if isinstance(categories, dict):
        category_name = categories.get('restaurant_name')
        if isinstance(category_name, list) and category_name:
            first = category_name[0]
            if isinstance(first, str) and first.strip():
                return first.strip()

    notes = raw.get('notes')
    if isinstance(notes, dict):
        public_note = notes.get('public')
        if isinstance(public_note, str):
            match = re.search(r'curated\s+concepts\s+for\s+(.+)$', public_note.strip(), re.IGNORECASE)
            if match:
                inferred_name = match.group(1).strip(' .')
                if inferred_name:
                    return inferred_name
    return None


def resolve_notes(raw: Dict[str, Any], restaurant_name: Any) -> Dict[str, Any]:
    """Resolve notes with fallback from legacy metadata description."""
    notes = raw.get('notes') if isinstance(raw.get('notes'), dict) else {}
    public_note = notes.get('public')
    private_note = notes.get('private')

    if not public_note:
        metadata = raw.get('metadata')
        if isinstance(metadata, list):
            for entry in metadata:
                if not isinstance(entry, dict):
                    continue
                data = entry.get('data')
                if not isinstance(data, dict):
                    continue
                description = data.get('description')
                if isinstance(description, str) and description.strip():
                    public_note = description.strip()
                    break

    if not public_note and isinstance(restaurant_name, str) and restaurant_name.strip():
        public_note = f'Curated concepts for {restaurant_name.strip()}'

    return {
        'public': public_note,
        'private': private_note,
    }


def resolve_sources(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve structured sources, including legacy metadata entries."""
    explicit_sources = normalize_sources(raw.get('sources'))

    metadata = raw.get('metadata')
    if not isinstance(metadata, list):
        return explicit_sources

    import_sources: List[Dict[str, Any]] = []
    for entry in metadata:
        if not isinstance(entry, dict):
            continue
        record: Dict[str, Any] = {}
        source_type = entry.get('type')
        source_name = entry.get('source')
        if isinstance(source_type, str) and source_type.strip():
            record['type'] = source_type.strip()
        if isinstance(source_name, str) and source_name.strip():
            record['source'] = source_name.strip()

        data = entry.get('data')
        if isinstance(data, dict):
            metadata_name = data.get('name')
            if isinstance(metadata_name, str) and metadata_name.strip():
                record['name'] = metadata_name.strip()

        if record:
            import_sources.append(record)

    if import_sources:
        explicit_sources.setdefault('import', [])
        if isinstance(explicit_sources['import'], list):
            explicit_sources['import'].extend(import_sources)

    return explicit_sources


def resolve_curation_id(raw: Dict[str, Any], restaurant_name: Any) -> str:
    """Resolve curation ID, generating stable ID for legacy inputs without one."""
    existing = raw.get('curation_id') or raw.get('_id')
    if isinstance(existing, str) and existing.strip():
        return existing.strip()

    if isinstance(restaurant_name, str) and restaurant_name.strip():
        digest = hashlib.md5(restaurant_name.strip().lower().encode('utf-8')).hexdigest()[:12]
        return f'curation-json-{digest}'

    raise ValueError('Missing curation_id/_id and restaurant name for ID generation')


def normalize_curation(raw: Dict[str, Any], default_curator_id: str, keep_entity_id: bool = False) -> Dict[str, Any]:
    """Normalize raw curation document into API v3 create contract."""
    curator = raw.get('curator') if isinstance(raw.get('curator'), dict) else {}
    curator_id = raw.get('curator_id') or curator.get('id') or default_curator_id
    curator_name = curator.get('name') or 'Import Script'

    restaurant_name = resolve_restaurant_name(raw)
    curation_id = resolve_curation_id(raw, restaurant_name)

    categories = clean_categories(raw.get('categories'))
    if not categories:
        categories = extract_categories_from_legacy(raw)
    if not categories:
        raise ValueError('Missing/invalid categories')

    sources = resolve_sources(raw)
    transcript = resolve_transcript(raw, sources)
    notes = resolve_notes(raw, restaurant_name)

    normalized: Dict[str, Any] = {
        'curation_id': curation_id,
        'curator_id': curator_id,
        'curator': {
            'id': curator_id,
            'name': curator_name,
            'email': curator.get('email'),
        },
        'status': 'draft',
        'notes': notes,
        'categories': categories,
        'sources': sources,
        'items': raw.get('items') if isinstance(raw.get('items'), list) else [],
    }

    if keep_entity_id and raw.get('entity_id'):
        normalized['entity_id'] = raw['entity_id']
    if restaurant_name:
        normalized['restaurant_name'] = restaurant_name
    if transcript:
        normalized['transcript'] = transcript

    return normalized


def post_curation(api_url: str, api_key: str, curation: Dict[str, Any]) -> Tuple[bool, str]:
    """Send one curation to API and return status/message."""
    headers = {
        'X-API-Key': api_key,
        'Content-Type': 'application/json',
    }
    response = requests.post(api_url, json=curation, headers=headers, timeout=30)
    if response.status_code == 201:
        return True, 'created'

    try:
        payload = response.json()
        detail = payload.get('detail', response.text[:300])
    except Exception:
        detail = response.text[:300]
    return False, f'HTTP {response.status_code}: {detail}'


def post_curations_bulk(
    api_bulk_url: str,
    api_key: str,
    curations: List[Dict[str, Any]],
    chunk_size: int,
) -> Dict[str, int]:
    """Send curations in bulk chunks via POST /curations/bulk.

    Returns aggregate counts: created, updated, skipped, errors.
    """
    headers = {'X-API-Key': api_key, 'Content-Type': 'application/json'}
    totals = {'created': 0, 'updated': 0, 'skipped': 0, 'errors': 0}

    for start in range(0, len(curations), chunk_size):
        chunk = curations[start:start + chunk_size]
        end_idx = min(start + chunk_size, len(curations))
        print(f"  Sending chunk [{start + 1}–{end_idx}] ({len(chunk)} items)…", end=' ', flush=True)
        try:
            response = requests.post(
                api_bulk_url,
                json={'curations': chunk},
                headers=headers,
                timeout=120,
            )
            response.raise_for_status()
            result = response.json()
            totals['created'] += result.get('created', 0)
            totals['updated'] += result.get('updated', 0)
            totals['skipped'] += result.get('skipped', 0)
            chunk_errors = len(result.get('errors', []))
            totals['errors'] += chunk_errors
            print(f"created={result.get('created', 0)} updated={result.get('updated', 0)} errors={chunk_errors}")
            if result.get('errors'):
                for err in result['errors']:
                    print(f"    [item {err.get('index', '?')}] {err.get('error', 'unknown error')}")
        except Exception as exc:
            totals['errors'] += len(chunk)
            print(f"FAILED: {exc}")

    return totals


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    default_input = Path(__file__).resolve().parents[2] / 'data' / 'curations.json'
    parser = argparse.ArgumentParser(description='Import curations JSON into API v3')
    parser.add_argument('--input', type=Path, default=default_input, help='Path to curations JSON file')
    parser.add_argument('--apply', action='store_true', help='Apply changes (default is dry-run)')
    parser.add_argument('--limit', type=int, default=0, help='Limit number of records processed (0 = all)')
    parser.add_argument('--default-curator-id', default='curator-import-script', help='Fallback curator_id')
    parser.add_argument('--keep-entity-id', action='store_true', help='Preserve entity_id from input (default: disabled)')
    parser.add_argument('--no-bulk', action='store_true', help='Use one-by-one POST instead of bulk endpoint')
    parser.add_argument('--chunk-size', type=int, default=200, help='Items per bulk request (default: 200)')
    return parser.parse_args()


def main() -> int:
    """Main execution flow for curation import."""
    print(f"{Colors.HEADER}{Colors.BOLD}Curation Import Tool (API v3){Colors.ENDC}")

    args = parse_args()
    if not args.input.exists():
        print(f"{Colors.FAIL}Input file not found: {args.input}{Colors.ENDC}")
        return 1

    try:
        api_base_url, api_key = load_settings()
    except Exception as error:
        print(f"{Colors.FAIL}{error}{Colors.ENDC}")
        return 1

    try:
        raw_items = load_input_data(args.input)
    except Exception as error:
        print(f"{Colors.FAIL}Failed to load JSON: {error}{Colors.ENDC}")
        return 1

    if args.limit > 0:
        raw_items = raw_items[:args.limit]

    use_bulk = not args.no_bulk
    print(f"Loaded {len(raw_items)} raw item(s) from {args.input}")
    print(f"Mode: {'APPLY' if args.apply else 'DRY-RUN'} | Transport: {'bulk' if use_bulk else 'one-by-one'}")

    api_curations_url = f'{api_base_url}/api/v3/curations'
    api_bulk_url = f'{api_base_url}/api/v3/curations/bulk'

    stats = {
        'total': len(raw_items),
        'valid': 0,
        'created': 0,
        'updated': 0,
        'failed': 0,
        'skipped_invalid': 0,
    }

    # ── Normalize all items first ────────────────────────────────────────────
    normalized_items: List[Dict[str, Any]] = []
    for index, raw_item in enumerate(raw_items, start=1):
        try:
            normalized = normalize_curation(raw_item, args.default_curator_id, args.keep_entity_id)
            stats['valid'] += 1
            normalized_items.append(normalized)
        except Exception as error:
            stats['skipped_invalid'] += 1
            print(f"[{index}/{stats['total']}] {Colors.WARNING}SKIP{Colors.ENDC} invalid item: {error}")

    if not args.apply:
        for normalized in normalized_items:
            print(f"  {Colors.OKGREEN}DRY-RUN{Colors.ENDC} {normalized['curation_id']}")
        print(f"\n{Colors.WARNING}Dry-run only. Use --apply to create curations.{Colors.ENDC}")
    elif use_bulk:
        # ── Bulk path ────────────────────────────────────────────────────────
        print(f"\nSending {len(normalized_items)} curations in bulk (chunk size={args.chunk_size})…")
        totals = post_curations_bulk(api_bulk_url, api_key, normalized_items, args.chunk_size)
        stats['created'] = totals['created']
        stats['updated'] = totals['updated']
        stats['failed'] = totals['errors']
    else:
        # ── One-by-one path (fallback) ────────────────────────────────────────
        for index, normalized in enumerate(normalized_items, start=1):
            curation_id = normalized['curation_id']
            success, message = post_curation(api_curations_url, api_key, normalized)
            if success:
                stats['created'] += 1
                print(f"[{index}/{stats['valid']}] {Colors.OKGREEN}CREATED{Colors.ENDC} {curation_id}")
            else:
                stats['failed'] += 1
                print(f"[{index}/{stats['valid']}] {Colors.FAIL}FAILED{Colors.ENDC} {curation_id} -> {message}")

    print('\n' + '=' * 72)
    print('Summary')
    print('=' * 72)
    print(f"Total input: {stats['total']}")
    print(f"Valid:       {stats['valid']}")
    print(f"Invalid:     {stats['skipped_invalid']}")
    if args.apply:
        print(f"Created:     {stats['created']}")
        if use_bulk:
            print(f"Updated:     {stats['updated']}")
        print(f"Failed:      {stats['failed']}")

    return 0 if stats['failed'] == 0 else 2


if __name__ == '__main__':
    raise SystemExit(main())
