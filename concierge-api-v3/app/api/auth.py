"""
Authentication Router - Google OAuth 2.0 with PKCE
Implements secure OAuth flow following best practices:
- Authorization Code Flow with PKCE
- State parameter for CSRF protection
- JWT tokens for session management
- User authorization via MongoDB
"""

from fastapi import APIRouter, HTTPException, Depends, status, Request
from fastapi.responses import RedirectResponse, HTMLResponse
from pymongo.database import Database
from datetime import datetime, timedelta, timezone
import httpx
import secrets
import hashlib
import base64
from typing import Optional
import logging

from app.core.config import settings
from app.core.database import get_database
from app.core.security import create_access_token, verify_access_token
from app.models.user import (
    User, UserInDB, OAuthTokens, UserAuthResponse, TokenRefreshRequest
)

# Setup logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["authentication"])

# OAuth state storage (in production, use Redis)
# Structure: {state: {"created": datetime, "code_verifier": str}}
_oauth_states = {}


def generate_pkce_pair() -> tuple[str, str]:
    """
    Generate PKCE code_verifier and code_challenge
    
    Returns:
        tuple: (code_verifier, code_challenge)
    """
    # Generate random code_verifier (43-128 characters)
    code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode('utf-8').rstrip('=')
    
    # Create code_challenge (SHA256 hash of verifier)
    challenge_bytes = hashlib.sha256(code_verifier.encode('utf-8')).digest()
    code_challenge = base64.urlsafe_b64encode(challenge_bytes).decode('utf-8').rstrip('=')
    
    return code_verifier, code_challenge


def generate_state(code_verifier: str) -> str:
    """
    Generate CSRF protection state parameter and store with code_verifier
    
    Args:
        code_verifier: PKCE code verifier to store with state
        
    Returns:
        str: Random state token
    """
    state = secrets.token_urlsafe(32)
    _oauth_states[state] = {
        "created": datetime.now(timezone.utc),
        "code_verifier": code_verifier
    }
    logger.info(f"[OAuth] Generated state: {state[:10]}...")
    return state


def verify_state(state: str) -> Optional[str]:
    """
    Verify CSRF state parameter and return code_verifier
    
    Args:
        state: State parameter from callback
        
    Returns:
        str: code_verifier if valid, None if invalid/expired
    """
    if state not in _oauth_states:
        logger.warning(f"[OAuth] State not found: {state[:10]}...")
        return None
    
    state_data = _oauth_states[state]
    created = state_data["created"]
    age = (datetime.now(timezone.utc) - created).total_seconds()
    
    # State expires after 5 minutes
    if age > 300:
        logger.warning(f"[OAuth] State expired (age: {age}s)")
        del _oauth_states[state]
        return None
    
    # Valid state, return code_verifier and clean up
    code_verifier = state_data["code_verifier"]
    del _oauth_states[state]
    logger.info(f"[OAuth] State verified: {state[:10]}...")
    
    return code_verifier


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
    Create new user or update existing user's last login and refresh token
    New users are created as unauthorized by default
    """
    existing_user = get_user_by_google_id(db, user_data["google_id"])
    
    if existing_user:
        # Update user info from Google (name, picture can change)
        update_data = {
            "name": user_data["name"],
            "picture": user_data.get("picture"),
            "last_login": datetime.now(timezone.utc)
        }
        if user_data.get("refresh_token"):
            update_data["refresh_token"] = user_data["refresh_token"]
        
        db.users.update_one(
            {"google_id": user_data["google_id"]},
            {"$set": update_data}
        )
        
        # Update local object
        existing_user.name = user_data["name"]
        existing_user.picture = user_data.get("picture")
        existing_user.last_login = datetime.now(timezone.utc)
        if user_data.get("refresh_token"):
            existing_user.refresh_token = user_data["refresh_token"]
        logger.info(f"[OAuth] Updated existing user: {existing_user.email} (name, picture, last_login)")
        return existing_user
    else:
        # Create new user (unauthorized by default)
        new_user = User(
            email=user_data["email"],
            google_id=user_data["google_id"],
            name=user_data["name"],
            picture=user_data.get("picture"),
            authorized=False,  # Admin must authorize
            created_at=datetime.now(timezone.utc),
            last_login=datetime.now(timezone.utc),
            refresh_token=user_data.get("refresh_token")
        )
        result = db.users.insert_one(new_user.dict())
        user_dict = new_user.dict()
        user_dict["_id"] = str(result.inserted_id)
        logger.info(f"[OAuth] Created new user: {new_user.email} (authorized=False)")
        return UserInDB(**user_dict)


@router.get("/google")
def google_oauth_init(
    callback_url: Optional[str] = None,
    request: Request = None
):
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
            detail="OAuth not configured. Missing GOOGLE_OAUTH_CLIENT_ID"
        )
    
    if not settings.google_oauth_redirect_uri:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OAuth not configured. Missing GOOGLE_OAUTH_REDIRECT_URI"
        )
    
    # Determine frontend URL for final redirect
    frontend_redirect_url = callback_url
    if not frontend_redirect_url and request:
        # Try to extract from referer header
        referer = request.headers.get('referer', '')
        if 'github.io' in referer:
            frontend_redirect_url = settings.frontend_url_production
        elif 'localhost' in referer or '127.0.0.1' in referer:
            frontend_redirect_url = settings.frontend_url
    
    # Default to configured frontend_url
    if not frontend_redirect_url:
        frontend_redirect_url = settings.frontend_url
    
    # Generate PKCE pair
    code_verifier, code_challenge = generate_pkce_pair()
    
    # Generate state and store code_verifier + frontend URL
    state_data = f"{code_verifier}|{frontend_redirect_url}"
    state = generate_state(state_data)
    
    logger.info(f"[OAuth] Initiating flow")
    logger.info(f"[OAuth] redirect_uri: {settings.google_oauth_redirect_uri}")
    logger.info(f"[OAuth] frontend_redirect_url: {frontend_redirect_url}")
    logger.info(f"[OAuth] PKCE challenge generated")
    
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
    db: Database = Depends(get_database)
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
    logger.info(f"[OAuth] ⚡ CALLBACK ENDPOINT HIT")
    logger.info("=" * 60)
    logger.info(f"[OAuth] Callback received")
    logger.info(f"[OAuth]   code: {'present' if code else 'MISSING'}")
    logger.info(f"[OAuth]   state: {'present' if state else 'MISSING'}")
    logger.info(f"[OAuth]   error: {error if error else 'none'}")
    
    # Handle user cancellation or Google errors
    if error:
        error_msg = error
        if error == "access_denied":
            error_msg = "Login cancelled by user"
        logger.warning(f"[OAuth] Error in callback: {error_msg}")
        return RedirectResponse(url=f"{settings.frontend_url}/?auth_error={error_msg}")
    
    # Validate required parameters
    if not code or not state:
        logger.error("[OAuth] Missing code or state parameter")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing code or state parameter"
        )
    
    # Verify state and get code_verifier + frontend URL (CSRF protection)
    state_data = verify_state(state)
    if not state_data:
        logger.error("[OAuth] Invalid or expired state parameter")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired state parameter (CSRF check failed)"
        )
    
    # Extract code_verifier and frontend_redirect_url from state
    parts = state_data.split('|', 1)
    code_verifier = parts[0]
    frontend_redirect_url = parts[1] if len(parts) > 1 else settings.frontend_url
    
    logger.info(f"[OAuth] Frontend redirect URL from state: {frontend_redirect_url}")
    
    # Exchange authorization code for tokens
    try:
        logger.info("[OAuth] Exchanging code for tokens...")
        logger.info(f"[OAuth]   redirect_uri: {settings.google_oauth_redirect_uri}")
        logger.info(f"[OAuth]   using PKCE code_verifier")
        
        with httpx.Client() as client:
            token_response = client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": settings.google_oauth_client_id,
                    "client_secret": settings.google_oauth_client_secret,
                    "redirect_uri": settings.google_oauth_redirect_uri,
                    "grant_type": "authorization_code",
                    "code_verifier": code_verifier
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            
            if token_response.status_code != 200:
                error_data = token_response.json()
                error_desc = error_data.get('error_description', error_data.get('error', 'Unknown error'))
                logger.error(f"[OAuth] Token exchange failed: {error_desc}")
                logger.error(f"[OAuth] Response: {error_data}")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to exchange authorization code: {error_desc}"
                )
            
            token_data = token_response.json()
            logger.info("[OAuth] ✓ Tokens received from Google")
            
            # Get user info from Google
            logger.info("[OAuth] Fetching user info...")
            userinfo_response = client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {token_data['access_token']}"}
            )
            
            if userinfo_response.status_code != 200:
                logger.error(f"[OAuth] Failed to get user info: {userinfo_response.status_code}")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Failed to get user info from Google"
                )
            
            user_info = userinfo_response.json()
            logger.info(f"[OAuth] ✓ User info retrieved: {user_info.get('email')}")
            
            # Store Google refresh token if available
            google_refresh_token = token_data.get('refresh_token')
            if google_refresh_token:
                logger.info("[OAuth] ✓ Refresh token received from Google")
            
    except httpx.RequestError as e:
        logger.error(f"[OAuth] HTTP request failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to communicate with Google: {str(e)}"
        )
    
    # Create or update user in database (include refresh token)
    user = create_or_update_user(db, {
        "email": user_info["email"],
        "google_id": user_info["id"],
        "name": user_info["name"],
        "picture": user_info.get("picture"),
        "refresh_token": google_refresh_token
    })
    
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
            "updatedAt": datetime.now(timezone.utc)
        }
        
        # Upsert curator in curators collection
        db.curators.update_one(
            {"curator_id": user.email},
            {"$set": curator_data, "$setOnInsert": {"createdAt": datetime.now(timezone.utc)}},
            upsert=True
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
    logger.info(f"[OAuth] Creating JWT tokens...")
    access_token = create_access_token(
        data={"sub": user.email, "google_id": user.google_id},
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes)
    )
    
    # Create refresh token for persistent login
    from app.core.security import create_refresh_token
    refresh_token = create_refresh_token(data={"sub": user.email})
    
    logger.info(f"[OAuth] ✓ JWT tokens created")
    
    # Redirect to frontend with tokens in URL
    # Using query params because frontend may be on different port/domain
    redirect_url = (
        f"{frontend_redirect_url}/"
        f"?token={access_token}"
        f"&refresh_token={refresh_token}"
        f"&expires_in={settings.access_token_expire_minutes * 60}"
        f"&user_email={user.email}"
        f"&user_name={user.name}"
    )
    
    logger.info(f"[OAuth] ✓ Redirecting to frontend: {frontend_redirect_url}")
    
    return RedirectResponse(url=redirect_url)


@router.get("/verify", response_model=UserAuthResponse)
def verify_token(
    token_data: dict = Depends(verify_access_token),
    db: Database = Depends(get_database)
):
    """
    Verify JWT access token and return user data
    
    Requires: Authorization: Bearer <token> header
    
    Returns:
        UserAuthResponse: User data if token is valid and user is authorized
    """
    email = token_data.get("sub")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing subject"
        )
    
    user = get_user_by_email(db, email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    if not user.authorized:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User not authorized"
        )
    
    logger.info(f"[OAuth] Token verified for user: {user.email}")
    
    return UserAuthResponse(
        email=user.email,
        name=user.name,
        picture=user.picture,
        authorized=user.authorized
    )


@router.post("/refresh")
def refresh_access_token(
    request: TokenRefreshRequest,
    db: Database = Depends(get_database)
):
    """
    Refresh access token using a valid refresh token
    
    Request body:
        refresh_token: JWT refresh token
    
    Returns:
        New access token and refresh token
    """
    from app.core.security import verify_refresh_token, create_access_token, create_refresh_token
    
    # Verify refresh token
    token_data = verify_refresh_token(request.refresh_token)
    
    email = token_data.get("sub")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token: missing subject"
        )
    
    # Get user from database
    user = get_user_by_email(db, email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    if not user.authorized:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User not authorized"
        )
    
    # Create new tokens
    new_access_token = create_access_token(data={"sub": user.email})
    new_refresh_token = create_refresh_token(data={"sub": user.email})
    
    logger.info(f"[OAuth] Token refreshed for user: {user.email}")
    
    return {
        "access_token": new_access_token,
        "refresh_token": new_refresh_token,
        "expires_in": settings.access_token_expire_minutes * 60,  # Return expiry time in seconds
        "token_type": "bearer",
        "user": UserAuthResponse(
            email=user.email,
            name=user.name,
            picture=user.picture,
            authorized=user.authorized
        )
    }

@router.post("/logout")
def logout(token_data: dict = Depends(verify_access_token)):
    """
    Logout user
    
    In production, add token to blacklist (Redis)
    For now, client-side token deletion is sufficient
    """
    email = token_data.get("sub")
    logger.info(f"[OAuth] User logged out: {email}")
    return {"message": "Logged out successfully"}
