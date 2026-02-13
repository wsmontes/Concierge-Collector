#!/usr/bin/env python3
"""
File: import_curations.py
Purpose: Import curation documents from JSON into API v3 with schema normalization.
Dependencies: requests, python-dotenv

Main Responsibilities:
- Read curation JSON in object/array/wrapper formats
- Normalize legacy curation fields to API v3 contract
- Support dry-run preview and apply mode for real import
- Report per-item and aggregate import results
"""

import argparse
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


def normalize_curation(raw: Dict[str, Any], default_curator_id: str, keep_entity_id: bool = False) -> Dict[str, Any]:
    """Normalize raw curation document into API v3 create contract."""
    curation_id = raw.get('curation_id') or raw.get('_id')
    if not curation_id:
        raise ValueError('Missing curation_id/_id')

    curator = raw.get('curator') if isinstance(raw.get('curator'), dict) else {}
    curator_id = raw.get('curator_id') or curator.get('id') or default_curator_id
    curator_name = curator.get('name') or 'Import Script'

    categories = clean_categories(raw.get('categories'))
    if not categories:
        raise ValueError('Missing/invalid categories')

    notes = raw.get('notes') if isinstance(raw.get('notes'), dict) else {}
    sources = normalize_sources(raw.get('sources'))
    transcript = resolve_transcript(raw, sources)
    restaurant_name = resolve_restaurant_name(raw)

    normalized: Dict[str, Any] = {
        'curation_id': curation_id,
        'curator_id': curator_id,
        'curator': {
            'id': curator_id,
            'name': curator_name,
            'email': curator.get('email'),
        },
        'status': 'draft',
        'notes': {
            'public': notes.get('public'),
            'private': notes.get('private'),
        },
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


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    default_input = Path(__file__).resolve().parents[2] / 'data' / 'curations.json'
    parser = argparse.ArgumentParser(description='Import curations JSON into API v3')
    parser.add_argument('--input', type=Path, default=default_input, help='Path to curations JSON file')
    parser.add_argument('--apply', action='store_true', help='Apply changes (default is dry-run)')
    parser.add_argument('--limit', type=int, default=0, help='Limit number of records processed (0 = all)')
    parser.add_argument('--default-curator-id', default='curator-import-script', help='Fallback curator_id')
    parser.add_argument('--keep-entity-id', action='store_true', help='Preserve entity_id from input (default: disabled)')
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

    print(f"Loaded {len(raw_items)} raw item(s) from {args.input}")
    print(f"Mode: {'APPLY' if args.apply else 'DRY-RUN'}")

    api_curations_url = f'{api_base_url}/api/v3/curations'
    stats = {
        'total': len(raw_items),
        'valid': 0,
        'created': 0,
        'failed': 0,
        'skipped_invalid': 0,
    }

    for index, raw_item in enumerate(raw_items, start=1):
        try:
            normalized = normalize_curation(raw_item, args.default_curator_id, args.keep_entity_id)
            stats['valid'] += 1
        except Exception as error:
            stats['skipped_invalid'] += 1
            print(f"[{index}/{stats['total']}] {Colors.WARNING}SKIP{Colors.ENDC} invalid item: {error}")
            continue

        curation_id = normalized['curation_id']
        if not args.apply:
            print(f"[{index}/{stats['total']}] {Colors.OKGREEN}DRY-RUN{Colors.ENDC} {curation_id}")
            continue

        success, message = post_curation(api_curations_url, api_key, normalized)
        if success:
            stats['created'] += 1
            print(f"[{index}/{stats['total']}] {Colors.OKGREEN}CREATED{Colors.ENDC} {curation_id}")
        else:
            stats['failed'] += 1
            print(f"[{index}/{stats['total']}] {Colors.FAIL}FAILED{Colors.ENDC} {curation_id} -> {message}")

    print('\n' + '=' * 72)
    print('Summary')
    print('=' * 72)
    print(f"Total: {stats['total']}")
    print(f"Valid: {stats['valid']}")
    print(f"Skipped invalid: {stats['skipped_invalid']}")
    print(f"Created: {stats['created']}")
    print(f"Failed: {stats['failed']}")

    if not args.apply:
        print(f"\n{Colors.WARNING}Dry-run only. Use --apply to create curations.{Colors.ENDC}")

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
