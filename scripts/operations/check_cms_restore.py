#!/usr/bin/env python3
"""Compare a CMS source database with its isolated restore.

The checker is intentionally read-only. It compares collection names, document
counts and a streaming canonical SHA-256 per collection so a restore that loses
or mutates documents cannot pass on counts alone. Connection strings are never
printed.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from typing import Iterable

from bson.json_util import CANONICAL_JSON_OPTIONS, dumps
from pymongo import MongoClient
from pymongo.database import Database


def canonical_collection_hash(database: Database, collection_name: str) -> str:
    digest = hashlib.sha256()
    cursor = database[collection_name].find({}).sort("_id", 1)
    for document in cursor:
        payload = dumps(
            document,
            json_options=CANONICAL_JSON_OPTIONS,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        digest.update(len(payload).to_bytes(8, "big"))
        digest.update(payload)
    return digest.hexdigest()


def user_collections(database: Database) -> list[str]:
    return sorted(name for name in database.list_collection_names() if not name.startswith("system."))


def compare_databases(source: Database, restored: Database) -> list[str]:
    failures: list[str] = []
    source_names = user_collections(source)
    restored_names = user_collections(restored)
    if source_names != restored_names:
        failures.append(
            f"collection set mismatch: source={len(source_names)} restored={len(restored_names)}"
        )

    for name in sorted(set(source_names) | set(restored_names)):
        if name not in source_names or name not in restored_names:
            continue
        source_count = source[name].count_documents({})
        restored_count = restored[name].count_documents({})
        if source_count != restored_count:
            failures.append(
                f"{name}: count mismatch source={source_count} restored={restored_count}"
            )
            continue
        source_hash = canonical_collection_hash(source, name)
        restored_hash = canonical_collection_hash(restored, name)
        if source_hash != restored_hash:
            failures.append(f"{name}: canonical sha256 mismatch")
    return failures


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--source-db", required=True)
    parser.add_argument("--restore-url", required=True)
    parser.add_argument("--restore-db", required=True)
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.restore_db.endswith("-restore-test"):
        print("restore database must end with -restore-test", file=sys.stderr)
        return 2

    source_client = MongoClient(args.source_url, appname="concierge-cms-restore-check-source")
    restore_client = MongoClient(args.restore_url, appname="concierge-cms-restore-check-target")
    try:
        source_client.admin.command("ping")
        restore_client.admin.command("ping")
        failures = compare_databases(source_client[args.source_db], restore_client[args.restore_db])
    finally:
        source_client.close()
        restore_client.close()

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}", file=sys.stderr)
        return 1

    print("CMS restore invariants: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
