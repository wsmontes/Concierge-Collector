"""Append-only audit boundary for user authorization/role mutations."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import uuid
from typing import Literal

from pymongo.database import Database

from app.core.observability import request_id_var

AuthzSource = Literal["authorize_user", "oauth_allowlist", "admin_api"]
VALID_ROLES = {"admin", "curator", "viewer"}


def _snapshot(*, authorized, role) -> dict:
    return {
        "authorized": None if authorized is None else bool(authorized),
        "role": None if role is None else str(role),
    }


def _request_id(explicit: str | None) -> str:
    if explicit:
        return explicit
    contextual = request_id_var.get()
    return contextual or f"authz-{uuid.uuid4()}"


def _event_key(
    *,
    actor_id: str,
    target_user_id: str,
    target_email: str,
    before: dict,
    after: dict,
    source: AuthzSource,
    request_id: str,
) -> str:
    body = json.dumps(
        {
            "actorId": actor_id,
            "targetUserId": target_user_id,
            "targetEmail": target_email.lower(),
            "before": before,
            "after": after,
            "source": source,
            "requestId": request_id,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return "authz_" + hashlib.sha256(body.encode("utf-8")).hexdigest()


def append_authz_change(
    db: Database,
    *,
    actor_id: str,
    target_user_id: str,
    target_email: str,
    before: dict,
    after: dict,
    source: AuthzSource,
    request_id: str | None = None,
    now: datetime | None = None,
) -> str | None:
    """Append one idempotent mutation event; reads/no-op decisions write nothing."""

    normalized_before = _snapshot(
        authorized=before.get("authorized"),
        role=before.get("role"),
    )
    normalized_after = _snapshot(
        authorized=after.get("authorized"),
        role=after.get("role"),
    )
    if normalized_before == normalized_after:
        return None

    correlation_id = _request_id(request_id)
    event_key = _event_key(
        actor_id=actor_id,
        target_user_id=target_user_id,
        target_email=target_email,
        before=normalized_before,
        after=normalized_after,
        source=source,
        request_id=correlation_id,
    )
    timestamp = now or datetime.now(timezone.utc)
    db.user_authz_audit_events.update_one(
        {"eventKey": event_key},
        {
            "$setOnInsert": {
                "eventKey": event_key,
                "eventType": "user.authorization.changed",
                "actorId": actor_id,
                "targetUserId": target_user_id,
                "targetEmail": target_email.lower(),
                "before": normalized_before,
                "after": normalized_after,
                "source": source,
                "requestId": correlation_id,
                "createdAt": timestamp,
            }
        },
        upsert=True,
    )
    return event_key


def apply_user_authz_change(
    db: Database,
    *,
    email: str,
    authorized: bool,
    role: str | None,
    actor_id: str,
    source: AuthzSource,
    request_id: str | None = None,
) -> dict:
    """Apply a manual/admin authorization change and append its audit event."""

    normalized_email = email.strip().lower()
    user = db.users.find_one({"email": normalized_email})
    if not user:
        raise KeyError(normalized_email)
    if role is not None and role not in VALID_ROLES:
        raise ValueError(f"Unsupported role: {role}")

    before = _snapshot(
        authorized=user.get("authorized", False),
        role=user.get("role", "curator"),
    )
    after = _snapshot(
        authorized=authorized,
        role=role if role is not None else before["role"],
    )
    if before == after:
        return {**user, **after}

    update_fields = {"authorized": after["authorized"]}
    if role is not None:
        update_fields["role"] = after["role"]
    db.users.update_one({"_id": user["_id"]}, {"$set": update_fields})
    append_authz_change(
        db,
        actor_id=actor_id,
        target_user_id=str(user["_id"]),
        target_email=normalized_email,
        before=before,
        after=after,
        source=source,
        request_id=request_id,
    )
    return {**user, **after}
