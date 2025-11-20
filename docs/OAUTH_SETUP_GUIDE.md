# Google OAuth Setup Guide

## Overview
The Concierge Collector now uses Google OAuth 2.0 for authentication instead of hardcoded API keys. This provides secure, user-based access control with backend authorization.

## Architecture

### Frontend (scripts/auth.js)
- Handles OAuth flow initiation
- Manages token storage in localStorage
- Provides automatic token refresh
- Integrates with accessControl.js for login UI

### Backend (concierge-api-v3/app/api/auth.py)
- OAuth callback handling
- User creation and authorization
- JWT token generation
- MongoDB users collection management

### Access Control
- Users must authenticate with Google
- Backend checks MongoDB `users` collection for authorization
- Only authorized users can access the application

## Setup Instructions

### 1. Create Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable the Google+ API (for user info)
4. Go to **APIs & Services > Credentials**
5. Click **Create Credentials > OAuth 2.0 Client ID**
6. Application type: **Web application**
7. Add authorized redirect URI:
   ```
   http://localhost:8000/api/v3/auth/callback
   ```
8. Copy the **Client ID** and **Client Secret**

### 2. Configure Backend Environment

Add to `concierge-api-v3/.env`:

```bash
# OAuth Configuration
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8000/api/v3/auth/callback

# Generate a secure JWT secret
API_SECRET_KEY=your-generated-secret-key
```

Generate API_SECRET_KEY:
```bash
python -c 'import secrets; print(secrets.token_urlsafe(32))'
```

### 3. Install Backend Dependencies

```bash
cd concierge-api-v3
pip install -r requirements.txt
```

New dependencies added:
- `python-jose[cryptography]` - JWT token handling
- `passlib[bcrypt]` - Password hashing (future use)
- `httpx` - HTTP client for OAuth requests

### 4. Create MongoDB Users Collection

The `users` collection is automatically created on first login. Schema:

```javascript
{
  _id: ObjectId,
  email: "user@example.com",
  google_id: "1234567890",
  name: "John Doe",
  picture: "https://lh3.googleusercontent.com/...",
  authorized: false,  // Admin must set to true
  created_at: ISODate("2025-01-15T10:30:00Z"),
  last_login: ISODate("2025-01-15T10:30:00Z")
}
```

### 5. Authorize First User

After first login attempt, manually authorize in MongoDB:

```javascript
// MongoDB shell or Compass
use concierge-collector;

// Find the user
db.users.find({ email: "your-email@example.com" });

// Authorize the user
db.users.updateOne(
  { email: "your-email@example.com" },
  { $set: { authorized: true } }
);
```

Or create authorized user directly:

```javascript
db.users.insertOne({
  email: "admin@example.com",
  google_id: "placeholder",  // Will be updated on first login
  name: "Admin User",
  authorized: true,
  created_at: new Date(),
  last_login: null
});
```

### 6. Start the Backend

```bash
cd concierge-api-v3
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Or use the provided script:
```bash
./start-api.sh
```

### 7. Test the Frontend

1. Open `index.html` in VS Code Live Server or a browser
2. You should see the Google Sign-In button
3. Click "Sign in with Google"
4. Complete Google OAuth consent
5. If authorized, you'll be redirected to the app
6. If not authorized, you'll see "User not authorized" message

## API Endpoints

### Authentication Endpoints

```
GET  /api/v3/auth/google          - Initiate OAuth flow
POST /api/v3/auth/callback        - Handle OAuth callback
GET  /api/v3/auth/verify          - Verify current token
POST /api/v3/auth/refresh         - Refresh access token
POST /api/v3/auth/logout          - Logout (revoke token)
```

### Protected Endpoints

All write operations now require `Authorization: Bearer <token>` header:

```
POST   /api/v3/entities           - Create entity (requires auth)
PATCH  /api/v3/entities/{id}      - Update entity (requires auth)
DELETE /api/v3/entities/{id}      - Delete entity (requires auth)
POST   /api/v3/curations          - Create curation (requires auth)
PATCH  /api/v3/curations/{id}     - Update curation (requires auth)
DELETE /api/v3/curations/{id}     - Delete curation (requires auth)
POST   /api/v3/ai/transcribe      - Transcribe audio (requires auth)
POST   /api/v3/ai/extract-concepts - Extract concepts (requires auth)
```

Read operations remain public (no auth required).

## Token Flow

1. **Login**: User clicks "Sign in with Google"
2. **OAuth**: Redirect to Google consent screen
3. **Callback**: Google redirects back with authorization code
4. **Exchange**: Backend exchanges code for Google tokens
5. **User Info**: Backend fetches user info from Google
6. **Database**: Backend creates/updates user in MongoDB
7. **Authorization**: Backend checks if user is authorized
8. **JWT**: Backend generates JWT access token
9. **Storage**: Frontend stores token in localStorage
10. **API Calls**: Frontend includes token in Authorization header
11. **Verification**: Backend verifies token on each request
12. **Refresh**: Frontend automatically refreshes expired tokens

## Token Management

### Storage
Tokens are stored in localStorage:
- `oauth_access_token` - JWT access token (1 hour expiry)
- `oauth_refresh_token` - Google refresh token (long-lived)
- `oauth_token_expiry` - Expiration timestamp

### Automatic Refresh
The AuthService automatically:
- Checks token expiry before API calls
- Refreshes token 5 minutes before expiry
- Handles 401 errors by attempting refresh
- Redirects to login if refresh fails

### Manual Operations
```javascript
// Check if authenticated
AuthService.isAuthenticated()

// Get current user
AuthService.getCurrentUser()

// Logout
AuthService.logout()

// Verify token
await AuthService.verifyToken()
```

## Security Notes

1. **Client Secret**: Keep `GOOGLE_OAUTH_CLIENT_SECRET` secure, never commit to Git
2. **JWT Secret**: Keep `API_SECRET_KEY` secure and unique per environment
3. **HTTPS**: In production, use HTTPS for all OAuth flows
4. **Redirect URI**: Update for production domain
5. **Token Storage**: localStorage is vulnerable to XSS - consider httpOnly cookies for production
6. **Authorization**: Only authorized users can access the app
7. **User Data**: User email, name, and picture are stored in MongoDB

## Troubleshooting

### "OAuth not configured" error
- Check `.env` file has `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`
- Restart backend after updating `.env`

### "User not authorized" error
- User exists in database but `authorized: false`
- Manually set `authorized: true` in MongoDB

### "Invalid redirect URI" from Google
- Check redirect URI in Google Console matches `.env` setting
- Must be exact match including `http://` and port

### Token expired errors
- AuthService should auto-refresh, check browser console for errors
- Try logging out and back in

### Backend not starting
- Check all dependencies installed: `pip install -r requirements.txt`
- Check MongoDB connection: `mongodb_url` in `.env`
- Check port 8000 not in use: `lsof -i :8000`

## Migration from API Key System

### What Changed
1. ❌ Removed: `openai_api_key` from localStorage
2. ❌ Removed: `checkAndPromptForApiKey()` function
3. ❌ Removed: X-API-Key header authentication
4. ✅ Added: Google OAuth authentication
5. ✅ Added: JWT Bearer token authentication
6. ✅ Added: MongoDB users collection
7. ✅ Added: User authorization system

### Backward Compatibility
- Read operations still work without authentication
- Write operations require OAuth token
- Legacy API key code removed from frontend
- Backend still supports X-API-Key for migration period (if needed)

### Data Migration
No data migration needed. Existing entities and curations remain unchanged.

## Production Deployment

### Frontend Changes
1. Update `config.js` with production API URL
2. Add production domain to Google OAuth redirect URIs
3. Use HTTPS for all OAuth flows
4. Consider httpOnly cookies instead of localStorage

### Backend Changes
1. Update `.env` with production values:
   ```bash
   GOOGLE_OAUTH_REDIRECT_URI=https://your-domain.com/api/v3/auth/callback
   ENVIRONMENT=production
   ```
2. Add production domain to CORS origins
3. Use secure secret keys (rotate API_SECRET_KEY)
4. Enable HTTPS
5. Set up MongoDB with authentication
6. Configure firewall rules

### Google OAuth
1. Add production redirect URI to Google Console
2. Add production domain to authorized JavaScript origins
3. Consider domain verification
4. Set up OAuth consent screen branding

## Support

For issues or questions:
1. Check browser console for frontend errors
2. Check backend logs for API errors
3. Verify MongoDB users collection
4. Test OAuth flow manually via `/api/v3/docs`
5. Review this guide for setup steps

## Testing

### Manual Testing
1. Login with Google (should succeed if authorized)
2. Create entity (should include Bearer token)
3. Logout (should clear tokens)
4. Try to access app (should show login)

### Backend Testing
```bash
cd concierge-api-v3
pytest tests/
```

### API Documentation
Visit `http://localhost:8000/api/v3/docs` for interactive API docs.
