"""
app/routes/auth.py

Purpose: Authentication endpoints (register, login)
Responsibilities:
  - POST /auth/register - Register new user
  - POST /auth/login - Login and get JWT token
Dependencies: FastAPI, database, security utilities
"""

from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.security import OAuth2PasswordRequestForm
from typing import Dict

from app.models import UserRegister, Token
from app.core.security import get_password_hash, verify_password, create_access_token
from app import database

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=Dict[str, str], status_code=status.HTTP_200_OK)
async def register(user: UserRegister):
    """
    Register a new user
    
    Args:
        user: UserRegister with username, password, email
    
    Returns:
        Success message with curator_id
    
    Raises:
        HTTPException 400: If username already exists
    """
    # Check if user already exists
    existing_user = await database.get_user_by_username(user.username)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )
    
    # Hash password
    hashed_password = get_password_hash(user.password)
    
    # Create user document
    user_data = {
        "username": user.username,
        "email": user.email,
        "hashed_password": hashed_password,
    }
    
    # Insert into database
    curator_id = await database.create_user(user_data)
    
    return {
        "message": "User registered successfully",
        "curator_id": curator_id,
    }


@router.post("/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    """
    Login and get JWT access token
    
    Args:
        form_data: OAuth2 form with username and password
    
    Returns:
        Token with access_token and token_type
    
    Raises:
        HTTPException 401: If credentials are invalid
    """
    # Get user from database
    user = await database.get_user_by_username(form_data.username)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Verify password
    if not verify_password(form_data.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Create access token
    access_token = create_access_token(
        data={"sub": user["curator_id"], "email": user["email"]}
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
    }
