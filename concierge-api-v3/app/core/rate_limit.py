"""
Shared slowapi Limiter instance.

Vive fora do main.py para que os routers possam importar o MESMO objeto
`limiter` sem criar import circular (main.py importa os routers; os routers
não podem importar de main.py). O main.py anexa esta instância ao
app.state.limiter e registra o handler/exception handler/middleware.
"""

import hashlib
import hmac

from jose import JWTError, jwt
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.security import ALGORITHM, get_jwt_secret


def _hashed_bucket(prefix: str, value: str) -> str:
    """Hash high-entropy credentials without exposing their raw value."""
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
    return f"{prefix}:{digest}"


def _subject_bucket(subject: str) -> str:
    """Pseudonymize low-entropy user identities with a keyed digest."""
    digest = hmac.new(
        get_jwt_secret().encode("utf-8"),
        subject.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"user:{digest}"


def _access_subject_bucket(token: str) -> str | None:
    """Resolve a signed access JWT to a stable user bucket across rotations."""
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[ALGORITHM])
    except (JWTError, RuntimeError, ValueError, TypeError):
        return None

    if payload.get("type") != "access":
        return None
    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject:
        return None
    return _subject_bucket(subject)


def auth_header_key(request):
    """Stable bucket for paid/provider endpoints.

    API keys are keyed by a hash of the high-entropy key. Human access sessions
    are keyed by an HMAC of the verified JWT subject, so rotating the access
    token does not reset quota, Bearer/cookie transports share one bucket, and
    a guessed email cannot be matched to a limiter key without the server
    secret. Invalid credentials fall back to an opaque credential hash (or IP
    when no credential is present); authentication still decides access.
    """
    api_key = request.headers.get("x-api-key", "").strip()
    if api_key:
        return _hashed_bucket("api-key", api_key)

    authorization = request.headers.get("authorization", "").strip()
    if authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        subject_bucket = _access_subject_bucket(token)
        if subject_bucket:
            return subject_bucket
        if token:
            return _hashed_bucket("bearer", token)

    access_cookie = request.cookies.get("access_token")
    if access_cookie:
        subject_bucket = _access_subject_bucket(access_cookie)
        if subject_bucket:
            return subject_bucket
        return _hashed_bucket("cookie", access_cookie)

    if authorization:
        return _hashed_bucket("authorization", authorization)
    return get_remote_address(request)


# Rate limiter — keyed by client IP by default.
# Endpoints with paid providers use auth_header_key for a stable credential/user
# bucket instead of IP or the rotating JWT string.
limiter = Limiter(key_func=get_remote_address, default_limits=["300/minute"])
