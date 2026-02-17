#!/usr/bin/env python3
"""
File: generate_curations_json_from_michelin_csv_local_llm.py
Purpose: Generate import-compatible curations JSON from a local Michelin CSV using a local LM Studio model.
Dependencies: Python standard library (argparse, csv, hashlib, json, re, urllib)

Main Responsibilities:
- Read Michelin CSV from local disk.
- Build transcript-like text from review + metadata for each restaurant.
- Call local LM Studio (/api/v1/chat) to infer concept categories.
- Write a local JSON file compatible with scripts/python-tools/import_curations.py.

Important Constraints:
- Local in, local out.
- Uses local LLM only.
- No heuristic fallback concept generation.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Dict, List
from urllib import request, error


DEFAULT_MODEL = "qwen2.5-7b-instruct-mlx"
DEFAULT_LM_BASE_URL = "http://localhost:1234"
DEFAULT_CURATOR_ID = "curator-local-llm"
DEFAULT_CURATOR_NAME = "Local LLM Import"
DEFAULT_CATEGORIES_JSON = Path("data/initial_concepts.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate curations JSON from Michelin CSV using local LM Studio model"
    )
    parser.add_argument(
        "--input-csv",
        type=Path,
        required=True,
        help="Path to local Michelin CSV file",
    )
    parser.add_argument(
        "--output-json",
        type=Path,
        required=True,
        help="Path to output local JSON file",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"LM Studio model name (default: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--lm-base-url",
        default=DEFAULT_LM_BASE_URL,
        help=f"LM Studio base URL (default: {DEFAULT_LM_BASE_URL})",
    )
    parser.add_argument(
        "--curator-id",
        default=DEFAULT_CURATOR_ID,
        help="curator_id to write in generated curations",
    )
    parser.add_argument(
        "--curator-name",
        default=DEFAULT_CURATOR_NAME,
        help="curator.name to write in generated curations",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Limit processed rows (0 = all)",
    )
    parser.add_argument(
        "--categories-json",
        type=Path,
        default=DEFAULT_CATEGORIES_JSON,
        help="Path to categories JSON used by Collector (default: data/initial_concepts.json)",
    )
    return parser.parse_args()


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return re.sub(r"\s+", " ", text)


def split_csv_list(value: str) -> List[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def stable_curation_id(name: str, location: str, index_value: str) -> str:
    base = f"{name.strip().lower()}::{location.strip().lower()}::{index_value.strip()}"
    digest = hashlib.md5(base.encode("utf-8")).hexdigest()[:12]
    return f"curation-michelin-{digest}"


def build_transcript(row: Dict[str, str]) -> str:
    facilities = split_csv_list(clean_text(row.get("FacilitiesAndServices", "")))
    cuisine = split_csv_list(clean_text(row.get("Cuisine", "")))

    blocks = [
        f"Restaurant name: {clean_text(row.get('NAME', ''))}",
        f"Michelin award: {clean_text(row.get('Award', ''))}",
        f"Price: {clean_text(row.get('Price', ''))}",
        f"Cuisine: {', '.join(cuisine)}",
        f"Address: {clean_text(row.get('Address', ''))}",
        f"Location: {clean_text(row.get('Location', ''))}",
        f"Website: {clean_text(row.get('WebsiteUrl', ''))}",
        f"Guide URL: {clean_text(row.get('URL', ''))}",
        f"Latitude: {clean_text(row.get('Latitude', ''))}",
        f"Longitude: {clean_text(row.get('Longitude', ''))}",
        f"Phone: {clean_text(row.get('PhoneNumber', ''))}",
        f"Facilities and services: {', '.join(facilities)}",
        "Review text:",
        clean_text(row.get("REVIEW", "")),
    ]
    return "\n".join(block for block in blocks if block)


def load_available_categories(categories_json_path: Path) -> List[str]:
    if not categories_json_path.exists():
        raise FileNotFoundError(f"Categories file not found: {categories_json_path}")

    payload = json.loads(categories_json_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not payload:
        raise ValueError("Categories JSON must be an object with category keys")

    categories = [str(key).strip() for key in payload.keys() if str(key).strip()]
    if not categories:
        raise ValueError("No categories found in categories JSON")
    return categories


def normalize_category_key(raw_key: str, allowed_categories: List[str]) -> str:
    normalized_allowed = {
        re.sub(r"[^a-z0-9]", "", category.lower()): category
        for category in allowed_categories
    }
    normalized_raw = re.sub(r"[^a-z0-9]", "", raw_key.lower())
    return normalized_allowed.get(normalized_raw, "")


def lm_system_prompt(available_categories: List[str]) -> str:
    categories_str = ", ".join(available_categories)
    return (
        "Você é um especialista em análise de restaurantes com 20 anos de experiência em crítica gastronômica. "
        "Analise o texto de curadoria e extraia conceitos relevantes que descrevem o estabelecimento. "
        f"Categorias disponíveis: {categories_str}. "
        "Use APENAS essas categorias e APENAS conceitos suportados pelo texto. "
        "Não crie categorias novas. "
        "Retorne APENAS JSON válido, sem markdown e sem texto extra, no formato: "
        "{\"categories\": {\"Cuisine\": [\"concept1\"], \"Mood\": [\"concept2\"]}}. "
        "Regras: "
        "1) Não inclua categoria vazia. "
        "2) Cada valor deve ser lista de strings não vazias. "
        "3) Não invente fatos ausentes no texto. "
        "4) Priorize conceitos úteis para curadoria gastronômica."
    )


def extract_text_from_lm_response(payload: Dict[str, Any]) -> str:
    output_field = payload.get("output")
    if isinstance(output_field, list):
        for block in output_field:
            if isinstance(block, dict):
                content = block.get("content")
                if isinstance(content, str) and content.strip():
                    return content.strip()

    candidates = [
        payload.get("output"),
        payload.get("content"),
        payload.get("response"),
    ]

    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            message = first.get("message")
            if isinstance(message, dict):
                candidates.append(message.get("content"))
            candidates.append(first.get("text"))

    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()

    raise ValueError(f"Could not extract text from LM Studio response: {payload}")


def parse_llm_json_strict(raw_text: str, allowed_categories: List[str]) -> Dict[str, Any]:
    text = raw_text.strip()

    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, flags=re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()

    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("LLM output JSON root must be an object")

    categories = data.get("categories")
    if not isinstance(categories, dict) or not categories:
        raise ValueError("LLM output must contain a non-empty 'categories' object")

    normalized: Dict[str, List[str]] = {}
    for category, values in categories.items():
        if not isinstance(category, str) or not category.strip():
            raise ValueError("Category names must be non-empty strings")
        canonical_category = normalize_category_key(category.strip(), allowed_categories)
        if not canonical_category:
            raise ValueError(f"Invalid category '{category}'. Must be one of: {allowed_categories}")
        if not isinstance(values, list) or not values:
            raise ValueError(f"Category '{category}' must be a non-empty list")

        cleaned_values: List[str] = []
        seen = set()
        for value in values:
            if not isinstance(value, str):
                raise ValueError(f"Category '{category}' contains non-string value")
            cleaned = value.strip()
            if not cleaned:
                continue
            key = cleaned.lower()
            if key in seen:
                continue
            seen.add(key)
            cleaned_values.append(cleaned)

        if not cleaned_values:
            raise ValueError(f"Category '{category}' has no valid concepts")

        normalized[canonical_category] = cleaned_values

    return {"categories": normalized}


def call_local_lm_studio(base_url: str, model: str, transcript: str, allowed_categories: List[str]) -> Dict[str, Any]:
    endpoint = f"{base_url.rstrip('/')}/api/v1/chat"
    payload = {
        "model": model,
        "system_prompt": lm_system_prompt(allowed_categories),
        "input": transcript,
    }

    req = request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=180) as response:
            raw = response.read().decode("utf-8")
            response_payload = json.loads(raw)
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"LM Studio HTTP error {exc.code}: {body}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"Failed to reach LM Studio at {endpoint}: {exc}") from exc

    response_text = extract_text_from_lm_response(response_payload)
    return parse_llm_json_strict(response_text, allowed_categories)


def build_curation_document(
    row: Dict[str, str],
    source_csv_name: str,
    model: str,
    curator_id: str,
    curator_name: str,
    allowed_categories: List[str],
) -> Dict[str, Any]:
    name = clean_text(row.get("NAME", ""))
    location = clean_text(row.get("Location", ""))
    index_value = clean_text(row.get("INDEX", ""))

    if not name:
        raise ValueError("Missing NAME in CSV row")

    transcript = build_transcript(row)
    llm_output = call_local_lm_studio(
        base_url=args_global.lm_base_url,
        model=model,
        transcript=transcript,
        allowed_categories=allowed_categories,
    )

    curation_id = stable_curation_id(name, location, index_value)

    return {
        "curation_id": curation_id,
        "restaurant_name": name,
        "status": "draft",
        "notes": {
            "public": f"Michelin review-based curation for {name}",
            "private": f"Generated locally from {source_csv_name} row INDEX={index_value} using model {model}",
        },
        "categories": llm_output["categories"],
        "transcript": transcript,
        "sources": {
            "import": [
                {
                    "source": source_csv_name,
                    "format": "csv",
                    "csv_index": index_value,
                    "url": clean_text(row.get("URL", "")),
                }
            ],
            "llm": [
                {
                    "provider": "lm_studio_local",
                    "model": model,
                    "endpoint": "/api/v1/chat",
                }
            ],
        },
        "items": [],
        "curator_id": curator_id,
        "curator": {
            "id": curator_id,
            "name": curator_name,
            "email": None,
        },
    }


def read_csv_rows(input_csv: Path, limit: int) -> List[Dict[str, str]]:
    if not input_csv.exists():
        raise FileNotFoundError(f"Input CSV not found: {input_csv}")

    rows: List[Dict[str, str]] = []
    with input_csv.open("r", encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        for row in reader:
            if not isinstance(row, dict):
                continue
            normalized_row: Dict[str, str] = {}
            for key, value in row.items():
                fixed_key = (key or "").replace("\ufeff", "").strip()
                normalized_row[fixed_key] = value
            rows.append(normalized_row)
            if limit > 0 and len(rows) >= limit:
                break

    return rows


def write_output_json(output_path: Path, curations: List[Dict[str, Any]]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(curations, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main() -> int:
    rows = read_csv_rows(args_global.input_csv, args_global.limit)
    if not rows:
        raise RuntimeError("No rows found in input CSV")

    allowed_categories = load_available_categories(args_global.categories_json)

    output_curations: List[Dict[str, Any]] = []
    total = len(rows)

    for index, row in enumerate(rows, start=1):
        name = clean_text(row.get("NAME", "")) or "<unknown>"
        print(f"[{index}/{total}] Processing: {name}")

        curation = build_curation_document(
            row=row,
            source_csv_name=args_global.input_csv.name,
            model=args_global.model,
            curator_id=args_global.curator_id,
            curator_name=args_global.curator_name,
            allowed_categories=allowed_categories,
        )
        output_curations.append(curation)

    write_output_json(args_global.output_json, output_curations)
    print(f"\nGenerated {len(output_curations)} curations -> {args_global.output_json}")
    return 0


args_global = parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
