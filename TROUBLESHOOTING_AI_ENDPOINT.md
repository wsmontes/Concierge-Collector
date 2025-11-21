# Troubleshooting AI Orchestrate Endpoint - 500 Error

## Problem
The `/api/v3/ai/orchestrate` endpoint is returning a 500 Internal Server Error when called from the frontend, causing transcription to fail.

## Error Symptoms
```
POST https://concierge-collector.onrender.com/api/v3/ai/orchestrate net::ERR_FAILED 500 (Internal Server Error)
Access to fetch at '...' from origin '...' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header
```

## Root Cause Analysis

### 1. CORS Error is a Symptom, Not the Cause
The CORS error appears because:
- The backend returns a 500 error BEFORE responding with CORS headers
- Browsers hide CORS headers when requests fail
- The real issue is the **500 Internal Server Error**

### 2. Backend Configuration Issues
The 500 error is likely caused by one of these:

#### A. Missing Environment Variables on Render
```bash
# Required on Render.com
OPENAI_API_KEY=sk-proj-...
API_SECRET_KEY=<secret>
MONGODB_URL=mongodb+srv://...
ENVIRONMENT=production
```

#### B. OpenAI Service Initialization Failure
The `/ai/orchestrate` endpoint depends on OpenAI service:
```python
def get_openai_service(db = Depends(get_database)):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OPENAI_API_KEY not configured"
        )
```

#### C. MongoDB Connection Issues
The orchestrator requires database access for saving results.

### 3. Authentication is Working Correctly
- User is authenticated: ✓
- OAuth token is valid: ✓
- Authorization header is sent: ✓

## Solution Steps

### Step 1: Verify Render Environment Variables
Go to Render.com Dashboard → Backend Service → Environment

**Required Variables:**
```bash
OPENAI_API_KEY=sk-proj-xxxxx...  # Get from Render dashboard

MONGODB_URL=mongodb+srv://user:password@cluster...  # Get from Render dashboard

MONGODB_DB_NAME=concierge-collector

API_SECRET_KEY=xxxxx...  # Get from Render dashboard

GOOGLE_OAUTH_CLIENT_ID=xxxxx...  # Get from Google Cloud Console

GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-xxxxx...  # Get from Google Cloud Console

CORS_ORIGINS=["http://localhost:3000","http://localhost:5500","http://127.0.0.1:5500","http://127.0.0.1:5501","http://localhost:8080","https://wsmontes.github.io","https://concierge-collector-web.onrender.com","https://concierge-collector.onrender.com"]

ENVIRONMENT=production
```

**⚠️ SECURITY:** Never commit actual API keys to Git! These values should only exist in:
- Render.com Environment Variables dashboard
- Local `.env` files (git-ignored)

All sensitive keys are stored securely in Render's environment variables and never exposed in the codebase.

### Step 2: Check Render Logs
```bash
# Go to Render Dashboard → Backend Service → Logs
# Look for startup errors like:
- "OPENAI_API_KEY not configured"
- "MongoDB connection failed"
- Any Python exceptions
```

### Step 3: Test Backend Health
```bash
# Test if backend is running
curl https://concierge-collector.onrender.com/api/v3/health

# Test if OpenAI service is initialized
curl https://concierge-collector.onrender.com/api/v3/info
```

### Step 4: Test AI Endpoint Directly
```bash
# Get your OAuth token from browser console
# AuthService.getToken()

TOKEN="<your-token>"

curl -X POST https://concierge-collector.onrender.com/api/v3/ai/orchestrate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"audio_file":"SGVsbG8gV29ybGQh","language":"pt-BR","entity_type":"restaurant"}'
```

### Step 5: Add Better Error Handling (Backend)

Update `concierge-api-v3/app/api/ai.py` to provide better error messages:

```python
@router.post("/orchestrate", response_model=OrchestrateResponse)
def orchestrate(
    request: OrchestrateRequest,
    orchestrator: AIOrchestrator = Depends(get_ai_orchestrator),
    token_data: dict = Depends(verify_access_token)
):
    """AI workflow orchestration with improved error handling"""
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        logger.info(f"[AI Orchestrate] Request from user: {token_data.get('sub')}")
        logger.info(f"[AI Orchestrate] Has audio: {request.audio_file is not None}")
        logger.info(f"[AI Orchestrate] Language: {request.language}")
        
        # Convert Pydantic model to dict
        request_dict = request.model_dump(exclude_none=True)
        
        # Orchestrate
        result = orchestrator.orchestrate(request_dict)
        
        logger.info(f"[AI Orchestrate] Success")
        return result
    
    except ValueError as e:
        logger.error(f"[AI Orchestrate] ValueError: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"[AI Orchestrate] Exception: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Orchestration failed: {str(e)}"
        )
```

### Step 6: Add Frontend Retry Logic

The frontend already has retry logic, but we can improve error messages:

```javascript
// In apiService.js - transcribeAudio method
async transcribeAudio(audioBlob, language = 'pt') {
    try {
        // Log authentication status
        this.log.debug('Transcribing audio with authentication');
        this.log.debug(`Token available: ${!!AuthService.getToken()}`);
        
        // Convert Blob to base64
        const base64Audio = await this.blobToBase64(audioBlob);
        
        // API V3 orchestrate endpoint expects JSON
        const requestBody = {
            audio_file: base64Audio,
            language: language || 'pt-BR',
            entity_type: 'restaurant'
        };
        
        const response = await this.request('POST', 'aiOrchestrate', {
            body: JSON.stringify(requestBody)
        });
        
        return await response.json();
        
    } catch (error) {
        this.log.error('Transcription error:', error);
        // Provide more helpful error message
        if (error.message.includes('Failed to fetch')) {
            throw new Error('Backend server is not responding. Please check if the API service is running.');
        }
        throw error;
    }
}
```

## Quick Fix Checklist

- [ ] Verify all environment variables are set on Render
- [ ] Check Render logs for startup errors
- [ ] Test `/api/v3/health` endpoint
- [ ] Test `/api/v3/info` endpoint
- [ ] Verify OpenAI API key is valid and has credits
- [ ] Check MongoDB connection is working
- [ ] Deploy updated backend with better error logging
- [ ] Test transcription again from frontend

## Expected Behavior After Fix

1. Frontend sends audio to `/api/v3/ai/orchestrate`
2. Backend verifies OAuth token ✓
3. Backend initializes OpenAI service ✓
4. Backend transcribes audio using OpenAI ✓
5. Backend extracts concepts ✓
6. Backend returns results to frontend ✓
7. Frontend displays transcription ✓

## Additional Resources

- [Render Environment Variables](https://render.com/docs/environment-variables)
- [FastAPI CORS](https://fastapi.tiangolo.com/tutorial/cors/)
- [OpenAI API Status](https://status.openai.com/)
