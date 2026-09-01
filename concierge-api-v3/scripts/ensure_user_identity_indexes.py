"""Audit and optionally install unique Mongo indexes for OAuth user identity.

The command is intentionally dry-run by default. Pass ``--apply`` only after
reviewing the duplicate audit output for the target database. No index is
created when duplicate Google subjects or case-insensitive email identities
exist, and existing same-key indexes are never dropped implicitly.
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
from scripts.audit_user_identity_duplicates import audit, _print_group  # noqa: E402


USER_IDENTITY_INDEXES = (
    (
        "users_google_id_unique",
        [("google_id", 1)],
        {
            "unique": True,
            "partialFilterExpression": {"google_id": {"$type": "string"}},
        },
    ),
    (
        "users_email_unique_ci",
        [("email", 1)],
        {
            "unique": True,
            "partialFilterExpression": {"email": {"$type": "string"}},
            "collation": {"locale": "en", "strength": 2},
        },
    ),
)


def _same_key(existing: dict, keys: list[tuple[str, int]]) -> bool:
    return list(existing.get("key", [])) == list(keys)


def ensure_user_identity_indexes(db) -> list[str]:
    """Create the approved indexes only after a clean duplicate audit."""
    google_duplicates, email_duplicates = audit(db)
    if google_duplicates or email_duplicates:
        raise RuntimeError("duplicate user identities found; refusing unique index installation")

    info = db.users.index_information()
    created: list[str] = []
    for name, keys, options in USER_IDENTITY_INDEXES:
        if name in info:
            continue

        conflicting = [
            existing_name
            for existing_name, metadata in info.items()
            if existing_name != "_id_" and _same_key(metadata, keys)
        ]
        if conflicting:
            raise RuntimeError(
                f"conflicting existing index for {name}: {', '.join(conflicting)}; "
                "review/drop it explicitly before migration"
            )

        db.users.create_index(keys, name=name, **options)
        created.append(name)
    return created


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database",
        default=settings.mongodb_db_name,
        help="Mongo database to inspect (default: configured application DB)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Create indexes after a clean audit. Without this flag the command is read-only.",
    )
    return parser.parse_args()


def main() -> int:
    args = arguments()
    client = MongoClient(settings.mongodb_url)
    try:
        db = client[args.database]
        google_duplicates, email_duplicates = audit(db)
        _print_group("google_id", google_duplicates)
        _print_group("email(normalized)", email_duplicates)
        if google_duplicates or email_duplicates:
            print("RESULT: conflicts found — indexes were not changed")
            return 1

        if not args.apply:
            names = ", ".join(name for name, _keys, _options in USER_IDENTITY_INDEXES)
            print(f"RESULT: audit clean — dry run only; would ensure: {names}")
            return 0

        try:
            created = ensure_user_identity_indexes(db)
        except RuntimeError as exc:
            print(f"RESULT: migration blocked — {exc}")
            return 1

        if created:
            print(f"RESULT: created {', '.join(created)}")
        else:
            print("RESULT: approved unique user identity indexes already present")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
