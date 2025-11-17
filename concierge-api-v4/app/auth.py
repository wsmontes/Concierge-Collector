"""
app/auth.py

Purpose: Authentication middleware and utilities
Responsibilities:
  - Verify JWT tokens from requests
  - Extract current user from token
  - Provide dependency for protected endpoints
  - Support dev mode without authentication
Dependencies: FastAPI, python-jose
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional

from app.core.security import verify_token
from app.core.config import settings
from app.models import TokenData

# Security scheme
security = HTTPBearer(auto_error=False)  # Don't auto-error to support dev mode

# Dev mode configuration from settings
DEV_MODE = settings.dev_mode
DEV_USER_ID = settings.dev_user_id
DEV_USER_EMAIL = settings.dev_user_email


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> TokenData:
    """
    Dependency to get current authenticated user
    
    Usage:
        @app.get("/protected")
        async def protected_route(user: TokenData = Depends(get_current_user)):
            return {"curator_id": user.curator_id}
    
    Args:
        credentials: JWT token from Authorization header
    
    Returns:
        TokenData with curator_id and email
    
    Raises:
        HTTPException: If token is invalid or expired
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    token = credentials.credentials
    payload = verify_token(token)
    
    if payload is None:
        raise credentials_exception
    
    curator_id: Optional[str] = payload.get("sub")
    email: Optional[str] = payload.get("email")
    
    if curator_id is None:
        raise credentials_exception
    
    return TokenData(curator_id=curator_id, email=email)


async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[TokenData]:
    """
    Optional authentication dependency
    Returns user if authenticated, None otherwise
    """
    if credentials is None:
        return None
    
    try:
        return await get_current_user(credentials)
    except HTTPException:
        return None


async def get_current_user_dev(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> TokenData:
    """
    Development-friendly authentication dependency
    
    In DEV_MODE (set in .env):
      - Returns default dev user without requiring token
      - Allows testing without authentication setup
    
    In Production:
      - Requires valid JWT token (same as get_current_user)
    
    Usage:
        @app.post("/entities")
        async def create_entity(user: TokenData = Depends(get_current_user_dev)):
            # Works in dev without token, requires token in prod
            return {"curator_id": user.curator_id}
    
    Returns:
        TokenData with curator_id and email
    """
    # Dev mode: bypass authentication
    if DEV_MODE:
        print(f"⚠️  DEV MODE: Using default user {DEV_USER_ID} (no auth required)")
        return TokenData(curator_id=DEV_USER_ID, email=DEV_USER_EMAIL)
    
    # Production mode: require authentication
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return await get_current_user(credentials)
