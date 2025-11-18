# AI Orchestrator Specification
**Intelligent Workflow Endpoint with Smart Defaults & MongoDB Configuration**

---

## Overview

O endpoint `/api/v3/ai/orchestrate` combina múltiplos serviços de IA (transcrição, extração de conceitos por áudio/imagem, busca de places, criação de entities/curations) em workflows inteligentes.

**Princípios de Design:**
- **Smart Defaults**: Chamadas simples funcionam sem configuração
- **Flexibilidade**: Controle total quando necessário
- **Eficiência**: Opções para batch processing e minimal output
- **Type-Aware**: Categorias de conceitos baseadas no tipo de entidade
- **Configuration as Data**: Prompts, categorias e configurações OpenAI no MongoDB (não hardcoded)

---

## Endpoint: POST /api/v3/ai/orchestrate

### Request Schema

```json
{
  "workflow_type": "auto",  // auto, place_id, entity_id, audio_only, concept_only
  
  // Input sources (at least one required)
  "place_id": "ChIJ...",           // Google Place ID
  "entity_id": "ent_...",          // Existing entity ID
  "audio_file": "base64...",       // Audio recording (base64)
  "audio_url": "https://...",      // Audio URL
  "image_file": "base64...",       // Image for visual concept extraction
  "image_url": "https://...",      // Image URL
  "text": "Raw text input",        // Direct text input
  
  // Output control (ALL OPTIONAL)
  "output": {
    "save_to_db": true,            // Save entities/curations to DB
    "return_results": true,        // Return full results in response
    "format": "full"               // full, minimal, ids_only
  },
  
  // Optional parameters
  "language": "pt-BR",             // Transcription language
  "curator_id": "cur_123",         // Curator ID
  "entity_type": "restaurant"      // Entity type (default: restaurant)
}
```

### Smart Defaults

#### 1. Ausência de `output` object
```javascript
// Request SEM output object
{
  "audio_file": "base64..."
}

// Comportamento: Retorna resultados completos SEM salvar
// Equivalente a:
{
  "audio_file": "base64...",
  "output": {
    "save_to_db": false,
    "return_results": true,
    "format": "full"
  }
}
```

#### 2. Presença de `output` object com campos omitidos
```javascript
// Request COM output object parcial
{
  "audio_file": "base64...",
  "output": {
    "save_to_db": true
  }
}

// Defaults aplicados:
{
  "audio_file": "base64...",
  "output": {
    "save_to_db": true,
    "return_results": false,  // ← Default quando output presente
    "format": "full"          // ← Default sempre
  }
}
```

#### 3. Entity Type
```javascript
// Sem entity_type
{ "audio_file": "..." }
// → entity_type = "restaurant" (default)
// → Usa categorias de restaurante para conceitos

// Com entity_type
{ "audio_file": "...", "entity_type": "bar" }
// → Usa categorias de bar (quando disponível)
// → Fallback para restaurant se não tiver
```

### Lógica de Defaults (Python)

```python
def apply_defaults(request_data: dict) -> dict:
    """Apply smart defaults based on presence/absence of output object"""
    
    # Default: No output object = return results without saving
    if "output" not in request_data:
        request_data["output"] = {
            "save_to_db": False,
            "return_results": True,
            "format": "full"
        }
    else:
        # Output object present: apply individual defaults
        output = request_data["output"]
        
        if "format" not in output:
            output["format"] = "full"
        
        if "return_results" not in output:
            output["return_results"] = False
        
        if "save_to_db" not in output:
            output["save_to_db"] = True
    
    # Entity type default
    if "entity_type" not in request_data:
        request_data["entity_type"] = "restaurant"
    
    return request_data
```

---

## Response Schema

```json
{
  "workflow": "place_id_with_audio",
  "results": {
    "entity": {
      "entity_id": "place_ChIJ...",
      "name": "Restaurant Name",
      "location": {...},
      "created": true
    },
    "transcription": {
      "transcription_id": "trans_...",
      "text": "Transcribed text...",
      "language": "pt-BR"
    },
    "concepts": {
      "concepts": ["modern", "creative", "intimate"],
      "confidence_score": 0.89,
      "category_context": "restaurant"
    },
    "curation": {
      "curation_id": "cur_...",
      "entity_id": "place_ChIJ...",
      "curator_id": "cur_123",
      "created": true
    }
  },
  "saved_to_db": true,
  "processing_time_ms": 2456
}
```

**Response with Image Analysis:**
```json
{
  "workflow": "place_id_with_image",
  "results": {
    "entity": {...},
    "image_analysis": {
      "concepts": ["modern", "elegant", "open_kitchen"],
      "confidence_score": 0.82,
      "visual_notes": "Contemporary design with visible open kitchen",
      "category_context": "restaurant"
    },
    "curation": {...}
  },
  "saved_to_db": true,
  "processing_time_ms": 1834
}
```

---

## Configuration: MongoDB Collections

**⚠️ IMPORTANTE**: Categorias de conceitos e configurações OpenAI (prompts, modelos, parâmetros) são armazenadas no MongoDB, **não hardcoded**.

Veja especificação completa em: **[AI_SERVICES_MONGODB_CONFIG.md](./AI_SERVICES_MONGODB_CONFIG.md)**

### Collections Overview:

1. **`categories`**: Categorias de conceitos por tipo de entidade
   - `entity_type`: "restaurant", "bar", "hotel", "attraction"
   - `categories`: Array de conceitos aplicáveis
   - `version`, `updated_at`, `updated_by`: Audit trail

2. **`openai_configs`**: Configurações de serviços OpenAI
   - `service`: "transcription", "concept_extraction_text", "image_analysis"
   - `model`: Modelo OpenAI a usar
   - `config`: Parâmetros (temperature, max_tokens, etc.)
   - `prompt_template`: Template do prompt (com variáveis)
   - `cache_ttl_hours`: Tempo de cache
   - `enabled`: Feature flag

### Benefits:
✅ Atualizar prompts sem redeploy  
✅ Adicionar novos entity types dinamicamente  
✅ A/B testing de diferentes configs  
✅ Trocar modelos (gpt-4 → gpt-3.5) via API  

---

## Concept Categories by Entity Type

**⚠️ Categorias abaixo são exemplos**. Versão real vem do MongoDB (`categories` collection).

### Restaurant (Default)
```python
RESTAURANT_CATEGORIES = [
    # Ambiance
    "modern", "traditional", "creative", "authentic", "innovative",
    "elegant", "casual", "intimate", "lively", "cozy", "upscale",
    
    # Audience
    "family_friendly", "romantic", "business", "trendy",
    
    # Service
    "impeccable_service", "friendly_service", "professional_service",
    
    # Value
    "great_value", "premium",
    
    # Food
    "local_ingredients", "seasonal", "organic", "farm_to_table",
    
    # Features
    "wine_focus", "cocktail_bar", "open_kitchen", "terrace",
    "historic_building", "contemporary_design", "minimalist",
    "michelin_star", "hidden_gem"
]
```

### Bar (Futuro)
```python
BAR_CATEGORIES = [
    # Ambiance
    "speakeasy", "rooftop", "dive_bar", "cocktail_lounge",
    "sports_bar", "wine_bar", "craft_beer", "live_music",
    
    # Features
    "signature_cocktails", "extensive_wine_list", "craft_spirits",
    "happy_hour", "late_night", "dancefloor",
    
    # Crowd
    "locals", "tourists", "professionals", "students"
]
```

### Hotel (Futuro)
```python
HOTEL_CATEGORIES = [
    # Type
    "boutique", "luxury", "budget", "business", "resort",
    
    # Features
    "spa", "rooftop_pool", "gym", "restaurant", "bar",
    "conference_rooms", "concierge", "valet_parking",
    
    # Style
    "historic", "modern", "minimalist", "art_deco"
]
```

### Implementação

```python
class AIOrchestrator:
    """Main orchestration service"""
    
    # Category mappings by entity type
    CATEGORY_MAPPINGS = {
        "restaurant": RESTAURANT_CATEGORIES,
        # Future expansions:
        # "bar": BAR_CATEGORIES,
        # "hotel": HOTEL_CATEGORIES,
        # "attraction": ATTRACTION_CATEGORIES
    }
    
    def get_categories_for_type(self, entity_type: str) -> list:
        """Get concept categories based on entity type"""
        return self.CATEGORY_MAPPINGS.get(
            entity_type, 
            self.CATEGORY_MAPPINGS["restaurant"]  # Fallback
        )
    
    async def extract_concepts_with_context(
        self, 
        text: str, 
        entity_type: str
    ) -> dict:
        """Extract concepts using entity-specific categories"""
        categories = self.get_categories_for_type(entity_type)
        
        concepts = await self.openai.extract_concepts(
            text,
            categories=categories,
            entity_type=entity_type
        )
        
        # Add context to response
        concepts["category_context"] = entity_type
        concepts["available_categories"] = len(categories)
        
        return concepts
```

---

## Usage Examples

### Example 1: Simplest Call (Audio Only, Zero Config)
```bash
curl -X POST http://localhost:8000/api/v3/ai/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "audio_file": "base64_encoded_audio..."
  }'
```

**Response:**
```json
{
  "workflow": "audio_only",
  "results": {
    "transcription": {
      "text": "Ambiente moderno, serviço impecável, comida criativa"
    },
    "concepts": {
      "concepts": ["modern", "impeccable_service", "creative"],
      "category_context": "restaurant",
      "available_categories": 30
    }
  },
  "saved_to_db": false,
  "processing_time_ms": 1823
}
```

### Example 2: Preview Before Saving
```bash
curl -X POST http://localhost:8000/api/v3/ai/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
    "audio_file": "base64_encoded_audio...",
    "output": {
      "save_to_db": false,
      "return_results": true
    }
  }'
```

**Use Case**: Curador quer revisar resultados antes de confirmar

### Example 3: Complete Workflow (Place + Audio + Save)
```bash
curl -X POST http://localhost:8000/api/v3/ai/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
    "audio_file": "base64_encoded_audio...",
    "curator_id": "cur_123",
    "output": {
      "save_to_db": true,
      "return_results": true,
      "format": "full"
    }
  }'
```

**Use Case**: Curação completa em campo com confirmação visual

### Example 4: Save Without Returning (Efficient Batch)
```bash
curl -X POST http://localhost:8000/api/v3/ai/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
    "audio_file": "base64_encoded_audio...",
    "curator_id": "cur_123",
    "output": {
      "save_to_db": true,
      "format": "ids_only"
    }
  }'
```

**Response (fast, minimal):**
```json
{
  "workflow": "place_id_with_audio",
  "results": {
    "entity_id": "place_ChIJN1t_tDeuEmsRUsoyG83frY4",
    "curation_id": "cur_a1b2c3d4e5f6"
  },
  "saved_to_db": true,
  "processing_time_ms": 1245
}
```

**Use Case**: Import em massa (CSV com 100+ lugares)

### Example 5: Image Analysis Only
```bash
curl -X POST http://localhost:8000/api/v3/ai/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/restaurant-interior.jpg"
  }'
```

**Response:**
```json
{
  "workflow": "image_only",
  "results": {
    "image_analysis": {
      "concepts": ["modern", "elegant", "open_kitchen", "contemporary_design"],
      "confidence_score": 0.82,
      "visual_notes": "Modern interior with exposed kitchen, clean lines, warm lighting",
      "category_context": "restaurant"
    }
  },
  "saved_to_db": false,
  "processing_time_ms": 1456
}
```

**Use Case**: Preview visual concepts antes de criar curação

### Example 6: Place + Image (Visual Curation)
```bash
curl -X POST http://localhost:8000/api/v3/ai/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
    "image_file": "base64_encoded_image...",
    "curator_id": "cur_123",
    "output": {
      "save_to_db": true,
      "format": "full"
    }
  }'
```

**Response:**
```json
{
  "workflow": "place_id_with_image",
  "results": {
    "entity": {
      "entity_id": "place_ChIJN1t_tDeuEmsRUsoyG83frY4",
      "name": "Restaurant Name"
    },
    "image_analysis": {
      "concepts": ["modern", "open_kitchen", "intimate"],
      "visual_notes": "Contemporary design with visible kitchen area"
    },
    "curation": {
      "curation_id": "cur_xyz789",
      "source": "image_analysis"
    }
  },
  "saved_to_db": true
}
```

**Use Case**: Curação rápida baseada apenas em fotos (sem áudio)

### Example 7: Complete Multi-Source (Audio + Image)
```bash
curl -X POST http://localhost:8000/api/v3/ai/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
    "audio_file": "base64_audio...",
    "image_file": "base64_image...",
    "curator_id": "cur_123",
    "output": {
      "save_to_db": true,
      "return_results": true
    }
  }'
```

**Response (combined concepts):**
```json
{
  "workflow": "place_id_with_audio_and_image",
  "results": {
    "entity": {...},
    "transcription": {
      "text": "Serviço impecável, ambiente acolhedor"
    },
    "text_concepts": {
      "concepts": ["impeccable_service", "cozy"],
      "confidence_score": 0.88
    },
    "image_analysis": {
      "concepts": ["modern", "intimate", "contemporary_design"],
      "confidence_score": 0.82
    },
    "curation": {
      "concepts": ["modern", "intimate", "impeccable_service", "cozy"],
      "sources": ["text_analysis", "image_analysis"]
    }
  },
  "saved_to_db": true
}
```

**Use Case**: Curação completa com múltiplas fontes de informação

### Example 8: Different Entity Type (Future)
```bash
curl -X POST http://localhost:8000/api/v3/ai/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "place_id": "ChIJ...",
    "audio_file": "base64...",
    "entity_type": "bar",
    "curator_id": "cur_123"
  }'
```

**Comportamento:**
- Tenta usar `BAR_CATEGORIES` se disponível
- Fallback para `RESTAURANT_CATEGORIES` se não existir
- Response inclui `category_context: "bar"`

---

## Batch Processing

### Endpoint: POST /api/v3/ai/orchestrate/batch

```json
{
  "items": [
    {
      "place_id": "ChIJ...",
      "audio_file": "base64_1...",
      "curator_id": "cur_123"
    },
    {
      "place_id": "ChIJ...",
      "audio_file": "base64_2...",
      "curator_id": "cur_123"
    }
  ],
  "output": {
    "save_to_db": true,
    "format": "ids_only"  // Efficient for large batches
  },
  "concurrency_limit": 5
}
```

**Progress Streaming (SSE):**
```
event: progress
data: {"processed": 1, "total": 50, "current": "Restaurant A"}

event: progress
data: {"processed": 2, "total": 50, "current": "Restaurant B"}

event: complete
data: {"total": 50, "success": 48, "failed": 2, "cost": "$12.45"}
```

---

## Implementation Classes

### OutputHandler

```python
class OutputHandler:
    """Handles flexible output formatting and storage"""
    
    @staticmethod
    def apply_defaults(request_data: dict) -> dict:
        """Apply smart defaults based on presence/absence of output object"""
        if "output" not in request_data:
            # No output object = return full results without saving
            request_data["output"] = {
                "save_to_db": False,
                "return_results": True,
                "format": "full"
            }
        else:
            # With output object, apply individual defaults
            if "format" not in request_data["output"]:
                request_data["output"]["format"] = "full"
            if "return_results" not in request_data["output"]:
                request_data["output"]["return_results"] = False
            if "save_to_db" not in request_data["output"]:
                request_data["output"]["save_to_db"] = True
        
        # Entity type default
        if "entity_type" not in request_data:
            request_data["entity_type"] = "restaurant"
        
        return request_data
    
    @staticmethod
    async def format_results(results: dict, format_type: str) -> dict:
        if format_type == "full":
            return results
        elif format_type == "minimal":
            return {
                "entity_id": results.get("entity", {}).get("entity_id"),
                "curation_id": results.get("curation", {}).get("curation_id"),
                "concepts": results.get("concepts", {}).get("concepts", [])
            }
        elif format_type == "ids_only":
            return {
                "entity_id": results.get("entity", {}).get("entity_id"),
                "curation_id": results.get("curation", {}).get("curation_id")
            }
    
    @staticmethod
    async def save_results(db, results: dict):
        """Save entity and curation to MongoDB"""
        saved_items = []
        
        # Save entity if present
        if "entity" in results:
            await db.entities.update_one(
                {"entity_id": results["entity"]["entity_id"]},
                {"$set": results["entity"]},
                upsert=True
            )
            saved_items.append("entity")
        
        # Save curation if present
        if "curation" in results:
            await db.curations.insert_one(results["curation"])
            saved_items.append("curation")
        
        return saved_items
```

### AIOrchestrator

```python
class AIOrchestrator:
    """Main orchestration service combining all AI operations"""
    
    # Category mappings by entity type (expandable)
    CATEGORY_MAPPINGS = {
        "restaurant": RESTAURANT_CATEGORIES,
        # Future: "bar", "hotel", "attraction", etc.
    }
    
    def __init__(self, db, openai_service, places_service):
        self.db = db
        self.openai = openai_service
        self.places = places_service
        self.output_handler = OutputHandler()
    
    def get_categories_for_type(self, entity_type: str) -> list:
        """Get concept categories based on entity type"""
        return self.CATEGORY_MAPPINGS.get(
            entity_type, 
            self.CATEGORY_MAPPINGS["restaurant"]
        )
    
    async def detect_workflow(self, request: dict) -> str:
        """Auto-detect workflow type based on inputs"""
        has_place_id = "place_id" in request
        has_entity_id = "entity_id" in request
        has_audio = "audio_file" in request or "audio_url" in request
        has_image = "image_file" in request or "image_url" in request
        has_text = "text" in request
        
        # Manual workflow type takes precedence
        if request.get("workflow_type") != "auto":
            return request["workflow_type"]
        
        # Auto-detect based on combinations
        if has_place_id and has_audio and has_image:
            return "place_id_with_audio_and_image"
        elif has_place_id and has_audio:
            return "place_id_with_audio"
        elif has_place_id and has_image:
            return "place_id_with_image"
        elif has_entity_id and has_audio:
            return "entity_id_with_audio"
        elif has_entity_id and has_image:
            return "entity_id_with_image"
        elif has_audio or has_text:
            return "audio_only"
        elif has_image:
            return "image_only"
        elif has_place_id:
            return "place_id_only"
        else:
            raise ValueError("Cannot detect workflow: insufficient inputs")
    
    async def orchestrate(self, request: dict) -> dict:
        """Main orchestration method"""
        start_time = time.time()
        
        # Apply defaults
        request = self.output_handler.apply_defaults(request)
        
        # Detect workflow
        workflow = await self.detect_workflow(request)
        
        # Execute workflow
        results = await self.execute_workflow(workflow, request)
        
        # Handle output
        if request["output"]["save_to_db"]:
            await self.output_handler.save_results(self.db, results)
        
        # Format response
        if request["output"]["return_results"]:
            formatted = await self.output_handler.format_results(
                results, 
                request["output"]["format"]
            )
        else:
            formatted = {}
        
        processing_time = int((time.time() - start_time) * 1000)
        
        return {
            "workflow": workflow,
            "results": formatted,
            "saved_to_db": request["output"]["save_to_db"],
            "processing_time_ms": processing_time
        }
    
    async def execute_workflow(self, workflow: str, request: dict) -> dict:
        """Execute the detected workflow"""
        results = {}
        entity_type = request["entity_type"]
        categories = self.get_categories_for_type(entity_type)
        
        if workflow == "place_id_with_audio":
            # 1. Fetch place details
            place_data = await self.places.get_place_details(request["place_id"])
            results["entity"] = self.transform_to_entity(place_data, entity_type)
            
            # 2. Transcribe audio
            audio = request.get("audio_file") or request.get("audio_url")
            transcription = await self.openai.transcribe_audio(
                audio, 
                request.get("language", "pt-BR")
            )
            results["transcription"] = transcription
            
            # 3. Extract concepts with entity-specific categories
            concepts = await self.openai.extract_concepts(
                transcription["text"],
                categories=categories,
                entity_type=entity_type
            )
            concepts["category_context"] = entity_type
            results["concepts"] = concepts
            
            # 4. Create curation
            results["curation"] = {
                "curation_id": f"cur_{uuid.uuid4().hex[:12]}",
                "entity_id": results["entity"]["entity_id"],
                "curator_id": request.get("curator_id"),
                "transcription_id": transcription["transcription_id"],
                "concepts": concepts["concepts"],
                "entity_type": entity_type,
                "created_at": datetime.utcnow().isoformat()
            }
        
        elif workflow == "audio_only":
            # Transcribe
            audio = request.get("audio_file") or request.get("audio_url")
            transcription = await self.openai.transcribe_audio(
                audio, 
                request.get("language", "pt-BR")
            )
            results["transcription"] = transcription
            
            # Extract concepts
            concepts = await self.openai.extract_concepts(
                transcription["text"],
                categories=categories,
                entity_type=entity_type
            )
            concepts["category_context"] = entity_type
            results["concepts"] = concepts
        
        elif workflow == "image_only":
            # Analyze image
            image = request.get("image_file") or request.get("image_url")
            image_analysis = await self.openai.analyze_image(
                image,
                entity_type=entity_type
            )
            image_analysis["category_context"] = entity_type
            results["image_analysis"] = image_analysis
        
        elif workflow == "place_id_with_image":
            # 1. Fetch place details
            place_data = await self.places.get_place_details(request["place_id"])
            results["entity"] = self.transform_to_entity(place_data, entity_type)
            
            # 2. Analyze image
            image = request.get("image_file") or request.get("image_url")
            image_analysis = await self.openai.analyze_image(image, entity_type)
            image_analysis["category_context"] = entity_type
            results["image_analysis"] = image_analysis
            
            # 3. Create curation
            results["curation"] = {
                "curation_id": f"cur_{uuid.uuid4().hex[:12]}",
                "entity_id": results["entity"]["entity_id"],
                "curator_id": request.get("curator_id"),
                "concepts": image_analysis["concepts"],
                "source": "image_analysis",
                "visual_notes": image_analysis.get("visual_notes"),
                "entity_type": entity_type,
                "created_at": datetime.utcnow().isoformat()
            }
        
        elif workflow == "place_id_with_audio_and_image":
            # Complete workflow: place + audio + image
            place_data = await self.places.get_place_details(request["place_id"])
            results["entity"] = self.transform_to_entity(place_data, entity_type)
            
            # Transcribe audio
            audio = request.get("audio_file") or request.get("audio_url")
            transcription = await self.openai.transcribe_audio(audio, request.get("language", "pt-BR"))
            results["transcription"] = transcription
            
            # Extract concepts from text
            text_concepts = await self.openai.extract_concepts(
                transcription["text"],
                categories=categories,
                entity_type=entity_type
            )
            results["text_concepts"] = text_concepts
            
            # Analyze image
            image = request.get("image_file") or request.get("image_url")
            image_analysis = await self.openai.analyze_image(image, entity_type)
            results["image_analysis"] = image_analysis
            
            # Combine concepts from both sources (deduplicate)
            combined_concepts = list(set(
                text_concepts["concepts"] + image_analysis["concepts"]
            ))
            
            # Create curation with combined concepts
            results["curation"] = {
                "curation_id": f"cur_{uuid.uuid4().hex[:12]}",
                "entity_id": results["entity"]["entity_id"],
                "curator_id": request.get("curator_id"),
                "transcription_id": transcription["transcription_id"],
                "concepts": combined_concepts,
                "sources": ["text_analysis", "image_analysis"],
                "entity_type": entity_type,
                "created_at": datetime.utcnow().isoformat()
            }
        
        # Add more workflows...
        
        return results
```

---

## Benefits

### Smart Defaults ✅
- Chamadas simples "just work" sem configuração
- Comportamento intuitivo: sem output = retorna resultados
- Com output = salva e não retorna (eficiente para batch)

### Flexibilidade ✅
- Preview antes de salvar
- Salvar sem retornar (batch rápido)
- Retornar sem salvar (exploração)
- Controle total de formato (full/minimal/ids_only)

### Type-Aware ✅
- Categorias específicas por tipo de entidade
- Fallback inteligente para tipos não definidos
- Contexto preservado na resposta
- Categorias e prompts armazenados no MongoDB (não hardcoded)

### Multi-Source Intelligence ✅
- Combina áudio (Whisper) + imagem (GPT-4 Vision)
- Deduplicação automática de conceitos
- Confidence scores separados por fonte
- Visual notes para debugging de análise de imagem

### Escalabilidade ✅
- Batch processing com progresso em tempo real
- Paralelização com limite de concorrência
- Output minimal para grandes volumes
- Caching por audio_hash e image_hash

---

## Implementation Status

### Core Infrastructure
- [ ] Create MongoDB collections: `categories`, `openai_configs`
- [ ] Implement `CategoryService` with caching
- [ ] Implement `OpenAIConfigService` with prompt rendering
- [ ] Update `OpenAIService` to use MongoDB configs
- [ ] Add image analysis method to `OpenAIService`

### API Endpoints
- [ ] Create CRUD for categories (`/api/v3/categories`)
- [ ] Create CRUD for OpenAI configs (`/api/v3/ai/configs`)
- [ ] Create `/api/v3/ai/orchestrate` endpoint
- [ ] Create `/api/v3/ai/orchestrate/batch` endpoint
- [ ] Add SSE for batch progress streaming

### Orchestrator
- [ ] Create `app/services/ai_orchestrator.py`
- [ ] Implement `OutputHandler` with smart defaults
- [ ] Implement workflow detection (audio/image/combined)
- [ ] Implement `place_id_with_audio` workflow
- [ ] Implement `place_id_with_image` workflow
- [ ] Implement `place_id_with_audio_and_image` workflow
- [ ] Implement `image_only` workflow
- [ ] Implement concept deduplication for multi-source

### Testing & Documentation
- [ ] Test all workflows with MongoDB-based configs
- [ ] Test image analysis with different entity types
- [ ] Test multi-source concept combination
- [ ] Document all endpoints in Swagger UI
- [ ] Create seed data for categories collection
- [ ] Create seed data for openai_configs collection
- [ ] Create `/api/v3/ai/orchestrate/batch` endpoint
- [ ] Add SSE for batch progress
- [ ] Write unit tests for defaults logic
- [ ] Test all workflows with different output configs
- [ ] Document in Swagger UI

**Ready for implementation!** 🚀
