# Audio Transcription Issue - Production Troubleshooting

**Date:** January 28, 2026  
**Status:** 🔴 CRITICAL - Transcription failing in Render production  
**Priority:** P0 (Fix immediately)

---

## 🎯 Problem Statement

The application deployed on Render.com cannot transcribe audio recordings. Users attempt to record audio reviews, but the transcription fails with no clear error message.

---

## 🔍 Diagnostic Tools Created

### 1. Backend Diagnostic Script

**Location:** `concierge-api-v3/diagnose_transcription.py`

**Usage:**
```bash
# SSH into Render instance or use Render Shell
cd concierge-api-v3
python diagnose_transcription.py
```

**Checks Performed:**
- ✅ Environment variables (OPENAI_API_KEY, MONGODB_URI)
- ✅ OpenAI API connectivity
- ✅ MongoDB connection
- ✅ Whisper transcription with test audio
- ✅ AI orchestrator configuration
- ✅ API endpoint health

### 2. Frontend Test Suite

**Location:** `tests/test_audioTranscription.test.js`

**Usage:**
```bash
npm test test_audioTranscription
```

**Tests Cover:**
- Authentication checks
- Audio blob to base64 conversion
- API response validation
- Error handling
- Production environment compatibility

---

## 🐛 Most Likely Causes

### 1. **OPENAI_API_KEY Not Set in Render** (90% probability)

**Symptoms:**
- Error: "OPENAI_API_KEY not configured"
- HTTP 500 from /api/v3/ai/orchestrate
- Backend logs show missing environment variable

**Fix:**
```bash
# In Render Dashboard:
1. Go to your service
2. Click "Environment" tab
3. Add variable:
   - Key: OPENAI_API_KEY
   - Value: sk-proj-... (your OpenAI API key)
4. Click "Save Changes"
5. Wait for automatic redeploy
```

**Verification:**
```bash
# Check in Render Shell:
echo $OPENAI_API_KEY
# Should output: sk-proj-...
```

---

### 2. **OpenAI API Key Invalid or Expired** (5% probability)

**Symptoms:**
- Error: "401 Unauthorized"
- Error: "Invalid API key"
- Transcription starts but fails immediately

**Fix:**
1. Go to https://platform.openai.com/api-keys
2. Check if key is still valid
3. If expired/revoked, create new key
4. Update in Render dashboard

**Verification:**
```bash
# Test key locally:
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"

# Should return list of models
```

---

### 3. **OpenAI Account Has No Credits** (3% probability)

**Symptoms:**
- Error: "You exceeded your current quota"
- Error: "Insufficient credits"
- Works initially, then stops

**Fix:**
1. Go to https://platform.openai.com/account/billing
2. Check usage and limits
3. Add payment method or credits
4. Wait 5-10 minutes for update to propagate

---

### 4. **Audio Format Issue** (1% probability)

**Symptoms:**
- Error: "Audio file format not supported"
- Error: "Audio file too short"
- Works locally but not in production

**Check:**
- Frontend sends WebM (Chrome) or MP3 (Safari)
- Backend correctly converts base64 to BytesIO
- File has proper MIME type

**Fix in code if needed:**
```javascript
// scripts/modules/recordingModule.js
async convertToMP3(audioBlob) {
    // Ensure proper conversion
    // Already implemented, but verify it's being called
}
```

---

### 5. **JWT Token Expired** (1% probability)

**Symptoms:**
- Error: "401 Unauthorized"
- Error: "Authentication required"
- Works after re-login

**Fix:**
- User needs to log out and log back in
- Check token expiry time (currently 24 hours)
- Token refresh should happen automatically

---

## 📝 Step-by-Step Troubleshooting

### Step 1: Check Render Logs

```bash
# In Render Dashboard:
1. Go to your service
2. Click "Logs" tab
3. Look for errors containing:
   - "OPENAI_API_KEY"
   - "Transcription"
   - "Whisper"
   - "500 Internal Server Error"
```

**Common log patterns:**

```python
# ❌ Missing API Key:
[ERROR] OPENAI_API_KEY not configured

# ❌ Invalid API Key:
[ERROR] OpenAI authentication failed: 401 Unauthorized

# ❌ Rate Limit:
[ERROR] OpenAI rate limit exceeded: 429 Too Many Requests

# ✅ Success:
[INFO] Transcription successful, text length: 156
```

---

### Step 2: Run Diagnostic Script

```bash
# In Render Shell (or SSH):
cd /opt/render/project/src/concierge-api-v3
python diagnose_transcription.py
```

**Expected output if working:**
```
STEP 1: Environment Check
OPENAI_API_KEY: ✓ SET (length: 51)
MONGODB_URI: ✓ SET
...

STEP 2: OpenAI API Connection Test
✓ OpenAI API working! Response: API OK

STEP 3: MongoDB Connection Test
✓ MongoDB connection working!
...

DIAGNOSTIC SUMMARY
ENVIRONMENT: ✓ PASS
OPENAI: ✓ PASS
DATABASE: ✓ PASS
WHISPER: ✓ PASS
...

✅ All checks passed! Transcription should work.
```

---

### Step 3: Test Frontend

```bash
# Run locally first:
npm test test_audioTranscription

# Then test in production:
# 1. Open browser console (F12)
# 2. Record audio
# 3. Watch for errors:
```

**Look for:**
```javascript
// ❌ Missing auth:
Authentication required for transcription

// ❌ API error:
Transcription failed: HTTP 500: Internal Server Error

// ❌ Invalid response:
Invalid response from transcription API

// ✅ Success:
✅ Transcription + concepts successful via API V3 orchestrate
```

---

### Step 4: Check API Health Endpoint

```bash
# Test API health directly:
curl https://concierge-collector.onrender.com/api/v3/ai/health \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-28T...",
  "checks": {
    "openai_api_key": {
      "status": "ok",
      "configured": true
    }
  }
}
```

**If unhealthy:**
```json
{
  "status": "unhealthy",
  "checks": {
    "openai_api_key": {
      "status": "error",
      "error": "OPENAI_API_KEY environment variable not set"
    }
  }
}
```

---

## 🛠️ Quick Fixes

### Fix #1: Set OPENAI_API_KEY (Most Common)

```bash
# Render Dashboard → Environment → Add Variable:
OPENAI_API_KEY=sk-proj-YOUR_KEY_HERE

# Save and redeploy
```

### Fix #2: Restart Service

```bash
# Render Dashboard → Manual Deploy → Deploy Latest Commit
# OR
# Click "Restart Service"
```

### Fix #3: Check OpenAI Account

```bash
# Visit https://platform.openai.com/account/usage
# Verify:
# - API key is active
# - Account has credits
# - No rate limits exceeded
```

### Fix #4: Clear Browser Cache

```javascript
// In browser console:
localStorage.clear();
sessionStorage.clear();
location.reload();

// Then log in again
```

---

## 🧪 Testing After Fix

### Backend Test:
```bash
# SSH into Render
python diagnose_transcription.py

# Should show:
# ✅ All checks passed!
```

### Frontend Test:
```javascript
// Open app in browser
// 1. Log in
// 2. Click "New Restaurant"
// 3. Click microphone icon
// 4. Record 3-5 seconds of speech
// 5. Click stop
// 6. Wait 5-10 seconds
// 7. Should see transcription appear

// Check console for:
// ✅ Transcription + concepts successful via API V3 orchestrate
```

### API Test:
```bash
# Create test audio file:
echo "test" > /tmp/test.txt
base64 /tmp/test.txt > /tmp/test.b64

# Call API:
curl -X POST https://concierge-collector.onrender.com/api/v3/ai/orchestrate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "audio_file": "'$(cat /tmp/test.b64)'",
    "language": "en",
    "entity_type": "restaurant"
  }'

# Should return:
# {
#   "workflow": "audio_only",
#   "results": {
#     "transcription": { "text": "..." },
#     "concepts": { ... }
#   }
# }
```

---

## 📋 Verification Checklist

After applying fixes, verify:

- [ ] OPENAI_API_KEY is set in Render dashboard
- [ ] Diagnostic script passes all checks
- [ ] API health endpoint returns "healthy"
- [ ] Frontend can record and transcribe audio
- [ ] Transcription appears in UI within 10 seconds
- [ ] Concepts are extracted automatically
- [ ] Data syncs to MongoDB successfully
- [ ] No errors in Render logs
- [ ] No errors in browser console

---

## 📊 Monitoring

### Render Logs to Watch:

```bash
# Good patterns:
[INFO] [AI Orchestrate] New request received
[INFO] [AI Orchestrate] Has audio: True
[INFO] [AI Orchestrate] ✓ Orchestration successful
[DEBUG] OpenAI response received, text length: 123

# Bad patterns:
[ERROR] OPENAI_API_KEY not configured
[ERROR] OpenAI authentication failed
[ERROR] Audio transcription failed
[ERROR] Invalid API response
```

### OpenAI Dashboard:

Monitor at: https://platform.openai.com/account/usage

Watch for:
- API calls increasing (shows it's working)
- Errors/failures (shows problems)
- Cost accumulation (budget alerts)

---

## 🚨 Emergency Contacts

If issue persists after all fixes:

1. **Check OpenAI Status:** https://status.openai.com/
2. **Check Render Status:** https://status.render.com/
3. **Review Backend Logs:** Render Dashboard → Logs
4. **Review Frontend Errors:** Browser Console (F12)

---

## 📝 Prevention

### Add to CI/CD:

```yaml
# .github/workflows/deploy.yml
- name: Check OPENAI_API_KEY
  run: |
    if [ -z "$OPENAI_API_KEY" ]; then
      echo "❌ OPENAI_API_KEY not set"
      exit 1
    fi
    echo "✅ OPENAI_API_KEY is set"
```

### Add Health Check Alert:

```python
# Render dashboard → Notifications
# Set up alert for:
# - Service unhealthy
# - High error rate
# - API endpoint down
```

---

**Document Version:** 1.0  
**Last Updated:** January 28, 2026  
**Status:** Active troubleshooting guide
