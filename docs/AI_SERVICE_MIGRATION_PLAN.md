# AI Service Migration Plan
**Date**: 2025-11-17  
**Objective**: Move all OpenAI processing from frontend to backend API

---

## Current State Analysis

### Frontend (Collector) - Current AI Usage

**Location**: `scripts/modules/transcriptionModule.js`
```javascript
// Uses OpenAI API directly from browser
async transcribeAudio(audioBlob) {
  const apiKey = localStorage.getItem('openai_api_key');
  
  // Direct call to OpenAI Whisper API
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
}
```

**Location**: `scripts/modules/conceptModule.js`
```javascript
// Uses OpenAI GPT for concept extraction
async extractConceptsFromTranscription(transcription) {
  const apiKey = localStorage.getItem('openai_api_key');
  
  // Direct call to OpenAI GPT API
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4",
      messages: [{ role: "system", content: promptTemplate }]
    })
  });
}
```

**Problems with Current Approach:**
1. ❌ **API Key exposed** in browser localStorage (security risk)
2. ❌ **CORS issues** with OpenAI API
3. ❌ **No rate limiting** or cost control
4. ❌ **No caching** of transcriptions/concepts
5. ❌ **No monitoring** of AI usage
6. ❌ **Client-side processing** = slow for large files

---

## New Architecture: Backend AI Service

### Backend (API V3) - New AI Endpoints

```
POST /api/v3/ai/transcribe
├── Input: audio file (multipart/form-data)
├── Process: Call OpenAI Whisper API
├── Cache: Store transcription in MongoDB (ai_transcriptions collection)
└── Output: { transcription_id, text, language, duration }

POST /api/v3/ai/extract-concepts
├── Input: { transcription_text, entity_id (optional) }
├── Process: Call OpenAI GPT-4 with concept extraction prompt
├── Cache: Store concepts in MongoDB (ai_concepts collection)
└── Output: { concepts: [{ category, value, confidence }], suggestions: [...] }

POST /api/v3/ai/analyze-entity
├── Input: { entity_id, context (optional) }
├── Process: Fetch entity data + Run AI analysis
├── Cache: Store analysis results
└── Output: { cuisine, mood, suitable_for, price_range, recommendations }

GET /api/v3/ai/transcriptions/{transcription_id}
└── Retrieve cached transcription

GET /api/v3/ai/usage-stats
└── Monitor AI usage (cost, requests, tokens)
```

---

## Implementation Plan

### Phase 1: Backend AI Service (4-6 hours)

#### 1.1: Setup AI Service Infrastructure

**File**: `concierge-api-v3/.env`
```bash
# OpenAI Configuration
OPENAI_API_KEY=sk-...your-key...
OPENAI_MODEL_WHISPER=whisper-1
OPENAI_MODEL_GPT=gpt-4-turbo-preview
OPENAI_MAX_TOKENS=2000
OPENAI_TEMPERATURE=0.7

# AI Service Settings
AI_CACHE_ENABLED=true
AI_CACHE_TTL_HOURS=24
AI_RATE_LIMIT_PER_MINUTE=10
```

**File**: `concierge-api-v3/app/core/config.py`
```python
class Settings(BaseSettings):
    # ... existing settings ...
    
    # OpenAI Settings
    openai_api_key: str
    openai_model_whisper: str = "whisper-1"
    openai_model_gpt: str = "gpt-4-turbo-preview"
    openai_max_tokens: int = 2000
    openai_temperature: float = 0.7
    
    # AI Cache Settings
    ai_cache_enabled: bool = True
    ai_cache_ttl_hours: int = 24
    ai_rate_limit_per_minute: int = 10
```

#### 1.2: MongoDB Collections for AI Cache

**File**: `concierge-api-v3/app/models/schemas.py`
```python
# AI Transcription Model
class AITranscription(BaseModel):
    transcription_id: str = Field(default_factory=lambda: f"trans_{uuid.uuid4().hex[:12]}")
    audio_hash: str  # SHA256 of audio file for deduplication
    text: str
    language: str
    duration: float  # seconds
    model: str  # whisper-1
    created_at: datetime = Field(default_factory=datetime.utcnow)
    entity_id: Optional[str] = None
    tokens_used: int = 0
    cost_usd: float = 0.0

# AI Concept Extraction Model
class AIConcepts(BaseModel):
    concept_id: str = Field(default_factory=lambda: f"concept_{uuid.uuid4().hex[:12]}")
    transcription_id: Optional[str] = None
    entity_id: Optional[str] = None
    input_text: str
    concepts: List[Dict[str, Any]]  # [{ category, value, confidence }]
    suggestions: List[str]
    model: str  # gpt-4-turbo-preview
    created_at: datetime = Field(default_factory=datetime.utcnow)
    tokens_used: int = 0
    cost_usd: float = 0.0

# AI Usage Stats Model
class AIUsageStats(BaseModel):
    date: str  # YYYY-MM-DD
    transcriptions_count: int = 0
    concepts_count: int = 0
    total_tokens: int = 0
    total_cost_usd: float = 0.0
    requests_by_hour: Dict[str, int] = {}
```

#### 1.3: OpenAI Service Layer

**File**: `concierge-api-v3/app/services/openai_service.py`
```python
"""
OpenAI Service - Handles all AI operations
Includes caching, rate limiting, and cost tracking
"""
import hashlib
import asyncio
from openai import AsyncOpenAI
from app.core.config import settings
from app.core.database import get_database

class OpenAIService:
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)
        self.db = None
    
    async def initialize(self):
        """Initialize database connection"""
        self.db = await get_database()
    
    async def transcribe_audio(self, audio_file, entity_id: str = None):
        """
        Transcribe audio using Whisper API with caching
        """
        # 1. Calculate audio hash for deduplication
        audio_hash = hashlib.sha256(audio_file.read()).hexdigest()
        audio_file.seek(0)
        
        # 2. Check cache
        if settings.ai_cache_enabled:
            cached = await self.db.ai_transcriptions.find_one({
                "audio_hash": audio_hash
            })
            if cached:
                return self._format_transcription(cached)
        
        # 3. Call OpenAI Whisper API
        response = await self.client.audio.transcriptions.create(
            model=settings.openai_model_whisper,
            file=audio_file,
            response_format="verbose_json"
        )
        
        # 4. Calculate cost (Whisper: $0.006 / minute)
        duration = response.duration
        cost = (duration / 60.0) * 0.006
        
        # 5. Save to cache
        transcription_doc = {
            "transcription_id": f"trans_{uuid.uuid4().hex[:12]}",
            "audio_hash": audio_hash,
            "text": response.text,
            "language": response.language,
            "duration": duration,
            "model": settings.openai_model_whisper,
            "entity_id": entity_id,
            "tokens_used": 0,  # Whisper doesn't use tokens
            "cost_usd": cost,
            "created_at": datetime.utcnow()
        }
        
        await self.db.ai_transcriptions.insert_one(transcription_doc)
        
        # 6. Update usage stats
        await self._update_usage_stats("transcription", 0, cost)
        
        return self._format_transcription(transcription_doc)
    
    async def extract_concepts(self, text: str, entity_id: str = None, 
                               transcription_id: str = None):
        """
        Extract concepts using GPT-4 with caching
        """
        # 1. Check cache by transcription_id or text hash
        text_hash = hashlib.sha256(text.encode()).hexdigest()
        
        if settings.ai_cache_enabled and transcription_id:
            cached = await self.db.ai_concepts.find_one({
                "transcription_id": transcription_id
            })
            if cached:
                return self._format_concepts(cached)
        
        # 2. Build prompt from template
        system_prompt = self._build_concept_extraction_prompt()
        
        # 3. Call OpenAI GPT API
        response = await self.client.chat.completions.create(
            model=settings.openai_model_gpt,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text}
            ],
            max_tokens=settings.openai_max_tokens,
            temperature=settings.openai_temperature,
            response_format={"type": "json_object"}
        )
        
        # 4. Parse response
        concepts_data = json.loads(response.choices[0].message.content)
        
        # 5. Calculate cost (GPT-4: $0.03/1K input + $0.06/1K output)
        tokens_used = response.usage.total_tokens
        cost = (response.usage.prompt_tokens / 1000 * 0.03 + 
                response.usage.completion_tokens / 1000 * 0.06)
        
        # 6. Save to cache
        concept_doc = {
            "concept_id": f"concept_{uuid.uuid4().hex[:12]}",
            "transcription_id": transcription_id,
            "entity_id": entity_id,
            "input_text": text,
            "concepts": concepts_data.get("concepts", []),
            "suggestions": concepts_data.get("suggestions", []),
            "model": settings.openai_model_gpt,
            "tokens_used": tokens_used,
            "cost_usd": cost,
            "created_at": datetime.utcnow()
        }
        
        await self.db.ai_concepts.insert_one(concept_doc)
        
        # 7. Update usage stats
        await self._update_usage_stats("concepts", tokens_used, cost)
        
        return self._format_concepts(concept_doc)
    
    def _build_concept_extraction_prompt(self):
        """Load concept extraction prompt template"""
        return """You are a restaurant concept extraction expert.
Analyze the transcription and extract structured concepts in JSON format.

Return JSON with this structure:
{
  "concepts": [
    {
      "category": "Cuisine",
      "value": "Italian",
      "confidence": 0.95
    }
  ],
  "suggestions": ["Add more details about ambiance", "..."]
}

Categories: Cuisine, Price Range, Mood, Setting, Crowd, Suitable For, 
Food Style, Drinks, Menu, Service, Noise Level, Parking
"""
```

#### 1.4: AI Router/Endpoints

**File**: `concierge-api-v3/app/api/ai.py`
```python
"""
AI Service Endpoints
Handles transcription and concept extraction
"""
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from typing import Optional
from app.services.openai_service import OpenAIService
from app.models.schemas import AITranscription, AIConcepts
from app.core.dependencies import get_openai_service

router = APIRouter(prefix="/ai", tags=["AI Services"])

@router.post("/transcribe", response_model=AITranscription)
async def transcribe_audio(
    file: UploadFile = File(...),
    entity_id: Optional[str] = None,
    openai_service: OpenAIService = Depends(get_openai_service)
):
    """
    Transcribe audio file using OpenAI Whisper
    - Supports: mp3, mp4, mpeg, mpga, m4a, wav, webm
    - Max size: 25MB
    - Cached for 24h
    """
    # Validate file type
    if not file.content_type.startswith(('audio/', 'video/')):
        raise HTTPException(400, "Invalid file type. Must be audio or video.")
    
    # Validate file size (25MB limit)
    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(400, "File too large. Max 25MB.")
    
    # Process transcription
    result = await openai_service.transcribe_audio(file.file, entity_id)
    return result

@router.post("/extract-concepts", response_model=AIConcepts)
async def extract_concepts(
    text: str,
    entity_id: Optional[str] = None,
    transcription_id: Optional[str] = None,
    openai_service: OpenAIService = Depends(get_openai_service)
):
    """
    Extract structured concepts from transcription text
    Uses GPT-4 for intelligent analysis
    """
    if not text or len(text) < 10:
        raise HTTPException(400, "Text too short for analysis")
    
    result = await openai_service.extract_concepts(
        text, entity_id, transcription_id
    )
    return result

@router.get("/transcriptions/{transcription_id}")
async def get_transcription(
    transcription_id: str,
    openai_service: OpenAIService = Depends(get_openai_service)
):
    """Retrieve cached transcription"""
    result = await openai_service.get_transcription(transcription_id)
    if not result:
        raise HTTPException(404, "Transcription not found")
    return result

@router.get("/usage-stats")
async def get_usage_stats(
    days: int = 7,
    openai_service: OpenAIService = Depends(get_openai_service)
):
    """Get AI usage statistics and costs"""
    stats = await openai_service.get_usage_stats(days)
    return stats
```

#### 1.5: Register AI Router

**File**: `concierge-api-v3/main.py`
```python
from app.api import entities, curations, system, places, ai  # Add ai

# ... existing code ...

# Include routers
app.include_router(system.router, prefix="/api/v3")
app.include_router(entities.router, prefix="/api/v3")
app.include_router(curations.router, prefix="/api/v3")
app.include_router(places.router, prefix="/api/v3")
app.include_router(ai.router, prefix="/api/v3")  # NEW
```

---

### Phase 2: Frontend Migration (2-3 hours)

#### 2.1: Update ApiService

**File**: `scripts/apiService.js`
```javascript
// Add AI methods
class ApiService {
    // ... existing methods ...
    
    /**
     * Transcribe audio file using backend AI service
     * @param {File} audioFile - Audio file
     * @param {string} entityId - Optional entity ID
     * @returns {Promise<Object>} - { transcription_id, text, language, duration }
     */
    async transcribeAudio(audioFile, entityId = null) {
        const formData = new FormData();
        formData.append('file', audioFile);
        if (entityId) {
            formData.append('entity_id', entityId);
        }
        
        const response = await this.makeRequest('POST', '/ai/transcribe', {
            body: formData,
            headers: {} // Let browser set Content-Type for multipart
        });
        
        return response.data;
    }
    
    /**
     * Extract concepts from transcription text
     * @param {string} text - Transcription text
     * @param {string} entityId - Optional entity ID
     * @param {string} transcriptionId - Optional transcription ID
     * @returns {Promise<Object>} - { concepts, suggestions }
     */
    async extractConcepts(text, entityId = null, transcriptionId = null) {
        const response = await this.makeRequest('POST', '/ai/extract-concepts', {
            body: JSON.stringify({
                text,
                entity_id: entityId,
                transcription_id: transcriptionId
            })
        });
        
        return response.data;
    }
    
    /**
     * Get cached transcription
     * @param {string} transcriptionId - Transcription ID
     * @returns {Promise<Object>}
     */
    async getTranscription(transcriptionId) {
        const response = await this.makeRequest('GET', `/ai/transcriptions/${transcriptionId}`);
        return response.data;
    }
    
    /**
     * Get AI usage statistics
     * @param {number} days - Number of days to look back
     * @returns {Promise<Object>}
     */
    async getAIUsageStats(days = 7) {
        const response = await this.makeRequest('GET', `/ai/usage-stats?days=${days}`);
        return response.data;
    }
}
```

#### 2.2: Update TranscriptionModule

**File**: `scripts/modules/transcriptionModule.js`
```javascript
// BEFORE (calls OpenAI directly)
async transcribeAudio(audioBlob) {
    const apiKey = localStorage.getItem('openai_api_key');  // ❌ Remove this
    
    const formData = new FormData();
    formData.append('file', audioBlob);
    
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: formData
    });
}

// AFTER (calls backend API)
async transcribeAudio(audioBlob, entityId = null) {
    this.log.debug('Transcribing audio via backend API...');
    
    // Call backend AI service
    const result = await window.ApiService.transcribeAudio(audioBlob, entityId);
    
    this.log.debug('Transcription received:', {
        id: result.transcription_id,
        text_length: result.text.length,
        language: result.language,
        duration: result.duration
    });
    
    return {
        transcription_id: result.transcription_id,
        text: result.text,
        language: result.language,
        duration: result.duration
    };
}
```

#### 2.3: Update ConceptModule

**File**: `scripts/modules/conceptModule.js`
```javascript
// BEFORE (calls OpenAI directly)
async extractConceptsFromTranscription(transcription) {
    const apiKey = localStorage.getItem('openai_api_key');  // ❌ Remove this
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: "gpt-4",
            messages: [...]
        })
    });
}

// AFTER (calls backend API)
async extractConceptsFromTranscription(transcription, entityId = null, transcriptionId = null) {
    this.log.debug('Extracting concepts via backend API...');
    
    // Call backend AI service
    const result = await window.ApiService.extractConcepts(
        transcription,
        entityId,
        transcriptionId
    );
    
    this.log.debug('Concepts extracted:', {
        concepts_count: result.concepts.length,
        suggestions_count: result.suggestions.length
    });
    
    return {
        concepts: result.concepts,
        suggestions: result.suggestions
    };
}
```

#### 2.4: Remove OpenAI API Key from Frontend

**File**: `scripts/main.js`
```javascript
// Remove all localStorage OpenAI key handling
// DELETE:
window.checkAndPromptForApiKey = function() {
    const apiKey = localStorage.getItem('openai_api_key');  // ❌ Delete
    // ...
}

// Backend now handles API key, no frontend storage needed
```

---

### Phase 3: Testing & Monitoring (1-2 hours)

#### 3.1: Test AI Endpoints

**Test 1: Transcription**
```bash
curl -X POST "http://localhost:8000/api/v3/ai/transcribe" \
  -F "file=@test_audio.mp3" \
  -F "entity_id=entity_123"
```

**Expected Response:**
```json
{
  "transcription_id": "trans_abc123def456",
  "text": "This restaurant has amazing Italian food...",
  "language": "en",
  "duration": 45.2,
  "cost_usd": 0.0045
}
```

**Test 2: Concept Extraction**
```bash
curl -X POST "http://localhost:8000/api/v3/ai/extract-concepts" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "This restaurant has amazing Italian food...",
    "entity_id": "entity_123",
    "transcription_id": "trans_abc123def456"
  }'
```

**Expected Response:**
```json
{
  "concept_id": "concept_xyz789",
  "concepts": [
    {"category": "Cuisine", "value": "Italian", "confidence": 0.95},
    {"category": "Mood", "value": "Romantic", "confidence": 0.80}
  ],
  "suggestions": ["Add details about price range", "Mention ambiance"],
  "tokens_used": 450,
  "cost_usd": 0.027
}
```

#### 3.2: Monitor AI Usage

**Swagger UI**: http://localhost:8000/api/v3/docs#/AI%20Services/get_usage_stats

**Response:**
```json
{
  "period_days": 7,
  "total_transcriptions": 45,
  "total_concepts": 42,
  "total_tokens": 125000,
  "total_cost_usd": 4.75,
  "daily_breakdown": [
    {"date": "2025-11-17", "transcriptions": 12, "concepts": 10, "cost": 1.20}
  ]
}
```

---

## Benefits

### Security
✅ API key stored securely in backend `.env`  
✅ No sensitive data in browser localStorage  
✅ Rate limiting prevents abuse  
✅ CORS handled by backend

### Performance
✅ Caching reduces redundant API calls  
✅ Server-side processing faster for large files  
✅ Background jobs for long-running tasks  
✅ Deduplication by audio hash

### Cost Control
✅ Usage tracking per day/user  
✅ Cost monitoring and alerts  
✅ Cache reduces OpenAI calls by ~60%  
✅ Rate limiting prevents runaway costs

### Monitoring
✅ Centralized logging  
✅ Error tracking  
✅ Performance metrics  
✅ Token usage analytics

---

## Migration Checklist

### Backend Tasks
- [ ] Add OpenAI dependencies to `requirements.txt`
- [ ] Add `OPENAI_API_KEY` to `.env`
- [ ] Create `openai_service.py` with transcription/concept methods
- [ ] Create AI endpoints in `app/api/ai.py`
- [ ] Add MongoDB collections: `ai_transcriptions`, `ai_concepts`, `ai_usage_stats`
- [ ] Implement caching logic
- [ ] Add rate limiting middleware
- [ ] Register AI router in `main.py`
- [ ] Test endpoints with Swagger UI

### Frontend Tasks
- [ ] Add AI methods to `apiService.js`
- [ ] Update `transcriptionModule.js` to use backend
- [ ] Update `conceptModule.js` to use backend
- [ ] Remove OpenAI key storage from `main.js`
- [ ] Remove direct OpenAI API calls
- [ ] Test audio recording → transcription → concepts flow
- [ ] Update UI to show AI processing status

### Deployment
- [ ] Add `OPENAI_API_KEY` to production `.env`
- [ ] Create MongoDB indexes for AI collections
- [ ] Setup monitoring alerts for costs
- [ ] Deploy backend with AI service
- [ ] Deploy frontend with updated API calls
- [ ] Test end-to-end in production

---

## Cost Estimation

**Current (Frontend)**:
- No caching
- No deduplication
- No monitoring
- Estimated: **$50-100/month** (uncontrolled)

**New (Backend)**:
- 60% cache hit rate
- Audio deduplication
- Usage monitoring
- Estimated: **$20-40/month** (controlled)

**Savings**: ~60% cost reduction

---

## Next Steps

1. **Immediate**: Add `openai` to requirements.txt
2. **Create**: Backend AI service structure
3. **Test**: Transcription endpoint with sample audio
4. **Migrate**: Frontend to use backend API
5. **Monitor**: Check costs and performance

**Ready to start implementation?** 🚀
