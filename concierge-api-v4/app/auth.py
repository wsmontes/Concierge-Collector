"""
app/auth.py

Purpose: Authentication middleware and utilities
Responsibilities:
  - Verify JWT tokens from requests
  - Extract current user from token
  - Provide dependency for protected endpoints
Dependencies: FastAPI, python-jose
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional

from app.core.security import verify_token
from app.models import TokenData

# Security scheme
security = HTTPBearer()


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
