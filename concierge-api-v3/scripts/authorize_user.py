"""
File: authorize_user.py
Purpose: CLI tool to authorize a user and set their role in MongoDB.
Dependencies: pymongo, app.core.config (settings)

Usage:
    python scripts/authorize_user.py <email>
    python scripts/authorize_user.py <email> --role admin
    python scripts/authorize_user.py <email> --revoke

Roles: admin | curator (default) | viewer
"""

import argparse
import sys
import os

from pymongo import MongoClient

# Allow importing app modules from parent directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings

VALID_ROLES = ("admin", "curator", "viewer")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Authorize a user and set their role in MongoDB")
    parser.add_argument("email", help="User's email address")
    parser.add_argument(
        "--role",
        default="curator",
        choices=VALID_ROLES,
        help="Role to assign (default: curator)",
    )
    parser.add_argument(
        "--revoke",
        action="store_true",
        help="Revoke authorization (sets authorized=False)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    email: str = args.email.strip().lower()

    print(f"Connecting to MongoDB…")
    client = MongoClient(settings.mongodb_url)
    db = client[settings.mongodb_db_name]

    user = db.users.find_one({"email": email})

    if not user:
        print(f"User '{email}' not found. Have them log in once first to create their record.")
        client.close()
        return 1

    current_authorized = user.get("authorized", False)
    current_role = user.get("role", "<not set>")
    print(f"Found: {user.get('name')} | authorized={current_authorized} | role={current_role}")

    if args.revoke:
        update = {"$set": {"authorized": False}}
        db.users.update_one({"email": email}, update)
        print(f"✅ Authorization revoked for {email}")
    else:
        update = {"$set": {"authorized": True, "role": args.role}}
        result = db.users.update_one({"email": email}, update)
        print(
            f"✅ User authorized | role={args.role} | modified={result.modified_count}"
        )

    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
