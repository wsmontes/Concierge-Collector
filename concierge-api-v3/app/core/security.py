"""
Security module for API authentication
Implements both API Key and JWT OAuth authentication
"""

import os
import secrets
from typing import Optional
from datetime import datetime, timedelta, timezone
from fastapi import Security, HTTPException, status, Depends, Request
from fastapi.security import APIKeyHeader, HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

from app.core.config import settings

# API Key header configuration
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

# Bearer token configuration
bearer_scheme = HTTPBearer(auto_error=False)

# JWT Configuration
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60  # 1 hour
REFRESH_TOKEN_EXPIRE_DAYS = 30  # 30 days


def get_api_secret_key() -> str:
    """
    Get API secret key from settings.

    Returns:
        str: API secret key

    Raises:
        RuntimeError: If API_SECRET_KEY is not configured
    """
    api_key = settings.api_secret_key
    if not api_key:
        raise RuntimeError(
            "API_SECRET_KEY not configured. "
            "Generate one with: python -c 'import secrets; print(secrets.token_urlsafe(32))'"
        )
    return api_key


def generate_api_key() -> str:
    """
    Generate a secure random API key.

    Returns:
        str: URL-safe base64-encoded random key (256 bits)
    """
    return secrets.token_urlsafe(32)


# ============================================================================
# JWT OAuth Token Functions
# ============================================================================


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create JWT access token for OAuth authentication

    Args:
        data: Payload data to encode (should include 'sub' for user email)
        expires_delta: Optional custom expiration time

    Returns:
        str: Encoded JWT token
    """
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({"exp": expire, "iat": datetime.now(timezone.utc), "type": "access"})

    # Use API secret key as JWT secret
    secret_key = get_api_secret_key()
    encoded_jwt = jwt.encode(to_encode, secret_key, algorithm=ALGORITHM)

    return encoded_jwt


def create_refresh_token(data: dict) -> str:
    """
    Create JWT refresh token for persistent authentication

    Args:
        data: Payload data to encode (should include 'sub' for user email)

    Returns:
        str: Encoded JWT refresh token
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update(
        {
            "exp": expire,
            "iat": datetime.now(timezone.utc),
            "type": "refresh",  # Distinguish from access tokens
        }
    )

    # Use API secret key as JWT secret
    secret_key = get_api_secret_key()
    encoded_jwt = jwt.encode(to_encode, secret_key, algorithm=ALGORITHM)

    return encoded_jwt


async def verify_refresh_token(token: str) -> dict:
    """
    Verify JWT refresh token

    Args:
        token: JWT refresh token

    Returns:
        dict: Decoded token payload

    Raises:
        HTTPException: 401 if token is invalid or expired
    """
    import logging

    logger = logging.getLogger(__name__)

    try:
        secret_key = get_api_secret_key()
        payload = jwt.decode(token, secret_key, algorithms=[ALGORITHM])

        # Verify it's a refresh token
        if payload.get("type") != "refresh":
            logger.warning("[Refresh Token] Not a refresh token")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Check expiration
        exp = payload.get("exp")
        if exp:
            exp_time = datetime.fromtimestamp(exp, tz=timezone.utc)
            now = datetime.now(timezone.utc)

            if now > exp_time:
                logger.warning("[Refresh Token] Token expired")
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Refresh token expired",
                    headers={"WWW-Authenticate": "Bearer"},
                )

        logger.info("[Refresh Token] ✓ Valid")
        return payload

    except JWTError as e:
        logger.error(f"[Refresh Token] JWT Error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid refresh token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def verify_access_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    """
    Verify JWT access token from Authorization: Bearer header

    Args:
        credentials: Bearer token credentials from header

    Returns:
        dict: Decoded token payload

    Raises:
        HTTPException: 401 if token is missing or invalid
    """
    import logging

    logger = logging.getLogger(__name__)

    # Test mode bypass — ONLY in development, NEVER in production.
    # Guards against accidentally leaving TESTING=true in deployed environments.
    if os.getenv("TESTING") == "true" and settings.environment == "development":
        logger.info("[Token Verify] TEST MODE - bypassing auth (development only)")
        return {
            "sub": "test@example.com",
            "email": "test@example.com",
            "name": "Test User",
            "picture": "https://example.com/avatar.jpg",
        }

    logger.info("[Token Verify] ========================================")
    logger.info(f"[Token Verify] Credentials present: {credentials is not None}")

    if not credentials:
        logger.warning("[Token Verify] ✗ Missing authorization token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    # Nunca logar o token (nem prefixo) — credencial revogável não deve
    # aparecer em logs coletados por terceiros.

    try:
        secret_key = get_api_secret_key()
        logger.info("[Token Verify] Decoding token...")
        payload = jwt.decode(token, secret_key, algorithms=[ALGORITHM])

        # Refresh token NUNCA vale como access (token confusion: um refresh
        # de viewer sem role era aceito aqui e viraria curator no verify_auth)
        if payload.get("type") != "access":
            logger.warning("[Token Verify] ✗ Not an access token")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type",
                headers={"WWW-Authenticate": "Bearer"},
            )

        logger.info("[Token Verify] ✓ Token decoded")
        logger.info(f"[Token Verify]   sub: {payload.get('sub')}")
        logger.info(f"[Token Verify]   exp: {payload.get('exp')}")

        # Check expiration
        exp = payload.get("exp")
        if exp:
            exp_time = datetime.fromtimestamp(exp, tz=timezone.utc)
            now = datetime.now(timezone.utc)
            logger.info(f"[Token Verify]   now: {now}")
            logger.info(f"[Token Verify]   exp_time: {exp_time}")

            if now > exp_time:
                logger.warning("[Token Verify] ✗ Token expired")
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Token expired",
                    headers={"WWW-Authenticate": "Bearer"},
                )

        logger.info("[Token Verify] ✓ Token valid")
        return payload

    except JWTError as e:
        logger.error(f"[Token Verify] ✗ JWT Error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except RuntimeError as e:
        logger.error(f"[Token Verify] ✗ Runtime Error: {str(e)}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


def verify_auth(
    request: Request,
    api_key: Optional[str] = Security(api_key_header),
    bearer: Optional[HTTPAuthorizationCredentials] = Security(bearer_scheme),
) -> dict:
    """Verify either API key (X-API-Key header) or JWT Bearer token.

    Returns a dict with authentication metadata. Use as a FastAPI dependency:
        auth: dict = Depends(verify_auth)

    Raises HTTPException(401) if neither credential is valid.
    Raises HTTPException(500) if API_SECRET_KEY is not configured.
    """
    import logging

    logger = logging.getLogger(__name__)

    # Try API key first
    if api_key:
        try:
            expected_key = get_api_secret_key()
            if secrets.compare_digest(api_key, expected_key):
                return {"authenticated": True, "method": "api_key"}
        except RuntimeError:
            # API_SECRET_KEY not configured — surface to operators
            logger.error("API_SECRET_KEY not configured — rejecting API key auth")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Server authentication not configured (missing API_SECRET_KEY)",
            )
        except Exception:
            pass

    # Try JWT Bearer token
    if bearer:
        try:
            payload = jwt.decode(bearer.credentials, get_api_secret_key(), algorithms=[ALGORITHM])
            # Refresh nunca vale como Bearer de API (paridade com
            # verify_access_token); role ausente/desconhecido = viewer
            # (default anterior era curator — escalation de refresh de viewer)
            if payload.get("type") != "access":
                raise JWTError("Not an access token")
            token_role = payload.get("role")
            role = token_role if token_role in ("admin", "curator", "viewer") else "viewer"
            return {
                "authenticated": True,
                "method": "jwt",
                "user": payload.get("sub"),
                "role": role,
            }
        except RuntimeError:
            logger.error("API_SECRET_KEY not configured — cannot decode JWT")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Server authentication not configured (missing API_SECRET_KEY)",
            )
        except JWTError:
            pass

    # Cookie HttpOnly (ADITIVO — o Bearer continua o caminho principal;
    # o cookie permite tirar o access token do localStorage numa próxima
    # fase. Pendência da auditoria de segurança, ago/2026.)
    access_cookie = request.cookies.get("access_token")
    if access_cookie:
        try:
            payload = jwt.decode(access_cookie, get_api_secret_key(), algorithms=[ALGORITHM])
            if payload.get("type") != "access":
                raise JWTError("Not an access token")
            token_role = payload.get("role")
            role = token_role if token_role in ("admin", "curator", "viewer") else "viewer"
            return {
                "authenticated": True,
                "method": "cookie",
                "user": payload.get("sub"),
                "role": role,
            }
        except (RuntimeError, JWTError):
            pass

    raise HTTPException(status_code=401, detail="Missing authorization token")


def is_admin_auth(auth: dict) -> bool:
    """True se a autenticação é admin: API key (scripts de bulk) ou JWT com
    role=admin. Usado nas regras de ownership (IDOR): admin pode atuar em
    nome de qualquer curator; curator comum só pode mexer no que é seu."""
    return auth.get("method") == "api_key" or auth.get("role") == "admin"


def require_role(required: str):
    """FastAPI dependency factory: exige role >= required no JWT.

    API key passa (scripts administrativos = admin). Viewer nunca escreve —
    auditoria ago/2026: os writes verificavam ownership mas não exigiam
    role mínima, então um viewer owner podia escrever.
    Uso: `auth: dict = Depends(require_role("curator"))`
    """
    from app.models.user import has_role

    def dependency(auth: dict = Depends(verify_auth)) -> dict:
        if auth.get("method") == "api_key":
            return auth
        if not has_role(auth.get("role", "viewer"), required):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires {required} role",
            )
        return auth

    return dependency


# Export main dependencies
__all__ = [
    "generate_api_key",
    "api_key_header",
    "verify_auth",
    "is_admin_auth",
]
