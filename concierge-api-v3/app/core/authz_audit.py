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


def _compensate_failed_audit(
    db: Database,
    *,
    target_email: str,
    before: dict,
    after: dict,
) -> None:
    """Fail closed when the privilege mutation succeeded but audit did not.

    Existing users are restored with a CAS on the exact post-mutation authz
    state. A first-login bootstrap has no prior user authz snapshot, so the
    newly inserted allowlisted admin is removed instead. Email is the stable
    lookup here because legacy users may still have ObjectId `_id` values while
    application models expose IDs as strings.
    """

    selector = {
        "email": target_email.lower(),
        "authorized": after["authorized"],
        "role": after["role"],
    }
    if before["authorized"] is None and before["role"] is None:
        rollback = db.users.delete_one(selector)
        if getattr(rollback, "deleted_count", 0) != 1:
            raise RuntimeError("Authorization audit failed and bootstrap rollback conflicted")
        return

    rollback = db.users.update_one(
        selector,
        {"$set": {"authorized": before["authorized"], "role": before["role"]}},
    )
    if getattr(rollback, "matched_count", 0) != 1:
        raise RuntimeError("Authorization audit failed and privilege rollback conflicted")


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
    compensate_on_failure: bool = True,
) -> str | None:
    """Append one idempotent mutation event; reads/no-op decisions write nothing.

    Normal authz writers mutate the user first and leave
    ``compensate_on_failure`` enabled. If the append fails, the mutation is
    restored from the supplied snapshots before the original exception is
    propagated.

    ``compensate_on_failure=False`` is reserved for a caller that is only
    ensuring an idempotent event for a mutation performed by another concurrent
    writer. That caller must fail its own request when the append fails, but it
    must never compensate/delete state it did not mutate itself.
    """

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
    try:
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
    except Exception as audit_error:
        if not compensate_on_failure:
            raise audit_error
        try:
            _compensate_failed_audit(
                db,
                target_email=target_email,
                before=normalized_before,
                after=normalized_after,
            )
        except Exception as rollback_error:
            raise RuntimeError(
                "Authorization audit failed and privilege rollback could not be verified"
            ) from rollback_error
        raise audit_error
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
    """Apply a manual/admin authorization change through the audit boundary."""

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

    changed = db.users.update_one(
        {
            "_id": user["_id"],
            "authorized": before["authorized"],
            "role": before["role"],
        },
        {"$set": {"authorized": after["authorized"], "role": after["role"]}},
    )
    if getattr(changed, "matched_count", 0) != 1:
        raise RuntimeError("Authorization changed concurrently; retry from fresh state")

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
