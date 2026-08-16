"""
Authentication Router - Google OAuth 2.0 with PKCE
Implements secure OAuth flow following best practices:
- Authorization Code Flow with PKCE
- State parameter for CSRF protection
- JWT tokens for session management
- User authorization via MongoDB
"""

from fastapi import APIRouter, HTTPException, Depends, status, Request
from fastapi.responses import RedirectResponse, Response
from pymongo.database import Database
from datetime import datetime, timedelta, timezone
import httpx
from jose import jwt
import secrets
import hashlib
import base64
from typing import Optional
import logging

from app.core.config import settings
from app.core.database import get_database
from app.core.security import create_access_token, verify_auth
from app.models.user import (
    User,
    UserInDB,
    UserAuthResponse,
)

# Setup logging
logger = logging.getLogger(__name__)


def _set_access_cookie(response: Response, access_token: str) -> None:
    """Cookie HttpOnly com o access token (aditivo — o Bearer continua o
    caminho principal). Pendência da auditoria de segurança, ago/2026."""
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
    """Cookie HttpOnly com o refresh token (2026-08-15) — tira o refresh do
    localStorage/URL no deploy same-site. SameSite=Lax é suficiente: Render
    web → Render API é same-site; o legado GitHub Pages (cross-site) segue
    no caminho Bearer/body."""
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        samesite="lax",
        secure=settings.environment == "production",
        max_age=settings.refresh_token_expire_days * 86400,
        path="/",
    )


def _is_same_site(url_a: str, url_b: str) -> bool:
    """Compara o SITE (scheme + registrable domain) de duas URLs — a mesma
    regra que o SameSite=Lax do browser usa para enviar o cookie.

    IPs e hostnames locais (localhost vs 127.0.0.1) valem por igualdade
    exata: são sites diferentes para cookie — o caminho legado (tokens na
    URL) segue cobrindo dev e GitHub Pages.
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
            return host  # IP: identidade exata
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
    """Redirect pós-login. Same-site → SEM tokens na URL (o cookie HttpOnly é
    o portador; `?session=1` sinaliza o frontend para autenticar via cookie).
    Cross-site legado (GitHub Pages) → tokens na URL, como antes (o cookie
    Lax não é enviado cross-site)."""
    base = f"{frontend_url.rstrip('/')}/"
    if same_site:
        return f"{base}?session=1"
    return (
        f"{base}"
        f"?token={access_token}"
        f"&refresh_token={refresh_token}"
        f"&expires_in={settings.access_token_expire_minutes * 60}"
        f"&user_email={user_email}"
        f"&user_name={user_name}"
    )


def _issue_refresh(db: Database, email: str) -> str:
    """Emite refresh token e REGISTRA a sessão (jti) em auth_sessions —
    rotação/revogação 2026-08-15."""
    from app.core.security import ALGORITHM, create_refresh_token, get_jwt_secret
    from app.services.session_service import register_session

    token = create_refresh_token(data={"sub": email})
    payload = jwt.decode(token, get_jwt_secret(), algorithms=[ALGORITHM])
    register_session(db, payload["jti"], email)
    return token


router = APIRouter(prefix="/auth", tags=["authentication"])

# OAuth state storage removed in favor of stateless JWT-based state


def generate_pkce_pair() -> tuple[str, str]:
    """
    Generate PKCE code_verifier and code_challenge

    Returns:
        tuple: (code_verifier, code_challenge)
    """
    # Generate random code_verifier (43-128 characters)
    code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("utf-8").rstrip("=")

    # Create code_challenge (SHA256 hash of verifier)
    challenge_bytes = hashlib.sha256(code_verifier.encode("utf-8")).digest()
    code_challenge = base64.urlsafe_b64encode(challenge_bytes).decode("utf-8").rstrip("=")

    return code_verifier, code_challenge


def generate_state(state_data: str) -> str:
    """
    Generate signed state parameter for CSRF protection (Stateless)

    Args:
        state_data: Data to sign (code_verifier|frontend_url)

    Returns:
        str: JWT signed state
    """
    from app.core.security import ALGORITHM

    expires = datetime.now(timezone.utc) + timedelta(minutes=10)
    payload = {
        "sd": state_data,
        "exp": expires,
        "iat": datetime.now(timezone.utc),
        "type": "oauth_state",
    }

    # JWT_SIGNING_SECRET (separação de segredos 2026-08-15)
    from app.core.security import get_jwt_secret

    secret_key = get_jwt_secret()
    state = jwt.encode(payload, secret_key, algorithm=ALGORITHM)

    logger.info(f"[OAuth] Generated stateless state (expires: {expires})")
    return state


def verify_state(state: str) -> Optional[str]:
    """
    Verify signed state parameter

    Args:
        state: JWT signed state from callback

    Returns:
        str: code_verifier data if valid, None if invalid/expired
    """
    from app.core.security import ALGORITHM, get_jwt_secret, JWTError

    try:
        secret_key = get_jwt_secret()
        payload = jwt.decode(state, secret_key, algorithms=[ALGORITHM])

        # Verify it's an OAuth state token
        if payload.get("type") != "oauth_state":
            logger.warning("[OAuth] Invalid state token type")
            return None

        state_data = payload.get("sd")
        logger.info("[OAuth] Stateless state verified")
        return state_data

    except JWTError as e:
        logger.error(f"[OAuth] State validation failed: {str(e)}")
        return None


def get_user_by_google_id(db: Database, google_id: str) -> Optional[UserInDB]:
    """Get user from database by Google ID"""
    user_doc = db.users.find_one({"google_id": google_id})
    if user_doc:
        user_doc["_id"] = str(user_doc["_id"])
        return UserInDB(**user_doc)
    return None


def get_user_by_email(db: Database, email: str) -> Optional[UserInDB]:
    """Get user from database by email"""
    user_doc = db.users.find_one({"email": email})
    if user_doc:
        user_doc["_id"] = str(user_doc["_id"])
        return UserInDB(**user_doc)
    return None


def create_or_update_user(db: Database, user_data: dict) -> UserInDB:
    """
    Create new user or update existing user's last login and refresh token.
    Emails da allowlist ADMIN_EMAILS (legado: domínio @lotier.com) são
    auto-autorizados com role=admin. Separação de segredos/boundary
    explícita (2026-08-15).
    New non-admin users start as unauthorized with role=curator.
    """
    is_lotier = settings.is_admin_email(user_data["email"])
    existing_user = get_user_by_google_id(db, user_data["google_id"])

    if existing_user:
        update_data = {
            "name": user_data["name"],
            "picture": user_data.get("picture"),
            "last_login": datetime.now(timezone.utc),
        }

        # Auto-authorize Lotier users and promote to admin if not already
        if is_lotier:
            if not existing_user.authorized:
                update_data["authorized"] = True
                existing_user.authorized = True
                logger.info(f"[OAuth] Auto-authorized existing user from domain: {user_data['email']}")
            if getattr(existing_user, "role", "curator") != "admin":
                update_data["role"] = "admin"
                logger.info(f"[OAuth] Promoted {user_data['email']} to admin")

        if user_data.get("refresh_token"):
            update_data["refresh_token"] = user_data["refresh_token"]

        db.users.update_one({"google_id": user_data["google_id"]}, {"$set": update_data})

        existing_user.name = user_data["name"]
        existing_user.picture = user_data.get("picture")
        existing_user.last_login = datetime.now(timezone.utc)
        if user_data.get("refresh_token"):
            existing_user.refresh_token = user_data["refresh_token"]
        logger.info(f"[OAuth] Updated existing user: {existing_user.email} (name, picture, last_login)")
        return existing_user
    else:
        new_user = User(
            email=user_data["email"],
            google_id=user_data["google_id"],
            name=user_data["name"],
            picture=user_data.get("picture"),
            authorized=is_lotier,
            role="admin" if is_lotier else "curator",
            created_at=datetime.now(timezone.utc),
            last_login=datetime.now(timezone.utc),
            refresh_token=user_data.get("refresh_token"),
        )
        result = db.users.insert_one(new_user.dict())
        user_dict = new_user.dict()
        user_dict["_id"] = str(result.inserted_id)

        auth_status = "True (Auto-authorized, admin)" if is_lotier else "False (curator)"
        logger.info(f"[OAuth] Created new user: {new_user.email} (authorized={auth_status})")
        return UserInDB(**user_dict)


@router.get("/google")
def google_oauth_init(callback_url: Optional[str] = None, request: Request = None):
    """
    Initiate Google OAuth 2.0 flow with PKCE

    Flow:
    1. Determine frontend URL (from parameter, referer, or default)
    2. Generate PKCE code_verifier and code_challenge
    3. Generate state for CSRF protection (includes frontend URL)
    4. Redirect to Google OAuth consent screen

    Args:
        callback_url: Optional frontend URL to redirect after OAuth
        request: FastAPI request object to extract referer

    Returns:
        RedirectResponse: Redirect to Google OAuth URL
    """
    # Validate configuration
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

    # Determine frontend URL for final redirect
    frontend_redirect_url = callback_url
    if not frontend_redirect_url and request:
        # Extract origin from Referer header (works for any domain: Render, localhost, custom)
        referer = request.headers.get("referer", "")
        if referer:
            try:
                from urllib.parse import urlparse

                parsed = urlparse(referer)
                frontend_redirect_url = f"{parsed.scheme}://{parsed.netloc}"
            except Exception:
                pass
    if not frontend_redirect_url:
        frontend_redirect_url = settings.frontend_url

    # Validate frontend_redirect_url against config-driven trusted origins
    trusted_origins = set(settings.trusted_callback_origins_list)
    # Also accept localhost dev URLs (not stored in production config)
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
        logger.warning(f"[OAuth] Untrusted callback_url rejected: {frontend_redirect_url}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Untrusted callback URL: {frontend_redirect_url}",
        )

    # Generate PKCE pair
    code_verifier, code_challenge = generate_pkce_pair()

    # Generate state and store code_verifier + frontend URL
    state_data = f"{code_verifier}|{frontend_redirect_url}"
    state = generate_state(state_data)

    logger.info("[OAuth] Initiating flow")
    logger.info(f"[OAuth] redirect_uri: {settings.google_oauth_redirect_uri}")
    logger.info(f"[OAuth] frontend_redirect_url: {frontend_redirect_url}")
    logger.info("[OAuth] PKCE challenge generated")

    # Build Google OAuth URL
    google_oauth_url = (
        "https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={settings.google_oauth_client_id}"
        f"&redirect_uri={settings.google_oauth_redirect_uri}"
        "&response_type=code"
        "&scope=openid email profile"
        "&access_type=offline"  # Request refresh token
        "&prompt=consent"  # Force consent screen to get refresh token
        f"&state={state}"
        f"&code_challenge={code_challenge}"
        "&code_challenge_method=S256"
    )

    return RedirectResponse(url=google_oauth_url)


@router.get("/callback")
def google_oauth_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    db: Database = Depends(get_database),
    request: Request = None,
):
    """
    Handle OAuth callback from Google

    Flow:
    1. Verify state (CSRF protection)
    2. Exchange authorization code for tokens
    3. Get user info from Google
    4. Create/update user in MongoDB
    5. Generate JWT for app session
    6. Redirect to frontend with tokens

    Args:
        code: Authorization code from Google
        state: State parameter for CSRF validation
        error: Error from Google (if user cancelled)

    Returns:
        RedirectResponse: Redirect to frontend with tokens or error
    """
    logger.info("=" * 60)
    logger.info("[OAuth] ⚡ CALLBACK ENDPOINT HIT")
    logger.info("=" * 60)
    logger.info("[OAuth] Callback received")
    logger.info(f"[OAuth]   code: {'present' if code else 'MISSING'}")
    logger.info(f"[OAuth]   state: {'present' if state else 'MISSING'}")
    logger.info(f"[OAuth]   error: {error if error else 'none'}")

    # Handle user cancellation or Google errors
    if error:
        # SÓ erros conhecidos do Google viram mensagem — o valor volta ao
        # frontend via redirect e é renderizado na tela de login: ecoar o
        # query param cru permitiria XSS no origin do collector (anti-XSS).
        error_msg = "Login cancelled by user" if error == "access_denied" else "Login failed"
        logger.warning(f"[OAuth] Error in callback: {error}")
        # Try to extract frontend URL from state, fall back to default
        error_redirect_url = settings.frontend_url
        if state:
            try:
                state_data = verify_state(state)
                if state_data:
                    parts = state_data.split("|", 1)
                    if len(parts) > 1:
                        error_redirect_url = parts[1]
            except Exception:
                pass
        from urllib.parse import quote

        return RedirectResponse(url=f"{error_redirect_url}/?auth_error={quote(error_msg)}")

    # Validate required parameters
    if not code or not state:
        logger.error("[OAuth] Missing code or state parameter")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing code or state parameter",
        )

    # Verify state and get code_verifier + frontend URL (CSRF protection)
    state_data = verify_state(state)
    if not state_data:
        logger.error("[OAuth] Invalid or expired state parameter")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired state parameter (CSRF check failed)",
        )

    # Extract code_verifier and frontend_redirect_url from state
    parts = state_data.split("|", 1)
    code_verifier = parts[0]
    frontend_redirect_url = parts[1] if len(parts) > 1 else settings.frontend_url

    logger.info(f"[OAuth] Frontend redirect URL from state: {frontend_redirect_url}")

    # Exchange authorization code for tokens
    try:
        logger.info("[OAuth] Exchanging code for tokens...")
        logger.info(f"[OAuth]   redirect_uri: {settings.google_oauth_redirect_uri}")
        logger.info("[OAuth]   using PKCE code_verifier")

        with httpx.Client() as client:
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
                error_data = token_response.json()
                error_desc = error_data.get("error_description", error_data.get("error", "Unknown error"))
                logger.error(f"[OAuth] Token exchange failed: {error_desc}")
                logger.error(f"[OAuth] Response: {error_data}")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to exchange authorization code: {error_desc}",
                )

            token_data = token_response.json()
            logger.info("[OAuth] ✓ Tokens received from Google")

            # Get user info from Google
            logger.info("[OAuth] Fetching user info...")
            userinfo_response = client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {token_data['access_token']}"},
            )

            if userinfo_response.status_code != 200:
                logger.error(f"[OAuth] Failed to get user info: {userinfo_response.status_code}")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Failed to get user info from Google",
                )

            user_info = userinfo_response.json()
            logger.info(f"[OAuth] ✓ User info retrieved: {user_info.get('email')}")

            # Store Google refresh token if available
            google_refresh_token = token_data.get("refresh_token")
            if google_refresh_token:
                logger.info("[OAuth] ✓ Refresh token received from Google")

    except httpx.RequestError as e:
        logger.error(f"[OAuth] HTTP request failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to communicate with Google: {str(e)}",
        )

    # Create or update user in database (include refresh token)
    user = create_or_update_user(
        db,
        {
            "email": user_info["email"],
            "google_id": user_info["id"],
            "name": user_info["name"],
            "picture": user_info.get("picture"),
            "refresh_token": google_refresh_token,
        },
    )

    logger.info(f"[OAuth] User: {user.email}")
    logger.info(f"[OAuth]   authorized: {user.authorized}")

    # Create/update curator profile automatically
    if user.authorized:
        curator_data = {
            "curator_id": user.email,  # Use email as curator ID
            "name": user.name,
            "email": user.email,
            "picture": user.picture,
            "google_id": user.google_id,
            "updatedAt": datetime.now(timezone.utc),
        }

        # Upsert curator in curators collection
        db.curators.update_one(
            {"curator_id": user.email},
            {
                "$set": curator_data,
                "$setOnInsert": {"createdAt": datetime.now(timezone.utc)},
            },
            upsert=True,
        )
        logger.info(f"[OAuth] ✓ Curator profile created/updated for {user.email}")

    # Check if user is authorized
    if not user.authorized:
        logger.warning(f"[OAuth] User {user.email} is NOT authorized")
        # Redirect to frontend with error parameter
        redirect_url = f"{frontend_redirect_url}/?auth_error=not_authorized&user_email={user.email}"
        logger.info(f"[OAuth] Redirecting unauthorized user to: {redirect_url}")
        return RedirectResponse(url=redirect_url)

    # User is authorized - create JWT tokens for app session
    logger.info("[OAuth] Creating JWT tokens...")
    access_token = create_access_token(
        data={
            "sub": user.email,
            "google_id": user.google_id,
            "role": getattr(user, "role", "curator"),
        },
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
    )

    # Create refresh token for persistent login (+ sessão server-side)
    refresh_token = _issue_refresh(db, user.email)

    logger.info("[OAuth] ✓ JWT tokens created")

    # Same-site (Render→Render): o cookie HttpOnly é o portador — SEM tokens
    # na URL (vazam via Referer/histórico/logs). Cross-site legado (GitHub
    # Pages): mantém tokens na URL (o cookie Lax não é enviado lá).
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

    logger.info(f"[OAuth] ✓ Redirecting to frontend: {frontend_redirect_url} (same_site={same_site})")

    # TEMP-DIAG (login loop OAuth): o que o callback envia de fato
    logger.warning(
        "[AUTH-DIAG] callback success: same_site=%s env=%s secure_cookie=%s redirect=%s",
        same_site,
        settings.environment,
        settings.environment == "production",
        redirect_url[:140],
    )

    response = RedirectResponse(url=redirect_url)
    _set_access_cookie(response, access_token)
    _set_refresh_cookie(response, refresh_token)
    # TEMP-DIAG: SÓ os atributos das cookies (o valor é o JWT — nunca logar;
    # regra f797959: tokenData nunca vai para log)
    logger.warning(
        "[AUTH-DIAG] callback set-cookie attrs: %s",
        [
            h[1].decode("latin-1").split("; ", 1)[1] if b"; " in h[1] else "(sem attrs)"
            for h in response.raw_headers
            if h[0] == b"set-cookie"
        ],
    )
    return response


@router.get("/verify", response_model=UserAuthResponse)
def verify_token(
    auth: dict = Depends(verify_auth),
    db: Database = Depends(get_database),
):
    """
    Verify JWT access token and return user data

    Aceita Bearer OU cookie HttpOnly (migração 2026-08-15). API key não tem
    identidade de usuário — recusada.

    Returns:
        UserAuthResponse: User data if token is valid and user is authorized
    """
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

    logger.info(f"[OAuth] Token verified for user: {user.email}")

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
    """
    Refresh access token — ROTAÇÃO (2026-08-15).

    Aceita o refresh token de três fontes (prioridade):
      1. cookie HttpOnly `refresh_token` (caminho principal same-site);
      2. body JSON `refresh_token` (compat legado cross-site);
      3. header Authorization Bearer.

    Cada uso REVOGA o jti antigo e emite par novo (replay detectável).
    """
    from app.core.security import (
        verify_refresh_token,
        create_access_token,
    )
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

    # Verify refresh token (com sessão server-side quando houver jti)
    token_data = await verify_refresh_token(refresh_token, db=db)

    email = token_data.get("sub")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token: missing subject",
        )

    # Get user from database
    user = get_user_by_email(db, email)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if not user.authorized:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User not authorized")

    # ROTAÇÃO: o jti usado morre aqui — um replay do token antigo bate em
    # sessão inexistente no verify_refresh_token
    if token_data.get("jti"):
        revoke_session(db, token_data["jti"])

    # Create new tokens
    new_access_token = create_access_token(data={"sub": user.email, "role": getattr(user, "role", "curator")})
    new_refresh_token = _issue_refresh(db, user.email)

    logger.info(f"[OAuth] Token refreshed for user: {user.email}")

    _set_access_cookie(response, new_access_token)
    _set_refresh_cookie(response, new_refresh_token)
    return {
        "access_token": new_access_token,
        "refresh_token": new_refresh_token,
        "expires_in": settings.access_token_expire_minutes * 60,  # Return expiry time in seconds
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
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth),
):
    """
    Logout — revoga a sessão de refresh server-side (2026-08-15).

    Antes: só apagava o cookie client-side; um refresh token roubado seguia
    válido até expirar (30 dias). Agora o jti do refresh (cookie > Bearer) é
    revogado na coleção auth_sessions.
    """
    from app.core.security import ALGORITHM, get_jwt_secret
    from app.services.session_service import revoke_session

    if auth.get("method") == "api_key":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key has no session to revoke")

    email = auth.get("user")
    logger.info(f"[OAuth] User logged out: {email}")

    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            refresh_token = auth_header[7:].strip()
    if refresh_token:
        try:
            payload = jwt.decode(refresh_token, get_jwt_secret(), algorithms=[ALGORITHM])
            if payload.get("jti"):
                revoke_session(db, payload["jti"])
                logger.info(f"[OAuth] Refresh session revoked: {payload['jti']}")
        except Exception as e:
            logger.warning(f"[OAuth] Falha ao revogar refresh no logout: {e}")

    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out successfully"}


@router.get("/dev-login")
def dev_login(response: Response, db: Database = Depends(get_database)):
    """
    Development-only login — bypass Google OAuth for local debugging.

    Creates or retrieves a test admin user and returns valid JWT tokens.
    Only works when ENVIRONMENT=development. Returns 403 in production.

    Returns:
        dict: access_token, refresh_token, expires_in, user_email, user_name
    """
    from app.core.security import create_access_token
    from datetime import timedelta

    # 🔒 CRITICAL: Only available in development
    if settings.environment != "development":
        logger.warning(f"[DevLogin] ⛔ Blocked in production (ENVIRONMENT={settings.environment})")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dev login only available in development environment",
        )

    logger.info("[DevLogin] 🔧 Development login requested")

    dev_email = "dev@collectordev.com"
    dev_name = "Dev User"

    # Check if dev user already exists
    user = get_user_by_email(db, dev_email)

    if not user:
        # Create dev user directly in MongoDB (skip OAuth fields)
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
        result = db.users.insert_one(dev_user)
        dev_user["_id"] = str(result.inserted_id)
        logger.info(f"[DevLogin] ✓ Created dev user: {dev_email}")

        # Also create curator profile
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
        # Update last_login
        db.users.update_one({"email": dev_email}, {"$set": {"last_login": datetime.now(timezone.utc)}})
        logger.info(f"[DevLogin] ✓ Using existing dev user: {dev_email}")

    # Generate real JWT tokens — refresh com sessão registrada (rotação 2026-08-15)
    access_token = create_access_token(
        data={"sub": dev_email, "google_id": f"dev-{dev_email}", "role": "admin"},
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
    )
    refresh_token = _issue_refresh(db, dev_email)

    logger.info(f"[DevLogin] ✓ Tokens generated (expires in {settings.access_token_expire_minutes}m)")

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
