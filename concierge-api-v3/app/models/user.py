"""
User Model - MongoDB Schema for OAuth-authenticated users
"""

from pydantic import BaseModel, Field, EmailStr
from typing import Optional
from datetime import datetime


class User(BaseModel):
    """User model for authenticated users"""
    email: EmailStr = Field(..., description="User's email address from Google OAuth")
    google_id: str = Field(..., description="Google account ID (sub claim from OAuth)")
    name: str = Field(..., description="User's full name from Google")
    picture: Optional[str] = Field(None, description="User's profile picture URL")
    authorized: bool = Field(False, description="Whether user is authorized to use the application")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Account creation timestamp")
    last_login: Optional[datetime] = Field(None, description="Last login timestamp")
    refresh_token: Optional[str] = Field(None, description="Encrypted Google refresh token for persistent login")
    
    class Config:
        json_schema_extra = {
            "example": {
                "email": "user@example.com",
                "google_id": "1234567890",
                "name": "John Doe",
                "picture": "https://lh3.googleusercontent.com/...",
                "authorized": True,
                "created_at": "2025-01-15T10:30:00Z",
                "last_login": "2025-01-15T10:30:00Z"
            }
        }


class UserInDB(User):
    """User model with MongoDB document ID"""
    id: str = Field(..., alias="_id", description="MongoDB document ID")


class OAuthTokens(BaseModel):
    """OAuth token response model"""
    access_token: str = Field(..., description="OAuth access token")
    refresh_token: Optional[str] = Field(None, description="OAuth refresh token")
    expires_in: int = Field(..., description="Token lifetime in seconds")
    token_type: str = Field(default="Bearer", description="Token type")


class OAuthCallbackRequest(BaseModel):
    """OAuth callback request from frontend"""
    code: str = Field(..., description="Authorization code from Google")
    state: str = Field(..., description="State parameter for CSRF protection")


class OAuthCallbackResponse(BaseModel):
    """OAuth callback response to frontend"""
    tokens: OAuthTokens
    user: UserInDB


class TokenRefreshRequest(BaseModel):
    """Token refresh request"""
    refresh_token: str = Field(..., description="Refresh token")


class UserAuthResponse(BaseModel):
    """Authenticated user response"""
    email: EmailStr
    name: str
    picture: Optional[str]
    authorized: bool
