"""
Authentication Router - Google OAuth 2.0 with PKCE.

Security boundaries:
- Authorization Code Flow with PKCE.
- OAuth state is browser-bound and one-shot; the PKCE verifier stays server-side.
- Collector access/refresh JWTs are distinct from Google OAuth credentials.
- User authorization remains authoritative in MongoDB.
"""

from datetime import datetime, timedelta, timezone
import base64
import hashlib
import logging
import os
import secrets
from typing import Optional
from urllib.parse import quote, urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
import httpx
from jose import jwt
from pymongo.database import Database

from app.core.config import settings
from app.core.database import get_database
from app.core.security import create_access_token, verify_auth
from app.models.user import TokenRefreshRequest, User, UserAuthResponse, UserInDB
from app.services.oauth_state_service import (
    OAUTH_STATE_TTL_SECONDS,
    consume_oauth_state,
    issue_oauth_state,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["authentication"])

_OAUTH_BINDING_COOKIE = "oauth_state_binding"
_OAUTH_COOKIE_PATH = "/api/v3/auth"


def _set_access_cookie(response: Response, access_token: str) -> None:
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        samesite="lax",
        secure=settings.environment == "production",
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        samesite="lax",
        secure=settings.environment == "production",
        max_age=settings.refresh_token_expire_days * 86400,
        path="/",
    )


def _set_oauth_binding_cookie(response: Response, browser_binding: str) -> None:
    """Bind the Google callback to the browser that initiated the flow."""
    response.set_cookie(
        key=_OAUTH_BINDING_COOKIE,
        value=browser_binding,
        httponly=True,
        samesite="lax",
        secure=settings.environment == "production",
        max_age=OAUTH_STATE_TTL_SECONDS,
        path=_OAUTH_COOKIE_PATH,
    )


def _clear_oauth_binding_cookie(response: Response) -> None:
    response.delete_cookie(_OAUTH_BINDING_COOKIE, path=_OAUTH_COOKIE_PATH)


def _default_frontend_url() -> str:
    if settings.environment == "production":
        return settings.frontend_url_production
    return settings.frontend_url


def _is_same_site(url_a: str, url_b: str) -> bool:
    """Compare scheme + approximate registrable domain for SameSite routing.

    Local IPs/hostnames require exact host identity. The helper remains a
    compatibility heuristic for the legacy cross-site frontend; authorization
    never depends on it.
    """
    import re
    from urllib.parse import urlparse

    a, b = urlparse(url_a), urlparse(url_b)
    if a.scheme != b.scheme:
        return False
    ha, hb = (a.hostname or "").lower(), (b.hostname or "").lower()
    if ha == hb:
        return True

    def site(host: str) -> str:
        if re.match(r"^\d+\.\d+\.\d+\.\d+$", host):
            return host
        parts = host.split(".")
        return ".".join(parts[-2:]) if len(parts) >= 2 else host

    return site(ha) == site(hb)


def _build_auth_redirect_url(
    frontend_url: str,
    access_token: str,
    refresh_token: str,
    user_email: str,
    user_name: str,
    same_site: bool,
) -> str:
    """Build the post-login redirect.

    Tokens remain in the URL *fragment* for the current Safari/cross-site
    compatibility path; they never enter query parameters or request logs.
    HttpOnly cookies are set in parallel. Removing fragment credentials
    entirely requires a separate one-shot frontend handoff and is intentionally
    not mixed into the OAuth-state fix.
    """
    base = f"{frontend_url.rstrip('/')}/"
    fragment = (
        f"token={access_token}"
        f"&refresh_token={refresh_token}"
        f"&expires_in={settings.access_token_expire_minutes * 60}"
        f"&user_email={quote(user_email)}"
        f"&user_name={quote(user_name)}"
    )
    return f"{base}?session=1#{fragment}"


def _issue_refresh(db: Database, email: str) -> str:
    """Issue an app refresh JWT and register its server-side jti."""
    from app.core.security import ALGORITHM, create_refresh_token, get_jwt_secret
    from app.services.session_service import register_session

    token = create_refresh_token(data={"sub": email})
    payload = jwt.decode(token, get_jwt_secret(), algorithms=[ALGORITHM])
    register_session(db, payload["jti"], email)
    return token


def generate_pkce_pair() -> tuple[str, str]:
    """Generate RFC 7636 code_verifier and S256 code_challenge."""
    code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("utf-8").rstrip("=")
    challenge_bytes = hashlib.sha256(code_verifier.encode("utf-8")).digest()
    code_challenge = base64.urlsafe_b64encode(challenge_bytes).decode("utf-8").rstrip("=")
    return code_verifier, code_challenge


def get_user_by_google_id(db: Database, google_id: str) -> Optional[UserInDB]:
    user_doc = db.users.find_one({"google_id": google_id})
    if user_doc:
        user_doc["_id"] = str(user_doc["_id"])
        return UserInDB(**user_doc)
    return None


def get_user_by_email(db: Database, email: str) -> Optional[UserInDB]:
    user_doc = db.users.find_one({"email": email})
    if user_doc:
        user_doc["_id"] = str(user_doc["_id"])
        return UserInDB(**user_doc)
    return None


def create_or_update_user(db: Database, user_data: dict) -> UserInDB:
    """Create/update the operational user without persisting Google tokens."""
    is_admin = settings.is_admin_email(user_data["email"])
    existing_user = get_user_by_google_id(db, user_data["google_id"])

    if existing_user:
        now = datetime.now(timezone.utc)
        update_data = {
            "name": user_data["name"],
            "picture": user_data.get("picture"),
            "last_login": now,
            # This field historically held a Google OAuth refresh token in
            # plaintext. Collector sessions do not use it; neutralize legacy
            # values on every successful login.
            "refresh_token": None,
        }
        if is_admin:
            if not existing_user.authorized:
                update_data["authorized"] = True
                existing_user.authorized = True
                logger.info("[OAuth] Auto-authorized configured admin %s", user_data["email"])
            if getattr(existing_user, "role", "curator") != "admin":
                update_data["role"] = "admin"
                existing_user.role = "admin"
                logger.info("[OAuth] Promoted configured admin %s", user_data["email"])

        db.users.update_one({"google_id": user_data["google_id"]}, {"$set": update_data})
        existing_user.name = user_data["name"]
        existing_user.picture = user_data.get("picture")
        existing_user.last_login = now
        existing_user.refresh_token = None
        logger.info("[OAuth] Updated existing user: %s", existing_user.email)
        return existing_user

    new_user = User(
        email=user_data["email"],
        google_id=user_data["google_id"],
        name=user_data["name"],
        picture=user_data.get("picture"),
        authorized=is_admin,
        role="admin" if is_admin else "curator",
        created_at=datetime.now(timezone.utc),
        last_login=datetime.now(timezone.utc),
        refresh_token=None,
    )
    result = db.users.insert_one(new_user.dict())
    user_dict = new_user.dict()
    user_dict["_id"] = str(result.inserted_id)
    logger.info("[OAuth] Created new user: %s", new_user.email)
    return UserInDB(**user_dict)


@router.get("/google")
def google_oauth_init(
    callback_url: Optional[str] = None,
    request: Request = None,
    db: Database = Depends(get_database),
):
    """Initiate Google OAuth with browser-bound, server-backed PKCE state."""
    if not settings.google_oauth_client_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OAuth not configured. Missing GOOGLE_OAUTH_CLIENT_ID",
        )
    if not settings.google_oauth_redirect_uri:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OAuth not configured. Missing GOOGLE_OAUTH_REDIRECT_URI",
        )

    frontend_redirect_url = callback_url
    if not frontend_redirect_url and request:
        referer = request.headers.get("referer", "")
        if referer:
            try:
                from urllib.parse import urlparse

                parsed = urlparse(referer)
                frontend_redirect_url = f"{parsed.scheme}://{parsed.netloc}"
            except Exception:
                frontend_redirect_url = None
    if not frontend_redirect_url:
        frontend_redirect_url = _default_frontend_url()

    trusted_origins = set(settings.trusted_callback_origins_list)
    if settings.environment == "development":
        trusted_origins.update(
            {
                "http://localhost:3000",
                "http://localhost:5500",
                "http://127.0.0.1:5500",
                "http://127.0.0.1:5501",
                "http://localhost:8080",
            }
        )
    if frontend_redirect_url not in trusted_origins:
        logger.warning("[OAuth] Untrusted callback_url rejected: %s", frontend_redirect_url)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Untrusted callback URL: {frontend_redirect_url}",
        )

    code_verifier, code_challenge = generate_pkce_pair()
    state_value, browser_binding = issue_oauth_state(
        db,
        code_verifier=code_verifier,
        frontend_url=frontend_redirect_url,
    )

    google_oauth_url = (
        "https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={settings.google_oauth_client_id}"
        f"&redirect_uri={settings.google_oauth_redirect_uri}"
        "&response_type=code"
        "&scope=openid email profile"
        f"&state={state_value}"
        f"&code_challenge={code_challenge}"
        "&code_challenge_method=S256"
    )
    response = RedirectResponse(url=google_oauth_url)
    _set_oauth_binding_cookie(response, browser_binding)
    logger.info("[OAuth] Initiating browser-bound PKCE flow to %s", frontend_redirect_url)
    return response


def _consume_callback_state(
    db: Database,
    *,
    state_value: str,
    request: Request | None,
) -> dict:
    browser_binding = request.cookies.get(_OAUTH_BINDING_COOKIE) if request else ""
    return consume_oauth_state(
        db,
        state=state_value,
        browser_binding=browser_binding,
    )


@router.get("/callback")
def google_oauth_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    db: Database = Depends(get_database),
    request: Request = None,
):
    """Consume the one-shot OAuth state, exchange the code and create a session."""
    if error:
        error_msg = "Login cancelled by user" if error == "access_denied" else "Login failed"
        error_redirect_url = _default_frontend_url()
        if state:
            try:
                flow = _consume_callback_state(db, state_value=state, request=request)
                error_redirect_url = flow["frontend_url"]
            except HTTPException:
                pass
        response = RedirectResponse(url=f"{error_redirect_url.rstrip('/')}/?auth_error={quote(error_msg)}")
        _clear_oauth_binding_cookie(response)
        return response

    if not code or not state:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing code or state parameter",
        )

    flow = _consume_callback_state(db, state_value=state, request=request)
    code_verifier = flow["code_verifier"]
    frontend_redirect_url = flow["frontend_url"]

    try:
        with httpx.Client(timeout=20.0) as client:
            token_response = client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": settings.google_oauth_client_id,
                    "client_secret": settings.google_oauth_client_secret,
                    "redirect_uri": settings.google_oauth_redirect_uri,
                    "grant_type": "authorization_code",
                    "code_verifier": code_verifier,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if token_response.status_code != 200:
                try:
                    error_data = token_response.json()
                except Exception:
                    error_data = {"status_code": token_response.status_code}
                logger.error("[OAuth] Token exchange failed: %s", error_data)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Failed to exchange authorization code",
                )

            token_data = token_response.json()
            userinfo_response = client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {token_data['access_token']}"},
            )
            if userinfo_response.status_code != 200:
                logger.error("[OAuth] Failed to get user info: %s", userinfo_response.status_code)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Failed to get user info from Google",
                )
            user_info = userinfo_response.json()
    except httpx.RequestError as exc:
        logger.error("[OAuth] Google request failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to communicate with Google",
        )

    user = create_or_update_user(
        db,
        {
            "email": user_info["email"],
            "google_id": user_info["id"],
            "name": user_info["name"],
            "picture": user_info.get("picture"),
        },
    )

    if user.authorized:
        curator_data = {
            "curator_id": user.email,
            "name": user.name,
            "email": user.email,
            "picture": user.picture,
            "google_id": user.google_id,
            "updatedAt": datetime.now(timezone.utc),
        }
        db.curators.update_one(
            {"curator_id": user.email},
            {
                "$set": curator_data,
                "$setOnInsert": {"createdAt": datetime.now(timezone.utc)},
            },
            upsert=True,
        )

    if not user.authorized:
        params = urlencode({"auth_error": "not_authorized", "user_email": user.email})
        response = RedirectResponse(url=f"{frontend_redirect_url.rstrip('/')}/?{params}")
        _clear_oauth_binding_cookie(response)
        return response

    access_token = create_access_token(
        data={
            "sub": user.email,
            "google_id": user.google_id,
            "role": getattr(user, "role", "curator"),
        },
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
    )
    refresh_token = _issue_refresh(db, user.email)

    same_site = False
    if request is not None:
        same_site = _is_same_site(frontend_redirect_url, str(request.url))
    redirect_url = _build_auth_redirect_url(
        frontend_url=frontend_redirect_url,
        access_token=access_token,
        refresh_token=refresh_token,
        user_email=user.email,
        user_name=user.name,
        same_site=same_site,
    )

    response = RedirectResponse(url=redirect_url)
    _clear_oauth_binding_cookie(response)
    _set_access_cookie(response, access_token)
    _set_refresh_cookie(response, refresh_token)
    return response


@router.get("/verify", response_model=UserAuthResponse)
def verify_token(
    auth: dict = Depends(verify_auth),
    db: Database = Depends(get_database),
):
    """Verify the current app access session and reload the live user."""
    if auth.get("method") == "api_key":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key has no user identity")

    email = auth.get("user")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing subject",
        )

    user = get_user_by_email(db, email)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not user.authorized:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User not authorized")

    return UserAuthResponse(
        email=user.email,
        name=user.name,
        picture=user.picture,
        authorized=user.authorized,
        role=getattr(user, "role", "curator"),
    )


@router.post("/refresh")
async def refresh_access_token(
    request: Request,
    response: Response,
    db: Database = Depends(get_database),
):
    """Rotate the Collector refresh token and its server-side session."""
    from app.core.security import create_access_token, verify_refresh_token
    from app.services.session_service import revoke_session

    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        body = {}
        content_type = request.headers.get("content-type", "")
        if "application/json" in content_type:
            try:
                body = await request.json() or {}
            except Exception:
                body = {}
        refresh_token = body.get("refresh_token")
    if not refresh_token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            refresh_token = auth_header[7:].strip()
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing refresh token",
        )

    token_data = await verify_refresh_token(refresh_token, db=db)
    email = token_data.get("sub")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token: missing subject",
        )

    user = get_user_by_email(db, email)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not user.authorized:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User not authorized")

    if token_data.get("jti"):
        revoke_session(db, token_data["jti"])

    new_access_token = create_access_token(
        data={"sub": user.email, "role": getattr(user, "role", "curator")}
    )
    new_refresh_token = _issue_refresh(db, user.email)
    _set_access_cookie(response, new_access_token)
    _set_refresh_cookie(response, new_refresh_token)
    return {
        "access_token": new_access_token,
        "refresh_token": new_refresh_token,
        "expires_in": settings.access_token_expire_minutes * 60,
        "token_type": "bearer",
        "user": UserAuthResponse(
            email=user.email,
            name=user.name,
            picture=user.picture,
            authorized=user.authorized,
            role=getattr(user, "role", "curator"),
        ),
    }


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    payload: Optional[TokenRefreshRequest] = None,
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth),
):
    """Revoke this user's refresh session and clear local auth cookies.

    Same-site clients normally send the HttpOnly refresh cookie. Legacy or
    cross-site clients may send the refresh JWT in the JSON body while using
    the access JWT for endpoint authentication. A supplied refresh can only
    revoke a session whose ``sub`` matches the authenticated user.
    """
    from app.core.security import ALGORITHM, get_jwt_secret
    from app.services.session_service import revoke_session

    if auth.get("method") == "api_key":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key has no session to revoke")

    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token and payload is not None:
        refresh_token = payload.refresh_token
    if not refresh_token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            refresh_token = auth_header[7:].strip()

    if refresh_token:
        try:
            token_data = jwt.decode(refresh_token, get_jwt_secret(), algorithms=[ALGORITHM])
            same_subject = token_data.get("sub") == auth.get("user")
            if token_data.get("type") == "refresh" and token_data.get("jti") and same_subject:
                revoke_session(db, token_data["jti"])
            elif token_data.get("type") == "refresh" and not same_subject:
                logger.warning("[OAuth] Refused refresh revocation for a different subject")
        except Exception as exc:
            logger.warning("[OAuth] Refresh revoke during logout was best-effort: %s", exc)

    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out successfully"}


@router.get("/dev-login")
def dev_login(response: Response, db: Database = Depends(get_database)):
    """Development-only login for local debugging."""
    if settings.environment != "development" or os.getenv("RENDER_SERVICE_NAME"):
        logger.warning("[DevLogin] Blocked (ENVIRONMENT=%s)", settings.environment)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dev login only available in development environment",
        )

    dev_email = "dev@collectordev.com"
    dev_name = "Dev User"
    user = get_user_by_email(db, dev_email)

    if not user:
        import uuid

        dev_user = {
            "email": dev_email,
            "google_id": f"dev-{uuid.uuid4().hex[:16]}",
            "name": dev_name,
            "picture": None,
            "authorized": True,
            "role": "admin",
            "created_at": datetime.now(timezone.utc),
            "last_login": datetime.now(timezone.utc),
            "refresh_token": None,
        }
        db.users.insert_one(dev_user)
        db.curators.update_one(
            {"curator_id": dev_email},
            {
                "$set": {
                    "curator_id": dev_email,
                    "name": dev_name,
                    "email": dev_email,
                    "picture": None,
                    "updatedAt": datetime.now(timezone.utc),
                    "createdAt": datetime.now(timezone.utc),
                }
            },
            upsert=True,
        )
    else:
        db.users.update_one(
            {"email": dev_email},
            {"$set": {"last_login": datetime.now(timezone.utc)}},
        )

    access_token = create_access_token(
        data={"sub": dev_email, "google_id": f"dev-{dev_email}", "role": "admin"},
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
    )
    refresh_token = _issue_refresh(db, dev_email)
    _set_access_cookie(response, access_token)
    _set_refresh_cookie(response, refresh_token)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_in": settings.access_token_expire_minutes * 60,
        "token_type": "bearer",
        "user_email": dev_email,
        "user_name": dev_name,
    }
