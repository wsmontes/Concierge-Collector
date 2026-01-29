# 🔐 OAuth Configuration for Local + Production

## Current Status

✅ **Production OAuth**: Working on Render.com  
⚠️ **Local OAuth**: Needs redirect URI added to Google Console

---

## 📋 Required Redirect URIs

Your Google OAuth Client needs **both** redirect URIs configured:

1. **Production**: `https://concierge-collector.onrender.com/api/v3/auth/callback`
2. **Local**: `http://localhost:8000/api/v3/auth/callback`

---

## 🔧 Setup Instructions

### 1. Open Google Cloud Console

Go to: https://console.cloud.google.com/apis/credentials

### 2. Select Your OAuth Client

- Find client ID: `1020272767566-8aljuvk9oval5isriv512nber3a88pvi`
- Click to edit

### 3. Add Local Redirect URI

Under **Authorized redirect URIs**, add:

```
http://localhost:8000/api/v3/auth/callback
```

**Keep the existing production URI:**
```
https://concierge-collector.onrender.com/api/v3/auth/callback
```

### 4. Save Changes

Click **Save** at the bottom.

---

## ✅ Verification

### Test Production OAuth
1. Visit: https://concierge-collector.onrender.com
2. Click "Sign in with Google"
3. Should redirect to: `https://concierge-collector.onrender.com/api/v3/auth/callback`

### Test Local OAuth
1. Start local backend: `cd concierge-api-v3 && ./run_local.sh`
2. Open frontend: http://127.0.0.1:5500
3. Click "Sign in with Google"
4. Should redirect to: `http://localhost:8000/api/v3/auth/callback`

---

## 🎯 How It Works

### Backend Auto-Detection

The backend automatically sets the correct redirect URI:

```python
# In concierge-api-v3/app/core/config.py
if is_render:
    redirect_uri = "https://concierge-collector.onrender.com/api/v3/auth/callback"
else:
    redirect_uri = "http://localhost:8000/api/v3/auth/callback"
```

### Frontend Detection

The frontend automatically uses the correct backend:

```javascript
// In scripts/config.js
if (isLocalhost) {
    baseUrl = 'http://localhost:8000/api/v3';
} else {
    baseUrl = 'https://concierge-collector.onrender.com/api/v3';
}
```

---

## 🐛 Troubleshooting

### "redirect_uri_mismatch" error

**Local Development:**
```
Error: redirect_uri_mismatch
The redirect URI in the request: http://localhost:8000/api/v3/auth/callback
does not match the ones authorized for the OAuth client.
```

**Solution:**
- Add `http://localhost:8000/api/v3/auth/callback` to Google Console
- Make sure there are no trailing slashes
- Use exact URL including `/api/v3/auth/callback`

### OAuth works in production but not locally

**Check:**
1. Local redirect URI added to Google Console? ✅
2. Backend running on port 8000? ✅
3. Using same OAuth client ID locally? ✅
4. `.env` file has correct `GOOGLE_OAUTH_CLIENT_ID`? ✅

### OAuth works locally but not in production

**Check:**
1. Render environment variables set correctly? ✅
2. Production redirect URI in Google Console? ✅
3. HTTPS used in production (required by Google)? ✅

---

## 📝 Environment Variables

### Local (.env file)
```bash
GOOGLE_OAUTH_CLIENT_ID=1020272767566-8aljuvk9oval5isriv512nber3a88pvi.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=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
GOOGLE_OAUTH_REDIRECT_URI=  # Leave empty for auto-detection
```

### Production (Render Dashboard)
```bash
GOOGLE_OAUTH_CLIENT_ID=1020272767566-8aljuvk9oval5isriv512nber3a88pvi.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=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
GOOGLE_OAUTH_REDIRECT_URI=https://concierge-collector.onrender.com/api/v3/auth/callback
```

---

## 🔒 Security Notes

1. **Same OAuth Client**: Use the same client ID/secret for both local and production
2. **Different Redirect URIs**: Google allows multiple redirect URIs per client
3. **HTTPS Required**: Production must use HTTPS (Render provides this automatically)
4. **Localhost Exception**: Google allows `http://localhost` for development

---

## ✨ Benefits

- ✅ **One OAuth Client** - No separate dev/prod credentials needed
- ✅ **Automatic Switching** - Backend auto-detects environment
- ✅ **Same User Accounts** - Users can sign in to both local and production
- ✅ **No Code Changes** - Just add redirect URI to Google Console

---

## 📚 Related Documentation

- [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) - Local setup guide
- [ENVIRONMENT_DETECTION.md](ENVIRONMENT_DETECTION.md) - How auto-detection works
- [docs/OAUTH_SETUP_GUIDE.md](docs/OAUTH_SETUP_GUIDE.md) - Detailed OAuth setup
