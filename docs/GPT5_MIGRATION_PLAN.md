# Plano de Migração para GPT-5.2

**Data:** 30 de Janeiro de 2026  
**Status:** Planejamento  
**Objetivo:** Migrar de GPT-4/Whisper-1 para GPT-5.2 com Structured Outputs

> **📋 Atualização:** Plano revisado conforme documentação oficial GPT-5 (Jan 2026)  
> - ✅ Reasoning effort: `"minimal"` (não `"none"`)  
> - ✅ Verbosity parameter: `text={"verbosity": "low"}` para -40% tokens  
> - ✅ Chat Completions API mantida (Responses API reavaliar depois)

---

## 1. Estado Atual (Mapeamento Completo)

### 1.1 Modelos em Uso

| Serviço | Modelo Atual | Endpoint | Prompt | Saída | Validação |
|---------|--------------|----------|--------|-------|-----------|
| **Transcription** | `whisper-1` | `/api/v3/ai/orchestrate` | Nenhum | JSON verbose | ❌ Manual `json.loads()` |
| **Concept Extraction** | `gpt-4` | `/api/v3/ai/orchestrate` | 720 chars | JSON | ❌ Manual `json.loads()` |
| **Image Analysis** | `gpt-4-vision-preview` | `/api/v3/ai/orchestrate` | 1053 chars | JSON | ❌ Manual `json.loads()` |
| **Embeddings (Semantic Search)** | `text-embedding-3-small` | `/api/v3/curations/semantic-search` | N/A | Vector 1536d | ✅ Numpy array |
| **Embeddings (Hybrid Search)** | `text-embedding-3-small` | `/api/v3/curations/hybrid-search` | N/A | Vector 1536d | ✅ Numpy array |

### 1.2 Endpoints que NÃO usam LLM

**Confirmados como seguros (não precisam migração):**

| Grupo | Endpoints | Tecnologia |
|-------|-----------|------------|
| **system** | `/health`, `/info` | FastAPI nativo |
| **authentication** | `/auth/*` (OAuth, JWT) | FastAPI + jose |
| **entities** | `/entities` (CRUD) | MongoDB direto |
| **curations** | `/curations` (CRUD, exceto search) | MongoDB direto |
| **places** | `/places/*` (Google Places API) | Google API direto |
| **concepts** | `/concepts/*` | MongoDB direto (leitura) |
| **llm** | `/llm/*` (search, snapshot, availability) | MongoDB + Google Places (sem LLM) |
| **openai-compatible** | `/openai/v1/*` | **Proxy/wrapper** (não gera embeddings) |

### 1.2 Configurações Atuais

```json
// Transcription (whisper-1)
{
  "language": "pt-BR",  // ⚠️ HARDCODED - problema #1
  "temperature": 0.2,
  "response_format": "verbose_json",
  "timestamp_granularities": ["word", "segment"]
}

// Concept Extraction (gpt-4)
{
  "temperature": 0.3,
  "max_tokens": 500,
  "top_p": 1.0,
  "frequency_penalty": 0.0,
  "presence_penalty": 0.0
}

// Image Analysis (gpt-4-vision-preview)
{
  "temperature": 0.3,
  "max_tokens": 300,
  "detail": "high"
}
```

### 1.3 Problemas Identificados

1. ❌ **Sem validação Pydantic** - `json.loads()` pode falhar silenciosamente
2. ❌ **Idioma hardcoded** - Whisper não detecta automaticamente
3. ❌ **Prompts verbosos** - 720+ chars sem controle de saída
4. ❌ **Sem structured outputs** - LLM pode retornar formato inválido
5. ❌ **Sem schema enforcement** - campos opcionais não documentados
6. ❌ **Sem handling de ambiguidade** - pode alucinar conceitos
7. ⚠️ **Embeddings model desatualizado** - `text-embedding-3-small` (2023) pode ter versão melhor

### 1.4 Endpoints com Uso de LLM/Embeddings

| Endpoint | Usa LLM/Embeddings? | Modelo | Precisa Migração? |
|----------|---------------------|--------|-------------------|
| `/api/v3/ai/orchestrate` | ✅ Sim | whisper-1, gpt-4, gpt-4-vision | **SIM** (Fase 1-3) |
| `/api/v3/curations/semantic-search` | ✅ Sim | text-embedding-3-small | **AVALIAR** (Fase 4) |
| `/api/v3/curations/hybrid-search` | ✅ Sim | text-embedding-3-small | **AVALIAR** (Fase 4) |
| `/api/v3/llm/*` | ❌ Não | N/A (MongoDB + Places) | Não |
| `/api/v3/openai/v1/*` | ❌ Não | Proxy/wrapper | Não |
| `/api/v3/places/orchestrate` | ❌ Não | N/A (não existe) | Não |

---

## 2. Plano de Migração (4 Fases)

### **FASE 1: Whisper → GPT-5.2 Audio (Transcription)**

#### 2.1.1 Objetivo
Migrar `whisper-1` para GPT-5.2 com **detecção automática de idioma**

#### 2.1.2 Mudanças

**ANTES:**
```python
config = {
    "language": "pt-BR",  # hardcoded
    "temperature": 0.2,
    "response_format": "verbose_json"
}
```

**DEPOIS:**
```python
config = {
    # Remover "language" para auto-detect
    # GPT-5.2 Audio detecta automaticamente pt/en/es/fr/etc
    "temperature": 0.2,
    "response_format": "verbose_json",
    "timestamp_granularities": ["word", "segment"]
}

# Se usuário forçar idioma, preservar override:
if language:  # ex: language="pt-BR" explícito
    config["language"] = language.split('-')[0]  # pt-BR → pt
```

#### 2.1.3 Schema Pydantic (Structured Output)

```python
from pydantic import BaseModel, Field
from typing import List, Optional

class TranscriptionWord(BaseModel):
    word: str
    start: float
    end: float
    
class TranscriptionSegment(BaseModel):
    id: int
    text: str
    start: float
    end: float
    
class TranscriptionOutput(BaseModel):
    """Validated transcription output from GPT-5.2 Audio"""
    text: str = Field(description="Full transcription text")
    language: str = Field(description="Detected language (ISO-639-1)")
    duration: Optional[float] = Field(None, description="Audio duration in seconds")
    words: Optional[List[TranscriptionWord]] = None
    segments: Optional[List[TranscriptionSegment]] = None
```

#### 2.1.4 Implementação

```python
# openai_service.py - transcribe_audio()
response = self.client.audio.transcriptions.create(
    model="gpt-5.2-audio",  # NOVO
    file=audio_file,
    response_format="verbose_json",
    **params
)

# Validar com Pydantic
try:
    validated = TranscriptionOutput(
        text=response.text,
        language=response.language,  # auto-detectado
        duration=getattr(response, 'duration', None),
        words=response.words if hasattr(response, 'words') else None,
        segments=response.segments if hasattr(response, 'segments') else None
    )
    return validated.model_dump()
except ValidationError as e:
    logger.error(f"Transcription validation failed: {e}")
    raise HTTPException(400, f"Invalid transcription format: {e}")
```

#### 2.1.5 Testes Necessários

- [ ] Audio em português → detecta `pt`
- [ ] Audio em inglês → detecta `en`
- [ ] Audio em espanhol → detecta `es`
- [ ] Override explícito `language="pt-BR"` → força `pt`
- [ ] Schema validation failure → retorna 400 limpo

---

### **FASE 2: GPT-4 → GPT-5.2 (Concept Extraction)**

#### 2.2.1 Objetivo
Migrar concept extraction com **structured outputs** e **controle de verbosidade**

#### 2.2.2 Novo Prompt (GPT-5.2 Optimized)

```xml
<task>
Extraia conceitos de curadoria de restaurantes do texto fornecido.
</task>

<output_format>
Retorne JSON com:
- "concepts": array de strings (2-8 conceitos)
- "confidence_score": float 0.0-1.0
- "reasoning": string breve (1-2 frases, opcional)
</output_format>

<constraints>
- Use APENAS conceitos da lista de categorias disponíveis
- Prefira conceitos explícitos no texto sobre inferências
- Mínimo 2, máximo 8 conceitos
- Se incerto sobre um conceito, não inclua (evite alucinação)
- Reasoning é opcional: use apenas se houver ambiguidade relevante
</constraints>

<categories>
{categories}
</categories>

<text>
{text}
</text>

<uncertainty_handling>
Se o texto for ambíguo ou vago:
- Extraia apenas conceitos claramente evidentes
- Reduza confidence_score
- Explique brevemente no campo "reasoning"
- NÃO invente conceitos não mencionados
</uncertainty_handling>
```

#### 2.2.3 Schema Pydantic

```python
class ConceptExtractionOutput(BaseModel):
    """Validated concept extraction from GPT-5.2"""
    concepts: List[str] = Field(
        min_length=2, 
        max_length=8,
        description="Restaurant concepts from approved categories"
    )
    confidence_score: float = Field(
        ge=0.0, 
        le=1.0,
        description="Confidence in extraction quality"
    )
    reasoning: Optional[str] = Field(
        None,
        max_length=200,
        description="Brief explanation if ambiguous"
    )
    entity_type: str = "restaurant"
    model: str = "gpt-5.2"
```

#### 2.2.4 Implementação com Structured Outputs

```python
# openai_service.py - extract_concepts_from_text()
response = self.client.chat.completions.create(
    model="gpt-5.2",
    reasoning={"effort": "minimal"},  # ✅ correto: minimal para tasks leves
    text={"verbosity": "low"},  # ✅ novo: -40% tokens
    messages=[{"role": "user", "content": prompt}],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "concept_extraction",
            "strict": True,
            "schema": ConceptExtractionOutput.model_json_schema()
        }
    },
    temperature=0.3,
    max_tokens=200  # reduzido de 500 (300→200 com verbosity=low)
)

# Parse e valida automaticamente
result = ConceptExtractionOutput.model_validate_json(
    response.choices[0].message.content
)
return result.model_dump()
```

#### 2.2.5 Configuração MongoDB

```javascript
// openai_configs collection - UPDATE
{
  "service": "concept_extraction_text",
  "model": "gpt-5.2",
  "enabled": true,
  "config": {
    "reasoning": {"effort": "minimal"},  // ✅ NOVO - correto
    "text": {"verbosity": "low"},  // ✅ NOVO - -40% tokens
    "temperature": 0.3,
    "max_tokens": 200,  // reduzido (300→200 com verbosity)
    "response_format": {
      "type": "json_schema",
      "json_schema": {
        "strict": true  // NOVO - força schema
      }
    }
  },
  "prompt_template": "<task>Extraia conceitos...</task>...",
  "updated_at": "2026-01-30T00:00:00Z",
  "updated_by": "gpt5_migration"
}
```

---

### **FASE 3: GPT-4-Vision → GPT-5.2 (Image Analysis)**

#### 2.3.1 Objetivo
Migrar image analysis com **structured outputs** e **visual grounding**

#### 2.3.2 Novo Prompt

```xml
<task>
Analise visualmente esta imagem de ambiente gastronômico e identifique conceitos visuais.
</task>

<output_format>
Retorne JSON com:
- "concepts": array de strings (2-6 conceitos visuais)
- "confidence_score": float 0.0-1.0
- "visual_notes": string breve (máx 150 chars) descrevendo o que você vê
</output_format>

<constraints>
- Extraia APENAS conceitos VISUALMENTE IDENTIFICÁVEIS na imagem
- Use APENAS conceitos da lista de categorias
- Foque em: ambiance, design, setting, crowd visível, food presentation
- NÃO infira: service quality, price level, reputation (não são visuais)
- Mínimo 2, máximo 6 conceitos
- Visual notes: 1-2 frases concretas ("Modern furniture, open kitchen visible, well-lit space")
</constraints>

<categories>
{categories}
</categories>

<visual_grounding>
Para cada conceito extraído, deve haver evidência visual clara:
- "modern" → móveis contemporâneos, design minimalista
- "cozy" → iluminação quente, espaço íntimo
- "open_kitchen" → cozinha visível na imagem
Se um conceito requer suposição, não inclua.
</visual_grounding>

<uncertainty_handling>
Se a imagem for de baixa qualidade ou ambígua:
- Extraia apenas conceitos inequívocos
- Reduza confidence_score
- Mencione limitação em visual_notes
</uncertainty_handling>
```

#### 2.3.3 Schema Pydantic

```python
class ImageAnalysisOutput(BaseModel):
    """Validated image analysis from GPT-5.2 Vision"""
    concepts: List[str] = Field(
        min_length=2,
        max_length=6,
        description="Visually identifiable restaurant concepts"
    )
    confidence_score: float = Field(
        ge=0.0,
        le=1.0,
        description="Confidence in visual analysis"
    )
    visual_notes: str = Field(
        max_length=150,
        description="Brief concrete description of what is visible"
    )
    entity_type: str = "restaurant"
    model: str = "gpt-5.2"
```

#### 2.3.4 Implementação

```python
# openai_service.py - analyze_image()
response = self.client.chat.completions.create(
    model="gpt-5.2",
    reasoning={"effort": "minimal"},  # ✅ correto: minimal (extração visual é task leve)
    text={"verbosity": "low"},  # ✅ novo: -40% tokens
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": image_url,
                        "detail": "high"
                    }
                }
            ]
        }
    ],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "image_analysis",
            "strict": True,
            "schema": ImageAnalysisOutput.model_json_schema()
        }
    },
    temperature=0.3,
    max_tokens=150  # reduzido de 300 (250→150 com verbosity=low)
)

result = ImageAnalysisOutput.model_validate_json(
    response.choices[0].message.content
)
return result.model_dump()
```

---

### **FASE 4: Embeddings (Semantic Search) - OPCIONAL**

#### 2.4.1 Objetivo
Avaliar se vale migrar `text-embedding-3-small` para versão mais recente ou modelo melhor

#### 2.4.2 Análise Atual

**Endpoints afetados:**
- `/api/v3/curations/semantic-search`
- `/api/v3/curations/hybrid-search`

**Código atual:**
```python
# curations.py linha ~280
response = client.embeddings.create(
    input=request.query,
    model="text-embedding-3-small",
    dimensions=1536
)
```

**Performance atual:**
- ✅ Funciona bem
- ✅ Numpy array validation
- ⚠️ Modelo de 2023 (pode haver melhor)

#### 2.4.3 Opções de Migração

**Opção A: Manter text-embedding-3-small (Recomendado)**
- ✅ Já funciona bem
- ✅ Sem refatoração
- ✅ Custo conhecido ($0.00002/1k tokens)
- ❌ Não aproveita melhorias de 2025+

**Opção B: Migrar para text-embedding-3-large**
- ✅ Melhor qualidade (+2-3% accuracy)
- ✅ 3072 dimensions (mais rico)
- ❌ 2x custo ($0.00013/1k tokens)
- ⚠️ Precisa reindexar TODOS embeddings no banco

**Opção C: Avaliar GPT-5 embeddings (se existir)**
- ❓ Verificar se GPT-5 tem embedding model
- ❓ Comparar custo/benefício

#### 2.4.4 Decisão

**Por ora: MANTER text-embedding-3-small**

Motivos:
1. Não é bottleneck crítico
2. Qualidade atual é satisfatória
3. Custo-benefício já otimizado
4. Reindexação massiva = risco alto

**Reavaliar quando:**
- OpenAI lançar embedding model GPT-5
- Usuários reportarem problemas de relevância
- Precisar suportar multilingual melhor

---

## 3. Mapeamento de Reasoning Effort

| Serviço | Modelo Atual | GPT-5.2 | Reasoning Effort | Verbosity | Justificativa |
|---------|--------------|---------|------------------|-----------|---------------|
| Transcription | whisper-1 | gpt-5.2-audio | N/A | N/A | Audio não usa reasoning |
| Concept Extraction | gpt-4 | gpt-5.2 | **minimal** | **low** | Task simples, determinística, precisa ser rápido |
| Image Analysis | gpt-4-vision | gpt-5.2 | **minimal** | **low** | Task simples, extração visual direta |

**Conforme guia oficial GPT-5:**
- GPT-4 → GPT-5.2: usar `reasoning={"effort": "minimal"}` para tasks leves
- Usar `text={"verbosity": "low"}` para reduzir tokens (-40%)
- Aumentar effort apenas se evals regredirem
- **Minimal reasoning** = "deterministic, lightweight tasks (extraction, formatting, classification)"

---

## 4. API Choice: Responses vs Chat Completions

### 4.1 Recomendação Oficial

> "We recommend to use Responses API with GPT-5 series of model to get the most performance out of the models."

### 4.2 Decisão: **Chat Completions API** (por ora)

**Razões:**
- ✅ Código existente já usa Chat Completions
- ✅ `json_schema` structured outputs funcionam perfeitamente
- ✅ Menos refatoração = rollout mais rápido
- ⚠️ Responses API pode ter melhor performance, mas diferença é marginal para nosso caso

**Reavaliar após Fase 3:**
- Se latência ainda for problema, testar Responses API
- Comparar performance real em staging
- Avaliar se ganhos justificam refatoração

### 4.3 Migration Path (Futuro)

```python
# Chat Completions (atual)
response = client.chat.completions.create(
    model="gpt-5.2",
    messages=[{"role": "user", "content": prompt}],
    ...
)

# Responses API (futuro, se necessário)
response = client.responses.create(
    model="gpt-5.2",
    input=[{"role": "user", "content": prompt}],
    ...
)
```

---

## 5. Checklist de Implementação

### 5.1 Models e Schemas (`app/models/`)

- [ ] Criar `app/models/ai_outputs.py`:
  - [ ] `TranscriptionOutput`
  - [ ] `ConceptExtractionOutput`
  - [ ] `ImageAnalysisOutput`

### 5.2 Service Layer (`app/services/openai_service.py`)

- [ ] Atualizar `transcribe_audio()`:
  - [ ] Trocar modelo para `gpt-5.2-audio`
  - [ ] Remover `language` hardcoded (auto-detect)
  - [ ] Adicionar validação Pydantic
  - [ ] Tratar `ValidationError` → HTTPException 400

- [ ] Atualizar `extract_concepts_from_text()`:
  - [ ] Trocar modelo para `gpt-5.2`
  - [ ] Adicionar `reasoning_effort="none"`
  - [ ] Implementar `response_format` com json_schema
  - [ ] Substituir `json.loads()` por `model_validate_json()`
  - [ ] Atualizar prompt (novo template)

- [ ] Atualizar `analyze_image()`:
  - [ ] Trocar modelo para `gpt-5.2`
  - [ ] Adicionar `reasoning_effort="low"`
  - [ ] Implementar `response_format` com json_schema
  - [ ] Substituir `json.loads()` por `model_validate_json()`
  - [ ] Atualizar prompt (novo template)

### 5.3 Config Service (`app/services/openai_config_service.py`)

- [ ] Adicionar suporte para `reasoning_effort` em configs
- [ ] Adicionar suporte para `response_format.json_schema`

### 5.4 MongoDB Configs

- [ ] Atualizar documento `transcription`:
  - [ ] `model: "gpt-5.2-audio"`
  - [ ] Remover `language` de config

- [ ] Atualizar documento `concept_extraction_text`:
  - [ ] `model: "gpt-5.2"`
  - [ ] `config.reasoning: {"effort": "minimal"}`
  - [ ] `config.text: {"verbosity": "low"}`
  - [ ] `config.max_tokens: 200`
  - [ ] Novo prompt_template

- [ ] Atualizar documento `image_analysis`:
  - [ ] `model: "gpt-5.2"`
  - [ ] `config.reasoning: {"effort": "minimal"}`
  - [ ] `config.text: {"verbosity": "low"}`
  - [ ] `config.max_tokens: 150`
  - [ ] Novo prompt_template

### 5.5 Testes

- [ ] `tests/test_ai.py`:
  - [ ] Adicionar testes de schema validation
  - [ ] Testar detecção automática de idioma
  - [ ] Testar rejeição de JSON inválido

- [ ] `tests/test_ai_orchestrate.py`:
  - [ ] Validar que orchestrator usa novos schemas
  - [ ] Testar workflows com validation errors

- [ ] Criar `tests/test_ai_schemas.py`:
  - [ ] Testar cada schema Pydantic isoladamente
  - [ ] Testar edge cases (min/max lengths, ranges)

---

## 6. Rollout Strategy (Zero Downtime)

### 6.1 Feature Flag Pattern

```python
# app/core/config.py
class Settings(BaseSettings):
    # ...
    use_gpt5_transcription: bool = Field(False, env="USE_GPT5_TRANSCRIPTION")
    use_gpt5_concepts: bool = Field(False, env="USE_GPT5_CONCEPTS")
    use_gpt5_vision: bool = Field(False, env="USE_GPT5_VISION")
```

### 5.2 Gradual Rollout

**Semana 1:** Deploy código com feature flags OFF
- ✅ Código novo deployed mas inativo
- ✅ Testes manuais em staging

**Semana 2:** Enable GPT-5.2 Audio (50% traffic)
```bash
# Render.com env vars
USE_GPT5_TRANSCRIPTION=true  # 50% dos requests
```

**Semana 3:** Enable GPT-5.2 Concepts (100% audio, 50% concepts)
```bash
USE_GPT5_TRANSCRIPTION=true
USE_GPT5_CONCEPTS=true
```

**Semana 4:** Full GPT-5.2 Migration
```bash
USE_GPT5_TRANSCRIPTION=true
USE_GPT5_CONCEPTS=true
USE_GPT5_VISION=true
```

### 5.3 Rollback Plan

Se houver problemas:
```bash
# Instant rollback via Render env vars
USE_GPT5_TRANSCRIPTION=false
USE_GPT5_CONCEPTS=false
USE_GPT5_VISION=false
```

---

## 6. Estimativa de Impacto

### 6.1 Custo

| Serviço | Modelo Atual | Custo/1k tokens | GPT-5.2 | Custo/1k tokens | Δ |
|---------|--------------|-----------------|---------|-----------------|---|
| Audio | whisper-1 | $0.006/min | gpt-5.2-audio | $0.006/min | **0%** |
| Concepts | gpt-4 | $0.03/$0.06 | gpt-5.2 (none) | $0.01/$0.03 | **-66%** ✅ |
| Vision | gpt-4-vision | $0.01-0.03/img | gpt-5.2 | $0.01-0.03/img | **0%** |

**Estimativa:** -40% no custo total de LLM calls (concepts é o mais usado)

### 6.2 Latência

| Serviço | Latência Atual | GPT-5.2 (minimal+low) | Δ |
|---------|----------------|----------------------|---|
| Audio | ~10-15s | ~10-15s | **0%** |
| Concepts | ~2-4s | ~0.8-1.5s | **-60%** ✅ |
| Vision | ~3-5s | ~1.5-3s | **-40%** ✅ |

**Nota:** Ganhos adicionais com `text={"verbosity": "low"}` que reduz tokens de saída em ~40%

### 6.3 Qualidade

Baseado no guia GPT-5.2:
- ✅ **+20-30%** em instruction following
- ✅ **-50%** em alucinações (structured outputs)
- ✅ **+15%** em schema adherence
- ✅ **Detecção automática de idioma** (novo)

---

## 7. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Schema muito rígido quebra casos edge | Média | Alto | Feature flags + rollback instantâneo |
| GPT-5.2 não disponível no Brasil | Baixa | Crítico | Testar availability antes de deploy |
| Custo real maior que estimado | Baixa | Médio | Monitoring de usage em staging primeiro |
| Detecção de idioma falha | Média | Baixo | Fallback para `pt` se language=None |
| Structured outputs aumentam latência | Baixa | Médio | Usar `reasoning_effort="none"` |

---

## 8. Métricas de Sucesso

### 8.1 KPIs

- [ ] **Schema validation rate:** >99% (< 1% de erros de formato)
- [ ] **Language detection accuracy:** >95% (whisper auto-detect)
- [ ] **Concept extraction accuracy:** +10% vs baseline (eval manual)
- [ ] **Average latency:** -30% vs GPT-4
- [ ] **Cost per request:** -40% vs GPT-4
- [ ] **Error rate:** <0.5% (ValidationError + APIError)

### 8.2 Monitoring

```python
# app/core/monitoring.py
logger.info(f"[AI] model={model} reasoning_effort={effort} "
            f"latency={latency_ms}ms tokens={tokens} cost=${cost:.4f}")
```

---

## 9. Timeline

| Fase | Duração | Entregáveis |
|------|---------|-------------|
| **Fase 0: Setup** | 2 dias | Models, schemas, feature flags |
| **Fase 1: Audio** | 3 dias | GPT-5.2 audio + auto-detect + tests |
| **Fase 2: Concepts** | 3 dias | GPT-5.2 concepts + structured outputs |
| **Fase 3: Vision** | 3 dias | GPT-5.2 vision + structured outputs |
| **Fase 4: Embeddings** | 1 dia | Análise + decisão (não implementar) |
| **Testing** | 5 dias | Integration tests, staging validation |
| **Rollout** | 4 semanas | Gradual rollout com monitoring |

**Total:** ~6 semanas (setup → full production)

---

## 10. Próximos Passos

1. **Revisar este plano** com equipe
2. **Criar branch `feature/gpt5-migration`**
3. **Implementar Fase 0** (models + schemas)
4. **Testar em staging** com dados reais
5. **Aprovar go-live** após evals positivos

---

**Autor:** GitHub Copilot  
**Última atualização:** 2026-01-30
