"""Audit duplicate OAuth identities before enabling unique user indexes.

Read-only by design. The script reports duplicate Google subject IDs and
case-insensitive email identities, including the Mongo document IDs involved.
It exits 1 when conflicts exist so it can be used as a deployment/migration
gate. It never modifies users or indexes.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.config import settings  # noqa: E402


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database",
        default=settings.mongodb_db_name,
        help="Mongo database to inspect (default: configured application DB)",
    )
    return parser.parse_args()


def _duplicate_google_ids(db) -> list[dict]:
    pipeline = [
        {
            "$match": {
                "google_id": {"$type": "string", "$ne": ""},
            }
        },
        {
            "$group": {
                "_id": "$google_id",
                "count": {"$sum": 1},
                "document_ids": {"$push": "$_id"},
                "emails": {"$push": "$email"},
            }
        },
        {"$match": {"count": {"$gt": 1}}},
        {"$sort": {"count": -1, "_id": 1}},
    ]
    return list(db.users.aggregate(pipeline))


def _duplicate_emails(db) -> list[dict]:
    pipeline = [
        {
            "$match": {
                "email": {"$type": "string", "$ne": ""},
            }
        },
        {
            "$project": {
                "normalized_email": {"$toLower": {"$trim": {"input": "$email"}}},
                "email": 1,
            }
        },
        {
            "$group": {
                "_id": "$normalized_email",
                "count": {"$sum": 1},
                "document_ids": {"$push": "$_id"},
                "emails": {"$push": "$email"},
            }
        },
        {"$match": {"_id": {"$ne": ""}, "count": {"$gt": 1}}},
        {"$sort": {"count": -1, "_id": 1}},
    ]
    return list(db.users.aggregate(pipeline))


def audit(db) -> tuple[list[dict], list[dict]]:
    return _duplicate_google_ids(db), _duplicate_emails(db)


def _print_group(label: str, groups: list[dict]) -> None:
    print(f"{label}: {len(groups)} duplicate identity group(s)")
    for group in groups:
        document_ids = ", ".join(str(value) for value in group.get("document_ids", []))
        emails = ", ".join(str(value) for value in group.get("emails", []))
        print(
            f"  identity={group.get('_id')!r} count={group.get('count')} "
            f"document_ids=[{document_ids}] emails=[{emails}]"
        )


def main() -> int:
    args = arguments()
    client = MongoClient(settings.mongodb_url)
    try:
        db = client[args.database]
        google_duplicates, email_duplicates = audit(db)
        _print_group("google_id", google_duplicates)
        _print_group("email(normalized)", email_duplicates)
        if google_duplicates or email_duplicates:
            print("RESULT: conflicts found — do not create unique user indexes yet")
            return 1
        print("RESULT: no identity duplicates found")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
