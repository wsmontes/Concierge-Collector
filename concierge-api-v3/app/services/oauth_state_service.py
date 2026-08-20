"""Short-lived, browser-bound state for the Google OAuth + PKCE flow.

The public ``state`` value and the browser binding are independent random
secrets. Mongo stores only their SHA-256 hashes; the PKCE verifier and trusted
frontend target stay server-side and never travel through the authorization
URL. A state can be consumed exactly once.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import secrets

from fastapi import HTTPException, status
from pymongo import ReturnDocument
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError

OAUTH_STATE_TTL_SECONDS = 600


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _secret_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _invalid_state() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Invalid or expired OAuth state",
    )


def issue_oauth_state(
    db: Database,
    *,
    code_verifier: str,
    frontend_url: str,
    now: datetime | None = None,
) -> tuple[str, str]:
    """Create an opaque state plus a separate secret bound to the browser."""
    issued_at = now or _utc_now()
    expires_at = issued_at + timedelta(seconds=OAUTH_STATE_TTL_SECONDS)

    # A cryptographic collision is practically impossible, but retrying keeps
    # the uniqueness invariant explicit if the database ever reports one.
    for _attempt in range(3):
        state = secrets.token_urlsafe(32)
        browser_binding = secrets.token_urlsafe(32)
        document = {
            "state_hash": _secret_hash(state),
            "browser_binding_hash": _secret_hash(browser_binding),
            "audience": "google_oauth",
            "code_verifier": code_verifier,
            "frontend_url": frontend_url,
            "created_at": issued_at,
            "expires_at": expires_at,
            "consumed_at": None,
        }
        try:
            db.oauth_login_states.insert_one(document)
            return state, browser_binding
        except DuplicateKeyError:
            continue

    raise RuntimeError("Could not allocate a unique OAuth state")


def consume_oauth_state(
    db: Database,
    *,
    state: str,
    browser_binding: str,
    now: datetime | None = None,
) -> dict:
    """Atomically consume a state only from the browser that initiated it."""
    if not state or not browser_binding:
        raise _invalid_state()

    consumed_at = now or _utc_now()
    document = db.oauth_login_states.find_one_and_update(
        {
            "state_hash": _secret_hash(state),
            "browser_binding_hash": _secret_hash(browser_binding),
            "audience": "google_oauth",
            "consumed_at": None,
            "expires_at": {"$gt": consumed_at},
        },
        {"$set": {"consumed_at": consumed_at}},
        return_document=ReturnDocument.AFTER,
    )
    if document is None:
        raise _invalid_state()
    return document
