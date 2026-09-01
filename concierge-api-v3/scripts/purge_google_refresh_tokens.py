"""Remove legacy Google OAuth refresh tokens from operational user documents.

Collector authentication uses its own app refresh JWTs in ``auth_sessions``;
``users.refresh_token`` was an older Google credential that is no longer read or
needed. This script is intentionally dry-run by default. Pass ``--apply`` to
unset the legacy field after reviewing the reported count.
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
        "--apply",
        action="store_true",
        help="actually unset users.refresh_token; default is report-only",
    )
    return parser.parse_args()


def main() -> int:
    args = arguments()
    client = MongoClient(settings.mongodb_url)
    try:
        db = client[settings.mongodb_db_name]
        query = {
            "refresh_token": {
                "$exists": True,
                "$nin": [None, ""],
            }
        }
        count = db.users.count_documents(query)
        print(f"legacy_google_refresh_tokens={count} apply={args.apply}")
        if not args.apply or count == 0:
            return 0

        result = db.users.update_many(query, {"$unset": {"refresh_token": ""}})
        print(f"purged={result.modified_count}")
        if result.modified_count > count:
            raise RuntimeError("purge modified more rows than the preflight count")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
