# AI Services Implementation Summary
**Complete Architecture: Orchestrator + Image Analysis + MongoDB Configuration**

---

## Overview

A implementação completa dos serviços de IA inclui:

1. **AI Orchestrator**: Endpoint inteligente que combina múltiplos serviços (transcrição, análise de imagem, extração de conceitos)
2. **Image Analysis**: Análise visual usando GPT-4 Vision (já funciona no Collector, agora será integrado no backend)
3. **MongoDB Configuration**: Categorias e prompts como dados (não hardcoded), atualizáveis via API

---

## Documents

### 1. AI_ORCHESTRATOR_SPEC.md
**Orchestrator endpoint com smart defaults**

#### Key Features:
- **Smart Defaults**: Sem parâmetros `output` = retorna resultados sem salvar
- **Multi-Source**: Combina áudio + imagem em workflows inteligentes
- **Auto-Detection**: Detecta workflow baseado nos inputs fornecidos
- **Flexible Output**: full/minimal/ids_only + save/return controls

#### Workflows Suportados:
- `audio_only`: Apenas transcrição + conceitos
- `image_only`: Apenas análise visual de imagem
- `place_id_with_audio`: Place + áudio → entity + curation
- `place_id_with_image`: Place + imagem → entity + curation visual
- `place_id_with_audio_and_image`: Combina ambos (conceitos deduplicated)

#### Example Call:
```bash
# Simplest: audio only, zero config
curl -X POST /api/v3/ai/orchestrate \
  -d '{"audio_file": "base64..."}'

# Returns: {"transcription": {...}, "concepts": [...]}
```

---

### 2. AI_SERVICES_MONGODB_CONFIG.md
**Configuration as Data: Categorias + Prompts no MongoDB**

#### MongoDB Collections:

**`categories`**: Categorias de conceitos por entity type
```json
{
  "entity_type": "restaurant",
  "categories": ["modern", "intimate", "impeccable_service", ...],
  "version": 1
}
```

**`openai_configs`**: Configurações de serviços OpenAI
```json
{
  "service": "image_analysis",
  "model": "gpt-4-vision-preview",
  "prompt_template": "Analise esta imagem...\n{categories}",
  "config": {"temperature": 0.3, "max_tokens": 300},
  "enabled": true
}
```

#### Services:
- **CategoryService**: Carrega categorias do MongoDB com cache
- **OpenAIConfigService**: Carrega configs + renderiza prompts
- **OpenAIService**: Usa configs MongoDB para todos os serviços

#### Benefits:
✅ Atualizar prompts sem redeploy  
✅ Adicionar entity types dinamicamente  
✅ A/B testing de diferentes configs  
✅ Feature flags (enabled: true/false)  

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Collector)                      │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Audio Input │  │ Image Upload │  │ Place Selection  │   │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘   │
│         │                 │                    │             │
│         └─────────────────┴────────────────────┘             │
│                           │                                  │
└───────────────────────────┼──────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Backend API (FastAPI + MongoDB)                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           POST /api/v3/ai/orchestrate                │   │
│  │  • Auto-detect workflow (audio/image/combined)       │   │
│  │  • Apply smart defaults                              │   │
│  │  • Execute AI services in sequence                   │   │
│  └────┬─────────────────────────────────────────────────┘   │
│       │                                                      │
│  ┌────▼──────────────────────────────────────────────────┐  │
│  │           AI Services Layer                           │  │
│  │  ┌─────────────────┐  ┌──────────────────────────┐   │  │
│  │  │ CategoryService │  │ OpenAIConfigService      │   │  │
│  │  │ • Load from DB  │  │ • Load prompts from DB   │   │  │
│  │  │ • Cache 1h      │  │ • Render templates       │   │  │
│  │  └─────────────────┘  └──────────────────────────┘   │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────────┐ │  │
│  │  │          OpenAIService                          │ │  │
│  │  │  • transcribe_audio() → Whisper                │ │  │
│  │  │  • extract_concepts_from_text() → GPT-4        │ │  │
│  │  │  • analyze_image() → GPT-4 Vision              │ │  │
│  │  └─────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              MongoDB Collections                      │   │
│  │  • entities (places data)                            │   │
│  │  • curations (curator opinions + concepts)           │   │
│  │  • categories (concept lists by entity_type)         │   │
│  │  • openai_configs (models, prompts, parameters)      │   │
│  │  • ai_transcriptions (cache)                         │   │
│  │  • ai_concepts (cache)                               │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Workflow

### Phase 1: MongoDB Configuration (2-3 hours)
1. Create `categories` collection with seed data
   - Restaurant categories (30+ concepts)
   - Bar/Hotel/Attraction (future expansion)

2. Create `openai_configs` collection with seed data
   - Transcription config (Whisper)
   - Text concept extraction (GPT-4)
   - Image analysis (GPT-4 Vision)

3. Implement `CategoryService` class
   - Load categories by entity_type
   - In-memory caching (1h TTL)
   - Fallback to restaurant if not found

4. Implement `OpenAIConfigService` class
   - Load configs by service name
   - Render prompt templates
   - Cache configs (10min TTL)

### Phase 2: OpenAI Service Enhancement (2-3 hours)
1. Update `OpenAIService` to use MongoDB configs
   - Constructor receives `db` parameter
   - Initialize CategoryService + OpenAIConfigService

2. Implement `analyze_image()` method
   - Load image_analysis config from MongoDB
   - Get categories for entity_type
   - Render prompt with categories
   - Call GPT-4 Vision API
   - Return concepts + visual_notes + confidence

3. Update existing methods to use MongoDB
   - `transcribe_audio()` loads config
   - `extract_concepts_from_text()` loads config + categories

### Phase 3: AI Orchestrator (3-4 hours)
1. Create `OutputHandler` class
   - `apply_defaults()`: Smart defaults logic
   - `format_results()`: full/minimal/ids_only
   - `save_results()`: Save to MongoDB

2. Create `AIOrchestrator` class
   - `detect_workflow()`: Auto-detect based on inputs
   - `orchestrate()`: Main entry point
   - `execute_workflow()`: Run detected workflow

3. Implement workflows:
   - `audio_only`
   - `image_only`
   - `place_id_with_audio`
   - `place_id_with_image`
   - `place_id_with_audio_and_image` (multi-source)

4. Concept combination logic
   - Deduplicate concepts from multiple sources
   - Track source in curation (text_analysis, image_analysis)

### Phase 4: API Endpoints (2 hours)
1. Create `/api/v3/ai/orchestrate` endpoint
   - Accept all input types (audio/image/place_id/entity_id)
   - Call orchestrator
   - Return formatted results

2. Create category CRUD endpoints
   - GET `/api/v3/categories`
   - GET `/api/v3/categories/{entity_type}`
   - POST `/api/v3/categories`
   - PUT `/api/v3/categories/{entity_type}`

3. Create OpenAI config CRUD endpoints
   - GET `/api/v3/ai/configs`
   - GET `/api/v3/ai/configs/{service}`
   - POST `/api/v3/ai/configs`
   - PUT `/api/v3/ai/configs/{service}`
   - PATCH `/api/v3/ai/configs/{service}/toggle`

4. Batch endpoint (optional)
   - POST `/api/v3/ai/orchestrate/batch`
   - SSE for progress streaming

### Phase 5: Testing & Documentation (2 hours)
1. Create seed data scripts
   - `seed_categories.py`
   - `seed_openai_configs.py`

2. Test workflows
   - Audio only → transcription + concepts
   - Image only → visual concepts
   - Place + audio → complete curation
   - Place + image → visual curation
   - Place + audio + image → combined concepts

3. Document in Swagger UI
   - Request/response schemas
   - Example calls for each workflow
   - Smart defaults explanation

---

## Key Design Decisions

### 1. Configuration as Data
**Decision**: Store prompts, categories, and OpenAI configs in MongoDB

**Rationale**:
- Prompts can be improved without code changes
- New entity types can be added dynamically
- A/B testing different prompts
- Cost control (switch models without redeploy)

### 2. Smart Defaults
**Decision**: No `output` object = return results without saving

**Rationale**:
- Simple calls "just work" (dev experience)
- Preview mode is common use case (review before save)
- Explicit `output` object gives full control when needed

### 3. Multi-Source Intelligence
**Decision**: Combine audio + image in single orchestrator call

**Rationale**:
- Audio captures curator opinion (subjective)
- Image captures visual characteristics (objective)
- Combined concepts are richer and more accurate
- Deduplication avoids redundant concepts

### 4. Workflow Auto-Detection
**Decision**: Detect workflow based on input presence

**Rationale**:
- Simplifies API (no manual workflow_type needed)
- Frontend can send whatever data it has
- Backend is smart enough to figure it out

---

## Cost Estimation

### OpenAI API Costs

**Whisper (Audio Transcription)**:
- $0.006 per minute
- Average 2min audio = $0.012 per transcription
- Cache TTL: 24h (60% cache hit rate)
- **Effective cost**: ~$0.005 per transcription

**GPT-4 (Text Concept Extraction)**:
- $0.03 per 1K input tokens + $0.06 per 1K output tokens
- Average: ~200 input + 100 output tokens
- Cost: $0.006 + $0.006 = $0.012 per extraction
- Cache TTL: 168h (80% cache hit rate)
- **Effective cost**: ~$0.002 per extraction

**GPT-4 Vision (Image Analysis)**:
- ~$0.00765 per image (high detail)
- Cache TTL: 168h (70% cache hit rate)
- **Effective cost**: ~$0.0023 per analysis

### Monthly Estimate (1000 curations/month)

**Audio-only workflow** (60% of curations):
- 600 × $0.005 (whisper) = $3.00
- 600 × $0.002 (concepts) = $1.20
- **Subtotal**: $4.20

**Image-only workflow** (20% of curations):
- 200 × $0.0023 (vision) = $0.46
- **Subtotal**: $0.46

**Audio + Image workflow** (20% of curations):
- 200 × $0.005 (whisper) = $1.00
- 200 × $0.002 (concepts text) = $0.40
- 200 × $0.0023 (vision) = $0.46
- **Subtotal**: $1.86

**Total estimated**: ~$6.52/month for 1000 curations

---

## Next Steps

1. **Immediate**: Create MongoDB collections with seed data
2. **Core**: Implement CategoryService + OpenAIConfigService
3. **AI**: Update OpenAIService with image analysis
4. **Orchestrator**: Build workflow detection and execution
5. **API**: Expose endpoints with Swagger docs
6. **Test**: Full end-to-end testing with all workflows
7. **Deploy**: Update .env, migrate to production

**Estimated Total Time**: 11-14 hours

**Ready to start implementation!** 🚀

---

## Quick Reference

### Files to Create:
- `app/services/category_service.py`
- `app/services/openai_config_service.py`
- `app/services/ai_orchestrator.py`
- `app/api/categories.py` (router)
- `app/api/ai_configs.py` (router)
- `scripts/seed_categories.py`
- `scripts/seed_openai_configs.py`

### Files to Modify:
- `app/services/openai_service.py` (add MongoDB config usage)
- `app/api/ai.py` (add orchestrate endpoint)
- `main.py` (register new routers)

### Collections to Create:
- `categories` (concept categories by entity type)
- `openai_configs` (service configurations and prompts)

### Environment Variables:
- `OPENAI_API_KEY` (already in .env)
- No new vars needed!
