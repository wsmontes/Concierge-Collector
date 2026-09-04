"""
File: authorize_user.py
Purpose: CLI tool to authorize a user and set their role in MongoDB with an
         append-only authorization-change audit event.

Usage:
    python scripts/authorize_user.py <email>
    python scripts/authorize_user.py <email> --role admin
    python scripts/authorize_user.py <email> --revoke
    python scripts/authorize_user.py <email> --role admin --actor operator@example.com

Roles: admin | curator (default) | viewer
"""

import argparse
import os
import sys
import uuid

from pymongo import MongoClient

# Allow importing app modules from parent directory
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.authz_audit import apply_user_authz_change
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
        help="Revoke authorization (sets authorized=False and preserves current role)",
    )
    parser.add_argument(
        "--actor",
        default=None,
        help="Operator identifier stored in the audit event (default: local OS user)",
    )
    parser.add_argument(
        "--request-id",
        default=None,
        help="Optional stable correlation id for an explicitly retried operator action",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    email: str = args.email.strip().lower()
    actor = args.actor or f"cli:{os.environ.get('USER') or os.environ.get('USERNAME') or 'operator'}"
    request_id = args.request_id or f"cli-authz-{uuid.uuid4()}"

    print("Connecting to MongoDB…")
    client = MongoClient(settings.mongodb_url)
    db = client[settings.mongodb_db_name]

    user = db.users.find_one({"email": email})
    if not user:
        print(f"User '{email}' not found. Have them log in once first to create their record.")
        client.close()
        return 1

    current_authorized = user.get("authorized", False)
    current_role = user.get("role", "curator")
    print(f"Found: {user.get('name')} | authorized={current_authorized} | role={current_role}")

    changed = apply_user_authz_change(
        db,
        email=email,
        authorized=not args.revoke,
        role=None if args.revoke else args.role,
        actor_id=actor,
        source="authorize_user",
        request_id=request_id,
    )

    if args.revoke:
        print(f"✅ Authorization revoked for {email}")
    else:
        print(f"✅ User authorized | role={changed.get('role', args.role)}")
    print(f"Audit request id: {request_id}")

    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
