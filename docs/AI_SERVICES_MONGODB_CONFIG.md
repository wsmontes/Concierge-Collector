# AI Services MongoDB Configuration
**Configuration as Data: Prompts, Categories & Models in MongoDB**

---

## Overview

Toda configuração de serviços OpenAI, categorias de conceitos e prompts deve ser armazenada no MongoDB (não hardcoded). Isso permite:

✅ **Hot Updates**: Alterar prompts/modelos sem redeploy  
✅ **Versioning**: Histórico completo de mudanças  
✅ **A/B Testing**: Testar diferentes configs em paralelo  
✅ **Feature Flags**: Ativar/desativar serviços dinamicamente  
✅ **Multi-language**: Suportar múltiplos idiomas facilmente  
✅ **Cost Control**: Trocar modelos (gpt-4 → gpt-3.5) sem código  

---

## MongoDB Collections

### Collection: `categories`

Armazena categorias de conceitos por tipo de entidade (expandível).

#### Document Schema
```json
{
  "_id": "ObjectId(...)",
  "entity_type": "restaurant",
  "categories": [
    // Ambiance
    "modern", "traditional", "creative", "authentic", "innovative",
    "elegant", "casual", "intimate", "lively", "cozy", "upscale",
    
    // Audience
    "family_friendly", "romantic", "business", "trendy",
    
    // Service
    "impeccable_service", "friendly_service", "professional_service",
    
    // Value
    "great_value", "premium",
    
    // Food
    "local_ingredients", "seasonal", "organic", "farm_to_table",
    
    // Features
    "wine_focus", "cocktail_bar", "open_kitchen", "terrace",
    "historic_building", "contemporary_design", "minimalist",
    "michelin_star", "hidden_gem"
  ],
  "description": "Concept categories for restaurant entities",
  "version": 1,
  "updated_at": "2025-11-17T10:30:00Z",
  "updated_by": "admin",
  "active": true
}
```

#### Examples by Entity Type

**Bar:**
```json
{
  "entity_type": "bar",
  "categories": [
    "speakeasy", "rooftop", "dive_bar", "cocktail_lounge",
    "sports_bar", "wine_bar", "craft_beer", "live_music",
    "signature_cocktails", "extensive_wine_list", "craft_spirits",
    "happy_hour", "late_night", "dancefloor"
  ]
}
```

**Hotel:**
```json
{
  "entity_type": "hotel",
  "categories": [
    "boutique", "luxury", "budget", "business", "resort",
    "spa", "rooftop_pool", "gym", "restaurant", "bar",
    "conference_rooms", "concierge", "valet_parking",
    "historic", "modern", "minimalist", "art_deco"
  ]
}
```

**Attraction:**
```json
{
  "entity_type": "attraction",
  "categories": [
    "historic", "cultural", "museum", "gallery", "monument",
    "religious", "architecture", "unesco", "free_entry",
    "guided_tours", "audio_guide", "family_friendly",
    "photo_spot", "must_see", "hidden_gem"
  ]
}
```

#### API Endpoints (CRUD para Categories)

```python
# GET /api/v3/categories?entity_type=restaurant
# POST /api/v3/categories (create new)
# PUT /api/v3/categories/{entity_type} (update)
# DELETE /api/v3/categories/{entity_type}
```

---

### Collection: `openai_configs`

Armazena configurações específicas para cada serviço OpenAI (models, prompts, params).

#### Service: `transcription` (Whisper)

```json
{
  "_id": "ObjectId(...)",
  "service": "transcription",
  "model": "whisper-1",
  "config": {
    "language": "pt-BR",
    "temperature": 0.2,
    "response_format": "verbose_json",
    "timestamp_granularities": ["word", "segment"]
  },
  "cache_ttl_hours": 24,
  "cache_by": "audio_hash",
  "cost_per_minute": 0.006,
  "max_file_size_mb": 25,
  "supported_formats": ["mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"],
  "enabled": true,
  "version": 1,
  "updated_at": "2025-11-17T10:30:00Z",
  "updated_by": "admin"
}
```

#### Service: `concept_extraction_text` (GPT-4)

```json
{
  "_id": "ObjectId(...)",
  "service": "concept_extraction_text",
  "model": "gpt-4",
  "config": {
    "temperature": 0.3,
    "max_tokens": 500,
    "top_p": 1.0,
    "frequency_penalty": 0.0,
    "presence_penalty": 0.0
  },
  "prompt_template": "Você é um especialista em análise de restaurantes com 20 anos de experiência em crítica gastronômica.\n\nAnalise o seguinte texto de uma curadoria e extraia conceitos relevantes que descrevem o estabelecimento.\n\n**Texto da curadoria:**\n{text}\n\n**Categorias disponíveis:**\n{categories}\n\n**Instruções:**\n- Extraia APENAS conceitos que aparecem explicitamente ou implicitamente no texto\n- Use APENAS conceitos da lista de categorias disponíveis\n- Ignore conceitos não relacionados ao estabelecimento\n- Retorne múltiplos conceitos se aplicável (mínimo 2, máximo 8)\n- Avalie sua confiança na análise (0.0 a 1.0)\n\n**Responda APENAS em JSON válido:**\n{\"concepts\": [\"concept1\", \"concept2\", \"concept3\"], \"confidence_score\": 0.85}",
  "cache_ttl_hours": 168,
  "cache_by": "text_hash",
  "cost_per_token_input": 0.00003,
  "cost_per_token_output": 0.00006,
  "enabled": true,
  "version": 3,
  "updated_at": "2025-11-17T10:35:00Z",
  "updated_by": "admin",
  "notes": "v3: Melhorado prompt com contexto de especialista e limites (2-8 conceitos)"
}
```

#### Service: `image_analysis` (GPT-4o Vision)

```json
{
  "_id": "ObjectId(...)",
  "service": "image_analysis",
  "model": "gpt-4o",
  "config": {
    "temperature": 0.3,
    "max_tokens": 300,
    "detail": "high"
  },
  "prompt_template": "Você é um especialista em análise visual de restaurantes e ambientes gastronômicos.\n\nAnalise esta imagem e identifique conceitos visuais relevantes que descrevem o estabelecimento.\n\n**Categorias disponíveis:**\n{categories}\n\n**Foque nos seguintes aspectos:**\n- Ambiance e atmosfera (modern, elegant, cozy, etc.)\n- Design e arquitetura (contemporary_design, historic_building, etc.)\n- Setting e espaço (open_kitchen, terrace, intimate, etc.)\n- Crowd e público visível (business, family_friendly, etc.)\n- Food presentation (se visível)\n\n**Instruções:**\n- Extraia conceitos que você pode IDENTIFICAR VISUALMENTE na imagem\n- Use APENAS conceitos da lista de categorias disponíveis\n- Ignore conceitos que requerem contexto não-visual (ex: service, price)\n- Retorne 2-6 conceitos visuais aplicáveis\n- Avalie sua confiança na análise visual (0.0 a 1.0)\n\n**Responda APENAS em JSON válido:**\n{\"concepts\": [\"concept1\", \"concept2\"], \"confidence_score\": 0.80, \"visual_notes\": \"brief description of what you see\"}",
  "cache_ttl_hours": 168,
  "cache_by": "image_hash",
  "cost_per_image": 0.00765,
  "max_file_size_mb": 20,
  "supported_formats": ["jpg", "jpeg", "png", "gif", "webp"],
  "enabled": true,
  "version": 2,
  "updated_at": "2025-11-17T10:40:00Z",
  "updated_by": "admin",
  "notes": "v2: Adicionado visual_notes para debug e melhores insights"
}
```

#### API Endpoints (CRUD para OpenAI Configs)

```python
# GET /api/v3/ai/configs
# GET /api/v3/ai/configs/{service}
# POST /api/v3/ai/configs (create new service config)
# PUT /api/v3/ai/configs/{service} (update config)
# PATCH /api/v3/ai/configs/{service}/toggle (enable/disable)
```

---

## Service Implementation with MongoDB Config

### CategoryService

```python
class CategoryService:
    """Manages concept categories from MongoDB"""
    
    def __init__(self, db):
        self.db = db
        self.cache = {}  # In-memory cache
        self.cache_ttl = 3600  # 1 hour
    
    async def get_categories(self, entity_type: str) -> list:
        """Get categories for entity type (with caching)"""
        cache_key = f"categories:{entity_type}"
        
        # Check cache
        if cache_key in self.cache:
            cached_data, timestamp = self.cache[cache_key]
            if time.time() - timestamp < self.cache_ttl:
                return cached_data
        
        # Fetch from MongoDB
        doc = await self.db.categories.find_one({
            "entity_type": entity_type,
            "active": True
        })
        
        if not doc:
            # Fallback to restaurant categories
            doc = await self.db.categories.find_one({
                "entity_type": "restaurant",
                "active": True
            })
        
        categories = doc.get("categories", [])
        
        # Update cache
        self.cache[cache_key] = (categories, time.time())
        
        return categories
    
    async def update_categories(
        self, 
        entity_type: str, 
        categories: list, 
        updated_by: str
    ) -> dict:
        """Update categories for entity type"""
        result = await self.db.categories.update_one(
            {"entity_type": entity_type},
            {
                "$set": {
                    "categories": categories,
                    "updated_at": datetime.utcnow().isoformat(),
                    "updated_by": updated_by
                },
                "$inc": {"version": 1}
            },
            upsert=True
        )
        
        # Invalidate cache
        cache_key = f"categories:{entity_type}"
        if cache_key in self.cache:
            del self.cache[cache_key]
        
        return {"updated": True, "entity_type": entity_type}
```

### OpenAIConfigService

```python
class OpenAIConfigService:
    """Manages OpenAI service configurations from MongoDB"""
    
    def __init__(self, db):
        self.db = db
        self.cache = {}
        self.cache_ttl = 600  # 10 minutes (configs mudam menos)
    
    async def get_config(self, service: str) -> dict:
        """Get configuration for OpenAI service"""
        cache_key = f"openai_config:{service}"
        
        # Check cache
        if cache_key in self.cache:
            cached_data, timestamp = self.cache[cache_key]
            if time.time() - timestamp < self.cache_ttl:
                return cached_data
        
        # Fetch from MongoDB
        config = await self.db.openai_configs.find_one({
            "service": service,
            "enabled": True
        })
        
        if not config:
            raise ValueError(f"Service '{service}' not found or disabled")
        
        # Update cache
        self.cache[cache_key] = (config, time.time())
        
        return config
    
    async def render_prompt(
        self, 
        service: str, 
        variables: dict
    ) -> str:
        """Render prompt template with variables"""
        config = await self.get_config(service)
        prompt_template = config.get("prompt_template", "")
        
        # Simple template rendering (ou usar Jinja2)
        for key, value in variables.items():
            placeholder = "{" + key + "}"
            if isinstance(value, list):
                value = ", ".join(value)
            prompt_template = prompt_template.replace(placeholder, str(value))
        
        return prompt_template
    
    async def update_config(
        self, 
        service: str, 
        updates: dict, 
        updated_by: str
    ) -> dict:
        """Update OpenAI service configuration"""
        result = await self.db.openai_configs.update_one(
            {"service": service},
            {
                "$set": {
                    **updates,
                    "updated_at": datetime.utcnow().isoformat(),
                    "updated_by": updated_by
                },
                "$inc": {"version": 1}
            },
            upsert=True
        )
        
        # Invalidate cache
        cache_key = f"openai_config:{service}"
        if cache_key in self.cache:
            del self.cache[cache_key]
        
        return {"updated": True, "service": service}
```

### Updated OpenAIService (usando configs do MongoDB)

```python
class OpenAIService:
    """OpenAI service using MongoDB configuration"""
    
    def __init__(self, api_key: str, db):
        self.client = OpenAI(api_key=api_key)
        self.db = db
        self.config_service = OpenAIConfigService(db)
        self.category_service = CategoryService(db)
    
    async def transcribe_audio(
        self, 
        audio_file, 
        language: str = None
    ) -> dict:
        """Transcribe audio using Whisper with MongoDB config"""
        # Get service configuration
        config = await self.config_service.get_config("transcription")
        
        # Use config parameters
        model = config["model"]
        params = config["config"].copy()
        if language:
            params["language"] = language
        
        # Call OpenAI
        response = self.client.audio.transcriptions.create(
            model=model,
            file=audio_file,
            **params
        )
        
        return {
            "transcription_id": f"trans_{uuid.uuid4().hex[:12]}",
            "text": response.text,
            "language": params["language"],
            "model": model,
            "duration": response.duration if hasattr(response, 'duration') else None
        }
    
    async def extract_concepts_from_text(
        self, 
        text: str, 
        entity_type: str = "restaurant"
    ) -> dict:
        """Extract concepts from text using GPT-4 with MongoDB config"""
        # Get categories for entity type
        categories = await self.category_service.get_categories(entity_type)
        
        # Get service configuration
        config = await self.config_service.get_config("concept_extraction_text")
        
        # Render prompt with variables
        prompt = await self.config_service.render_prompt(
            "concept_extraction_text",
            {
                "text": text,
                "categories": categories
            }
        )
        
        # Call OpenAI
        response = self.client.chat.completions.create(
            model=config["model"],
            messages=[{"role": "user", "content": prompt}],
            **config["config"]
        )
        
        # Parse JSON response
        result = json.loads(response.choices[0].message.content)
        result["entity_type"] = entity_type
        result["model"] = config["model"]
        
        return result
    
    async def analyze_image(
        self, 
        image_url: str, 
        entity_type: str = "restaurant"
    ) -> dict:
        """Analyze image using GPT-4 Vision with MongoDB config"""
        # Get categories for entity type
        categories = await self.category_service.get_categories(entity_type)
        
        # Get service configuration
        config = await self.config_service.get_config("image_analysis")
        
        # Render prompt with variables
        prompt = await self.config_service.render_prompt(
            "image_analysis",
            {"categories": categories}
        )
        
        # Call OpenAI Vision
        response = self.client.chat.completions.create(
            model=config["model"],
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": image_url}}
                    ]
                }
            ],
            **config["config"]
        )
        
        # Parse JSON response
        result = json.loads(response.choices[0].message.content)
        result["entity_type"] = entity_type
        result["model"] = config["model"]
        
        return result
```

---

## Updated Orchestrator with Image Support

```python
async def execute_workflow(self, workflow: str, request: dict) -> dict:
    """Execute workflow with image analysis support"""
    results = {}
    entity_type = request.get("entity_type", "restaurant")
    
    if workflow == "place_id_with_audio":
        # ... existing code ...
        pass
    
    elif workflow == "place_id_with_image":
        # 1. Fetch place details
        place_data = await self.places.get_place_details(request["place_id"])
        results["entity"] = self.transform_to_entity(place_data, entity_type)
        
        # 2. Analyze image
        image = request.get("image_url") or request.get("image_file")
        concepts = await self.openai.analyze_image(image, entity_type)
        results["image_analysis"] = concepts
        
        # 3. Create curation
        results["curation"] = {
            "curation_id": f"cur_{uuid.uuid4().hex[:12]}",
            "entity_id": results["entity"]["entity_id"],
            "curator_id": request.get("curator_id"),
            "concepts": concepts["concepts"],
            "source": "image_analysis",
            "visual_notes": concepts.get("visual_notes"),
            "entity_type": entity_type,
            "created_at": datetime.utcnow().isoformat()
        }
    
    elif workflow == "place_id_with_audio_and_image":
        # Complete workflow: place + audio + image
        # Combines concepts from both text and visual analysis
        pass
    
    return results
```

---

## Benefits Summary

### Configuration as Data ✅
- **No Hardcoding**: Tudo no MongoDB, atualizável via API
- **Hot Reload**: Mudanças sem redeploy da aplicação
- **Version Control**: Histórico completo de prompts/configs

### Flexibility ✅
- **A/B Testing**: Testar diferentes prompts em paralelo
- **Feature Flags**: Ligar/desligar serviços dinamicamente
- **Cost Management**: Trocar modelos sem mexer em código

### Extensibility ✅
- **New Entity Types**: Adicionar bar/hotel/attraction facilmente
- **Multi-language**: Configs por idioma (pt-BR, en-US, es-ES)
- **Image Analysis**: Integrado no orchestrator com mesmas categorias

### Developer Experience ✅
- **API-First**: CRUD endpoints para categories e configs
- **Caching**: Performance com cache in-memory
- **Observability**: Version tracking e audit trail

---

## Migration Checklist

- [ ] Create `categories` collection with initial restaurant data
- [ ] Create `openai_configs` collection with all 3 services
- [ ] Implement `CategoryService` with caching
- [ ] Implement `OpenAIConfigService` with prompt rendering
- [ ] Update `OpenAIService` to use MongoDB configs
- [ ] Add CRUD endpoints for categories (`/api/v3/categories`)
- [ ] Add CRUD endpoints for configs (`/api/v3/ai/configs`)
- [ ] Update orchestrator to support image analysis workflow
- [ ] Test all workflows with MongoDB-based configs
- [ ] Document API in Swagger UI

**Ready to implement configuration-driven AI services!** 🚀
