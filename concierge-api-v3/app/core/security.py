"""
Security module for API authentication
Implements both API Key and JWT OAuth authentication
"""

import os
import secrets
from typing import Optional
from datetime import datetime, timedelta
from fastapi import Security, HTTPException, status, Depends
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


async def verify_api_key(api_key: Optional[str] = Security(api_key_header)) -> str:
    """
    Verify API key from request header.
    
    This function should be used as a dependency in protected endpoints:
    
    Example:
        @router.post("/entities", dependencies=[Depends(verify_api_key)])
        async def create_entity(...):
            pass
    
    Args:
        api_key: API key from X-API-Key header
        
    Returns:
        str: Validated API key
        
    Raises:
        HTTPException: 403 if API key is missing or invalid
    """
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing API key. Include X-API-Key header in your request.",
            headers={"WWW-Authenticate": "ApiKey"},
        )
    
    try:
        expected_key = get_api_secret_key()
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )
    
    # Use secrets.compare_digest to prevent timing attacks
    if not secrets.compare_digest(api_key, expected_key):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid API key",
            headers={"WWW-Authenticate": "ApiKey"},
        )
    
    return api_key


async def optional_api_key(api_key: Optional[str] = Security(api_key_header)) -> Optional[str]:
    """
    Optional API key verification for endpoints that support both authenticated and public access.
    
    Returns None if no key provided, validates if key is provided.
    
    Args:
        api_key: API key from X-API-Key header
        
    Returns:
        Optional[str]: Validated API key or None
        
    Raises:
        HTTPException: 403 if API key is provided but invalid
    """
    if not api_key:
        return None
    
    try:
        expected_key = get_api_secret_key()
    except RuntimeError:
        # If API_SECRET_KEY not configured, allow public access
        return None
    
    if not secrets.compare_digest(api_key, expected_key):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid API key",
            headers={"WWW-Authenticate": "ApiKey"},
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
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire, "iat": datetime.utcnow()})
    
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
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({
        "exp": expire,
        "iat": datetime.utcnow(),
        "type": "refresh"  # Distinguish from access tokens
    })
    
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
            exp_time = datetime.utcfromtimestamp(exp)
            now = datetime.utcnow()
            
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
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)
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
    logger.info(f"[Token Verify] Token: {token[:20]}...")
    
    try:
        secret_key = get_api_secret_key()
        logger.info("[Token Verify] Decoding token...")
        payload = jwt.decode(token, secret_key, algorithms=[ALGORITHM])
        
        logger.info(f"[Token Verify] ✓ Token decoded")
        logger.info(f"[Token Verify]   sub: {payload.get('sub')}")
        logger.info(f"[Token Verify]   exp: {payload.get('exp')}")
        
        # Check expiration
        exp = payload.get("exp")
        if exp:
            exp_time = datetime.utcfromtimestamp(exp)  # FIX: Use utcfromtimestamp instead of fromtimestamp
            now = datetime.utcnow()
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
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


# Export main dependencies
__all__ = [
    "verify_api_key",
    "optional_api_key",
    "generate_api_key",
    "api_key_header",
]
