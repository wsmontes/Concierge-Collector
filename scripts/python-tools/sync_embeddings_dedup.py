#!/usr/bin/env python3
"""
File: sync_embeddings_dedup.py
Purpose: Build and sync deduplicated concept embeddings into MongoDB collections.
Dependencies: pymongo, openai, python-dotenv

Main Responsibilities:
- Read curations from exported JSON and extract category+concept pairs
- Deduplicate embeddings globally in `embeddings` collection
- Preserve curation/restaurant relationships in `embedding_links` collection
- Support incremental runs via upsert and concept-key reuse
"""

import argparse
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from dotenv import load_dotenv
from openai import OpenAI
from pymongo import MongoClient, UpdateOne


DEFAULT_MODEL = "text-embedding-3-small"
DEFAULT_DIMENSIONS = 1536
DEFAULT_BATCH_SIZE = 100
DEFAULT_INPUT = "data/concierge_v3_2026-02-17.json"
DEFAULT_DB_NAME = "concierge-collector"


@dataclass
class Stats:
    total_curations: int = 0
    processed_curations: int = 0
    skipped_curations: int = 0
    total_pairs: int = 0
    unique_pairs: int = 0
    reused_embeddings: int = 0
    created_embeddings: int = 0
    total_links: int = 0
    link_upserts: int = 0


def now_iso() -> str:
    """Return UTC timestamp in ISO-8601 with Z suffix."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def find_env_file() -> Path:
    """Find the first available .env file in expected project locations."""
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


def normalize_token(value: str) -> str:
    """Normalize category/concept token for deterministic deduplication."""
    return " ".join(value.strip().lower().split())


def build_concept_key(category: str, concept: str, model: str, dimensions: int) -> str:
    """Create stable deduplication key scoped by model and dimensions."""
    raw = f"{normalize_token(category)}::{normalize_token(concept)}::{model}::{dimensions}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def chunked(values: List[str], size: int) -> Iterable[List[str]]:
    """Yield list chunks with fixed max size."""
    for idx in range(0, len(values), size):
        yield values[idx: idx + size]


def load_json_curations(file_path: Path) -> List[Dict[str, Any]]:
    """Load curation documents from exported JSON file."""
    payload = json.loads(file_path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and isinstance(payload.get("curations"), list):
        return [item for item in payload["curations"] if isinstance(item, dict)]
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    raise ValueError("Invalid input format. Expected list or object with 'curations'.")


def collect_pairs(curations: List[Dict[str, Any]], model: str, dimensions: int) -> Tuple[Dict[str, Dict[str, Any]], List[Dict[str, Any]], Stats]:
    """Extract unique concept pairs and curation links."""
    stats = Stats(total_curations=len(curations))
    unique_concepts: Dict[str, Dict[str, Any]] = {}
    links: List[Dict[str, Any]] = []
    ts = now_iso()

    for curation in curations:
        curation_id = curation.get("curation_id") or curation.get("_id")
        if not curation_id:
            stats.skipped_curations += 1
            continue

        categories = curation.get("categories")
        if not isinstance(categories, dict):
            stats.skipped_curations += 1
            continue

        stats.processed_curations += 1
        curation_id = str(curation_id)
        entity_id = curation.get("entity_id")
        restaurant_name = curation.get("restaurant_name")

        for category, concepts in categories.items():
            if not isinstance(category, str) or not isinstance(concepts, list):
                continue

            for concept in concepts:
                if not isinstance(concept, str):
                    continue

                category_norm = normalize_token(category)
                concept_norm = normalize_token(concept)
                if not category_norm or not concept_norm:
                    continue

                stats.total_pairs += 1
                concept_text = f"{category_norm} {concept_norm}"
                concept_key = build_concept_key(category_norm, concept_norm, model, dimensions)

                if concept_key not in unique_concepts:
                    unique_concepts[concept_key] = {
                        "concept_key": concept_key,
                        "text": concept_text,
                        "category": category_norm,
                        "concept": concept_norm,
                        "model": model,
                        "dimensions": dimensions,
                        "created_at": ts,
                        "updated_at": ts,
                    }

                links.append(
                    {
                        "curation_id": curation_id,
                        "entity_id": entity_id,
                        "restaurant_name": restaurant_name,
                        "category": category_norm,
                        "concept": concept_norm,
                        "concept_key": concept_key,
                        "model": model,
                        "dimensions": dimensions,
                        "created_at": ts,
                        "updated_at": ts,
                    }
                )

    stats.unique_pairs = len(unique_concepts)
    stats.total_links = len(links)
    return unique_concepts, links, stats


def create_indexes(db) -> None:
    """Create required indexes for deduplicated embeddings and links."""
    db.embeddings.create_index("concept_key", unique=True, background=True)
    db.embeddings.create_index([("model", 1), ("dimensions", 1)], background=True)
    db.embeddings.create_index([("category", 1), ("concept", 1)], background=True)

    db.embedding_links.create_index(
        [("curation_id", 1), ("category", 1), ("concept", 1), ("model", 1)],
        unique=True,
        background=True,
    )
    db.embedding_links.create_index("concept_key", background=True)
    db.embedding_links.create_index("entity_id", background=True)


def get_existing_concept_keys(db, keys: List[str], in_chunk: int = 1000) -> Set[str]:
    """Fetch existing concept keys from MongoDB in chunks."""
    existing: Set[str] = set()
    for key_batch in chunked(keys, in_chunk):
        cursor = db.embeddings.find({"concept_key": {"$in": key_batch}}, {"concept_key": 1, "_id": 0})
        for doc in cursor:
            existing.add(doc["concept_key"])
    return existing


def generate_embeddings(client: OpenAI, docs: List[Dict[str, Any]], model: str, dimensions: int, batch_size: int) -> None:
    """Generate OpenAI embeddings for pending concept documents."""
    for batch in chunked(docs, batch_size):
        texts = [doc["text"] for doc in batch]
        response = client.embeddings.create(input=texts, model=model, dimensions=dimensions)
        for index, doc in enumerate(batch):
            doc["vector"] = response.data[index].embedding
            doc["updated_at"] = now_iso()


def upsert_new_embeddings(db, docs: List[Dict[str, Any]]) -> int:
    """Upsert newly generated embeddings by concept key."""
    if not docs:
        return 0
    operations = []
    for doc in docs:
        operations.append(
            UpdateOne(
                {"concept_key": doc["concept_key"]},
                {
                    "$set": {
                        "text": doc["text"],
                        "category": doc["category"],
                        "concept": doc["concept"],
                        "model": doc["model"],
                        "dimensions": doc["dimensions"],
                        "vector": doc["vector"],
                        "updated_at": doc["updated_at"],
                    },
                    "$setOnInsert": {
                        "concept_key": doc["concept_key"],
                        "created_at": doc["created_at"],
                    },
                },
                upsert=True,
            )
        )
    result = db.embeddings.bulk_write(operations, ordered=False)
    return (result.upserted_count or 0) + (result.modified_count or 0)


def upsert_links(db, links: List[Dict[str, Any]]) -> int:
    """Upsert curation-concept links."""
    if not links:
        return 0
    operations = []
    for link in links:
        operations.append(
            UpdateOne(
                {
                    "curation_id": link["curation_id"],
                    "category": link["category"],
                    "concept": link["concept"],
                    "model": link["model"],
                },
                {
                    "$set": {
                        "entity_id": link["entity_id"],
                        "restaurant_name": link["restaurant_name"],
                        "concept_key": link["concept_key"],
                        "dimensions": link["dimensions"],
                        "updated_at": now_iso(),
                    },
                    "$setOnInsert": {
                        "created_at": link["created_at"],
                    },
                },
                upsert=True,
            )
        )
    result = db.embedding_links.bulk_write(operations, ordered=False)
    return (result.upserted_count or 0) + (result.modified_count or 0)


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(description="Sync deduplicated embeddings to MongoDB")
    parser.add_argument("--input-file", default=DEFAULT_INPUT, help="Path to JSON file with curations")
    parser.add_argument("--mongo-uri", default=None, help="MongoDB URI (fallback env: MONGODB_URI/MONGODB_URL)")
    parser.add_argument("--db-name", default=None, help="MongoDB DB name (fallback env: MONGODB_DB_NAME)")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="OpenAI embedding model")
    parser.add_argument("--dimensions", type=int, default=DEFAULT_DIMENSIONS, help="Embedding dimensions")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="Embedding API batch size")
    parser.add_argument("--apply", action="store_true", help="Apply changes to MongoDB (default is dry-run)")
    return parser.parse_args()


def main() -> None:
    """Entrypoint for deduplicated embedding synchronization."""
    args = parse_args()

    env_file = find_env_file()
    load_dotenv(env_file)

    input_path = Path(args.input_file)
    if not input_path.is_absolute():
        input_path = Path(__file__).resolve().parents[2] / input_path

    if not input_path.exists():
        print(f"ERROR: Input file not found: {input_path}")
        sys.exit(1)

    mongo_uri = args.mongo_uri or os.getenv("MONGODB_URI") or os.getenv("MONGODB_URL")
    db_name = args.db_name or os.getenv("MONGODB_DB_NAME") or DEFAULT_DB_NAME
    openai_api_key = os.getenv("OPENAI_API_KEY")

    if not mongo_uri:
        print("ERROR: MongoDB URI not found. Set --mongo-uri or env MONGODB_URI/MONGODB_URL")
        sys.exit(1)

    curations = load_json_curations(input_path)
    unique_concepts, links, stats = collect_pairs(curations, args.model, args.dimensions)

    print("=" * 80)
    print("DEDUP EMBEDDINGS SYNC")
    print("=" * 80)
    print(f"Input file: {input_path}")
    print(f"Model: {args.model} | Dimensions: {args.dimensions}")
    print(f"Mongo DB: {db_name}")
    print(f"Curations: total={stats.total_curations}, processed={stats.processed_curations}, skipped={stats.skipped_curations}")
    print(f"Pairs: total={stats.total_pairs}, unique={stats.unique_pairs}")
    print(f"Links to upsert: {stats.total_links}")

    if not args.apply:
        print("\nDry-run mode. Use --apply to persist in MongoDB.")
        return

    if not openai_api_key:
        print("ERROR: OPENAI_API_KEY not found in environment")
        sys.exit(1)

    client = MongoClient(mongo_uri)
    db = client[db_name]

    try:
        create_indexes(db)

        concept_keys = list(unique_concepts.keys())
        existing = get_existing_concept_keys(db, concept_keys)
        stats.reused_embeddings = len(existing)

        to_create = [unique_concepts[key] for key in concept_keys if key not in existing]
        stats.created_embeddings = len(to_create)

        print(f"Existing embeddings reused: {stats.reused_embeddings}")
        print(f"New embeddings to create: {stats.created_embeddings}")

        if to_create:
            openai_client = OpenAI(api_key=openai_api_key)
            generate_embeddings(openai_client, to_create, args.model, args.dimensions, args.batch_size)
            upsert_new_embeddings(db, to_create)

        stats.link_upserts = upsert_links(db, links)

        print("\nSync completed.")
        print(f"Embeddings reused: {stats.reused_embeddings}")
        print(f"Embeddings created: {stats.created_embeddings}")
        print(f"Link upserts: {stats.link_upserts}")
        print("Collections: embeddings, embedding_links")
    finally:
        client.close()


if __name__ == "__main__":
    main()
