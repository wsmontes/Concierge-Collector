"""One-shot CMS handoff codes backed by the operational user database."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import secrets

from fastapi import HTTPException, status
from pymongo import ReturnDocument
from pymongo.database import Database

from app.core.config import settings
from app.models.cms_auth import CmsAuthorization


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _code_hash(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _authz_revision(user_id: str, role: str, authorized: bool) -> str:
    value = f"{user_id}|{role}|{authorized}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def load_cms_authorization(db: Database, subject: str) -> CmsAuthorization:
    """Load the live user record and require current CMS-admin access."""
    user = db.users.find_one({"email": subject})
    if user is None:
        raise _unauthorized("CMS authorization subject was not found")

    if user.get("authorized") is not True or user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CMS admin access is required")

    user_id = str(user["_id"])
    role = user["role"]
    authorized = user["authorized"]
    return CmsAuthorization(
        user_id=user_id,
        email=user["email"],
        name=user["name"],
        picture=user.get("picture"),
        role=role,
        authorized=authorized,
        authz_revision=_authz_revision(user_id, role, authorized),
    )


def issue_handoff_code(
    db: Database,
    *,
    subject: str,
    state: str,
    target_origin: str,
    now: datetime,
) -> str:
    """Persist a hash-only, short-lived CMS handoff code for a live admin."""
    load_cms_authorization(db, subject)

    raw_code = secrets.token_urlsafe(32)
    expires_at = now + timedelta(seconds=settings.cms_handoff_ttl_seconds)
    db.cms_auth_codes.insert_one(
        {
            "code_hash": _code_hash(raw_code),
            "audience": "cms",
            "subject": subject,
            "state": state,
            "target_origin": target_origin,
            "created_at": now,
            "expires_at": expires_at,
            "consumed_at": None,
        }
    )
    return raw_code


def consume_handoff_code(
    db: Database,
    *,
    code: str,
    state: str,
    target_origin: str,
    now: datetime | None = None,
) -> CmsAuthorization:
    """Atomically consume a code, then re-check the user's current access."""
    consumed_at = now or _utc_now()
    code_document = db.cms_auth_codes.find_one_and_update(
        {
            "code_hash": _code_hash(code),
            "audience": "cms",
            "state": state,
            "target_origin": target_origin,
            "consumed_at": None,
            "expires_at": {"$gt": consumed_at},
        },
        {"$set": {"consumed_at": consumed_at}},
        return_document=ReturnDocument.AFTER,
    )
    if code_document is None:
        raise _unauthorized("Invalid, expired, or already consumed CMS handoff code")

    # The query above is authoritative; these constant-time comparisons make a
    # malformed/mocked driver response fail closed rather than authorizing it.
    if not secrets.compare_digest(code_document.get("audience", ""), "cms"):
        raise _unauthorized("Invalid CMS handoff audience")
    if not secrets.compare_digest(code_document.get("state", ""), state):
        raise _unauthorized("Invalid CMS handoff state")
    if not secrets.compare_digest(code_document.get("target_origin", ""), target_origin):
        raise _unauthorized("Invalid CMS handoff target")

    return load_cms_authorization(db, code_document["subject"])
