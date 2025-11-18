"""
Security module for API authentication
Implements API Key authentication via X-API-Key header
"""

import os
import secrets
from typing import Optional
from fastapi import Security, HTTPException, status
from fastapi.security import APIKeyHeader


# API Key header configuration
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def get_api_secret_key() -> str:
    """
    Get API secret key from environment variable.
    
    Returns:
        str: API secret key
        
    Raises:
        RuntimeError: If API_SECRET_KEY is not configured
    """
    api_key = os.getenv("API_SECRET_KEY")
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


# Export main dependencies
__all__ = [
    "verify_api_key",
    "optional_api_key",
    "generate_api_key",
    "api_key_header",
]
