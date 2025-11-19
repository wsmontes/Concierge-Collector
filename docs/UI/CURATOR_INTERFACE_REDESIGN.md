# Curator Interface Redesign - Concierge Collector V3

**Data:** 18 de Novembro, 2025  
**Tipo:** Análise de Interface e Proposta de Redesign  
**Objetivo:** Simplificar e otimizar o fluxo de trabalho do curador

---

## 🎯 Executive Summary

### Problema Identificado
A interface atual mistura conceitos de **Entity** (dados objetivos) com **Curation** (opinião do curador), não tem UI para gerenciar curadorias, e não reflete o modelo de dados real do backend V3.

### Solução Proposta
Redesign completo com separação clara:
- **Entities List**: Vista principal mostrando status de curadoria (✅/❌/⚠️)
- **Curation Editor**: Ferramenta dedicada para curador adicionar sua opinião
- **Entity Detail**: Visualização de dados objetivos + todas as curadorias
- **Sistema de Categorias Dinâmicas**: UI adapta-se às categorias vindas do MongoDB

### Arquitetura Core
```
Entity (Objetivo)         Curation (Subjetivo)
├─ Nome, localização      ├─ Transcrição/áudio
├─ Fotos, contato         ├─ Notas públicas/privadas  
├─ Conceitos extraídos    ├─ Conceitos do curador
└─ Metadata (sources)     └─ Categories (opinião)

Categories (MongoDB)
├─ entity_type: "restaurant" → ["Cuisine", "Menu", "Mood", ...]
├─ entity_type: "bar" → ["Drinks", "Music", "Crowd", ...]
└─ Dinâmico, configurável por admin
```

### Principais Mudanças
1. **Navegação**: De "hide/show sections" para navegação persistente com contexto
2. **Recording**: De "tela separada" para feature dentro do Curation Editor
3. **Concepts Section**: Renomeada/dividida em Entity Editor + Curation Editor
4. **Categorias**: De hardcoded para dinâmicas (vêm do MongoDB)
5. **Multi-Curator**: UI mostra múltiplas curations por entity

---

---

## 🔍 Entendimento Correto do Sistema

### Modelo de Dados (Como Realmente Funciona)

#### **1. Categories Collection (MongoDB)**

```json
// db.categories - Define quais categorias existem por tipo de entidade
{
  "entity_type": "restaurant",
  "active": true,
  "categories": [
    "Cuisine",
    "Menu", 
    "Price Range",
    "Mood",
    "Setting",
    "Crowd",
    "Suitable For",
    "Food Style",
    "Drinks",
    "Special Features"
  ],
  "updated_at": "2025-11-18T10:00:00Z",
  "updated_by": "admin",
  "version": 1
}

// Outro exemplo - Bar terá categorias diferentes
{
  "entity_type": "bar",
  "active": true,
  "categories": [
    "Drinks",
    "Mood",
    "Setting", 
    "Music",
    "Crowd",
    "Special Features"
  ]
}
```

**Características:**
- Categorias são **dinâmicas** e **configuráveis**
- Cada `entity_type` tem seu próprio conjunto
- Admin pode atualizar via `CategoryService.update_categories()`
- Fallback: Se tipo não existe, usa categorias de "restaurant"
- **Cache**: 1 hora TTL no CategoryService

#### **2. Entity (MongoDB)**

```json
{
  "_id": "674abcd123...",
  "entity_id": "rest_mani_sp",
  "type": "restaurant",
  "name": "Maní",
  "status": "active",
  "externalId": "ChIJN1t_tDeuEmsRUsoyG83frY4",  // Google Place ID
  
  // Dados objetivos da entidade
  "data": {
    "location": {
      "lat": -23.5505,
      "lng": -46.6333,
      "address": "Rua Joaquim Antunes, 210"
    },
    "contacts": {
      "phone": "+55 11 3085-4148",
      "website": "https://manirestaurante.com"
    },
    "media": {
      "photos": ["https://...", "https://..."]
    }
  },
  
  // Conceitos podem vir de múltiplas fontes
  "metadata": [
    {
      "type": "google_places",
      "source": "ChIJN1t_tDeuEmsRUsoyG83frY4",
      "importedAt": "2025-11-18T10:00:00Z",
      "data": {
        "rating": 4.5,
        "user_ratings_total": 1250,
        "price_level": 3
      }
    },
    {
      "type": "ai_extraction",
      "source": "openai_gpt4",
      "importedAt": "2025-11-18T10:05:00Z",
      "data": {
        "Cuisine": ["Italian", "Contemporary"],
        "Menu": ["Fresh Pasta", "Risotto", "Seafood"],
        "Price Range": ["Expensive"],
        "Setting": ["Modern", "Sophisticated"]
      }
    }
  ],
  
  "createdAt": "2025-11-18T10:00:00Z",
  "updatedAt": "2025-11-18T10:05:00Z",
  "createdBy": "curator_joao",
  "version": 1
}
```

**Características:**
- Entity é **compartilhada** por todos
- Conceitos em `metadata` são **objetivos** (não opinião)
- Múltiplas fontes: Google Places, AI analysis, manual import
- **Não tem** campo `concepts` direto - conceitos estão em `metadata[].data`

#### **3. Curation (MongoDB)**

```json
{
  "_id": "674xyz987...",
  "curation_id": "cur_joao_mani_001",
  "entity_id": "rest_mani_sp",
  
  // Quem curou
  "curator": {
    "id": "curator_joao",
    "name": "João Silva",
    "email": "joao@example.com"
  },
  
  // Opinião pessoal
  "notes": {
    "public": "Best pasta in São Paulo! Must try the pumpkin ravioli.",
    "private": "Went with Maria, sat at table 12. Waiter Paulo was excellent."
  },
  
  // Conceitos DA OPINIÃO do curador
  "categories": {
    "Cuisine": ["Italian", "Homestyle"],
    "Menu": ["Pumpkin Ravioli", "Sage Butter", "Fresh Pasta"],
    "Mood": ["Romantic", "Cozy"],
    "Setting": ["Intimate", "Modern"],
    "Price Range": ["Expensive"],
    "Suitable For": ["Dating", "Celebrations"]
  },
  
  "sources": ["personal_visit", "audio_recording"],
  
  "createdAt": "2025-11-18T11:00:00Z",
  "updatedAt": "2025-11-18T11:00:00Z",
  "version": 1
}
```

**Características:**
- Curation é **pessoal** (um curador)
- `categories` usa **mesma estrutura** que entity, mas valores são opinião
- Uma entity pode ter **N curations** (uma por curador)
- Curador só edita **suas próprias** curations

### Fluxo de Extração de Conceitos (AI)

**Quando o curador grava áudio:**

```
1. Curador grava: "Visitei o Maní ontem..."
2. Whisper transcreve → texto
3. GPT-4 extrai conceitos:
   - Input: texto + categories (do MongoDB)
   - Prompt: "Extract concepts organized by: Cuisine, Menu, Mood..."
   - Output: JSON com conceitos por categoria
4. Frontend popula form de curation com conceitos extraídos
5. Curador pode editar/adicionar conceitos manualmente
6. Salva como curation.categories
```

**Código relevante:**

```python
# concierge-api-v3/app/services/openai_service.py
async def extract_concepts_from_text(text: str, entity_type: str = "restaurant"):
    # 1. Busca categorias do MongoDB
    categories = await self.category_service.get_categories(entity_type)
    
    # 2. Monta prompt com categorias dinâmicas
    prompt = await self.config_service.render_prompt(
        "concept_extraction_text",
        {"text": text, "categories": categories}
    )
    
    # 3. Chama GPT-4
    response = self.client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"}
    )
    
    # 4. Retorna JSON: {"Cuisine": [...], "Menu": [...], ...}
    return json.loads(response.choices[0].message.content)
```

### Conceitos Autorais (Como Adicionar)

**Curador PODE:**
- ✅ Adicionar conceito novo **dentro de categoria existente**
- Exemplo: Categoria "Menu" existe → adicionar "Pão de queijo artesanal"
- Frontend: Botão "+ Add" dentro de cada categoria

**Curador NÃO PODE:**
- ❌ Criar categoria nova (ex: "Parking", "Wi-Fi Speed")
- Isso requer permissão de admin
- Admin usa: `CategoryService.update_categories(entity_type, new_categories)`

**Implicação para UI:**
- Form deve iterar sobre `categories` vindo do backend
- Cada categoria = seção com chips/tags editáveis
- **Não** hardcode categorias no frontend
- Se backend retorna 5 categorias, form tem 5 seções
- Se backend retorna 10 categorias, form tem 10 seções

---

## 📊 Análise da Interface Atual

### Seções Existentes

Atualmente a aplicação tem **7 seções principais**:

1. **`curator-section`** - Identificação e gestão do curador
2. **`quick-actions-section`** - Importação rápida de entidades
3. **`recording-section`** - Gravação de áudio
4. **`transcription-section`** - Visualização de transcrição
5. **`concepts-section`** - Extração e edição de conceitos (formulário de entidade)
6. **`entities-section`** - Lista de entidades (restaurantes)
7. **`export-import-section`** - Exportação/importação de dados

### Problemas Identificados

#### 1. **Navegação Não-Linear e Confusa**
- **Problema**: Seções aparecem/desaparecem dinamicamente via `hideAllSections()` + `show[X]Section()`
- **Impacto**: Curador não sabe onde está no fluxo, não consegue voltar facilmente
- **Evidência**: Cada `show` chama `hideAllSections()` primeiro, criando navegação "tela cheia" sem contexto

#### 2. **Fluxo de Gravação Desconectado do Objetivo Final**
- **Problema**: Recording → Transcription → Concepts são 3 telas separadas
- **Impacto**: Curador perde contexto, parece que são 3 tarefas diferentes
- **Objetivo Real**: Curador quer **criar uma curadoria sobre uma entidade**

#### 3. **"Concepts Section" É Na Verdade Um Formulário de Entidade**
- **Problema**: Nome "concepts" não reflete que é a tela de criação/edição de entidade
- **Confusão**: Mistura conceitos (cuisines, ambiance) com dados da entidade (nome, localização, fotos)
- **Evidência**: Contém campos: restaurant-name, location, photos, transcription, description, concepts-container

#### 4. **Falta Gestão de Curadorias**
- **Problema**: Não existe UI para criar/visualizar/editar curadorias
- **Situação Atual**: Backend tem schema de curations, mas frontend não tem interface
- **Gap**: Curador não consegue associar sua opinião pessoal a uma entidade

#### 5. **Entities Section Sem Contexto de Curadoria**
- **Problema**: Lista apenas entidades (restaurantes), sem mostrar curadorias associadas
- **Falta**: Indicador de quais entidades já têm curadoria do curador atual
- **Falta**: Preview da curadoria ao ver entidade

#### 6. **Duplicate Recording Controls**
- **Evidência**: Console mostra "Found 2 recording control sections"
- **Problema**: HTML tem controles duplicados causando confusão

---

## 🎯 Proposta de Redesign: Visão do Curador

### Conceito Central

> **"Um curador cria curadorias sobre entidades existentes"**

**Não é:** Gravar áudio → Transcrever → Extrair conceitos → Salvar entidade  
**É:** Ver entidades → Selecionar entidade → Criar/editar minha curadoria

### Fluxo Simplificado

```
┌─────────────────────────────────────────────────────────────┐
│                    CURATOR DASHBOARD                         │
├─────────────────────────────────────────────────────────────┤
│  👤 João Silva (Curator)                    [Sync] [Settings]│
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    ENTITIES LIST VIEW                        │
├───────────┬───────────┬───────────┬───────────┬─────────────┤
│ 🍽️ Entity │ 📍 City   │ ⭐ My    │ 📅 Updated│ Actions     │
│           │           │  Curation │           │             │
├───────────┼───────────┼───────────┼───────────┼─────────────┤
│ Maní      │ São Paulo │ ✅ Yes    │ 2 days ago│ [Edit] [👁️]│
│ D.O.M.    │ São Paulo │ ✅ Yes    │ 1 week ago│ [Edit] [👁️]│
│ Evvai     │ São Paulo │ ⚠️ Draft  │ Just now  │ [Edit] [👁️]│
│ Fasano    │ São Paulo │ ❌ No     │ -         │ [+Curate]   │
└───────────┴───────────┴───────────┴───────────┴─────────────┘

[+ Quick Import]  [+ Manual Add Entity]
```

### Nova Arquitetura de Telas

#### **1. My Curations (Home - Reformulada)**
- **Propósito**: Visão do trabalho do curador (não todas as entities!)
- **Conteúdo**:
  - **My Curations Tab**: Entities com minha curation
    - ✅ Published (X entities)
    - ⚠️ Drafts (Y entities)
  - **Recently Viewed Tab**: Entities que vi nos últimos 7 dias
  - **Favorites Tab**: Entities que marquei para curar depois
  - Quick stats: X curations, Y drafts, Z recent views
  - CTA principal: "🔍 Search New Places"

#### **2. Places Search (Nova - Principal)**
- **Propósito**: Buscar entities via Google Places (auto-save)
- **Conteúdo**:
  - Search bar: "Search restaurants, bars, cafes..."
  - Filtros: Type (restaurant/bar/cafe), Distance
  - **Botão "📍 Nearby"**: Sort by proximity
  - Results grid/list (20-50 items)
  - **Auto-save**: Todos results salvos no MongoDB (background)
  - Cada result card:
    - Nome, tipo, endereço
    - Badge: "✅ You curated" ou "❌ Not curated"
    - Badges: "🌟 3 other curations"
    - Actions: [View Details] [Quick Curate]

#### **3. Entity Detail View (Nova)**
- **Propósito**: Ver dados completos de uma entity + all curations
- **Conteúdo**:
  - **Entity Info Section** (objective data):
    - Nome, tipo, localização, fotos
    - Google Places rating, price level
    - Conceitos extraídos (metadata sources)
  - **All Curations Section** (subjective opinions):
    - Lista de curations (todos os curadores)
    - Destacar "Your curation" se existir
    - Preview: Curator name, excerpt, rating
  - **Actions**:
    - Se não tem minha curation: "➕ Create My Curation" (CTA grande)
    - Se tem minha curation: "✏️ Edit My Curation"
    - "⭐ Add to Favorites"

#### **4. Curation Editor (Nova - Core Feature)**
- **Propósito**: Criar/editar curadoria (foco em recording!)
- **Conteúdo**:
  - **Entity Context**: Card compacto no topo
  - **🔴 Recording Section** (destaque máximo - 90% uso):
    - CTA grande: "🔴 Start Recording Your Review"
    - Timer visual, waveform animation
    - Auto-transcribe → Auto-extract concepts
  - **📄 Transcription**: Editável (10% digitam direto)
  - **🏷️ Extracted Concepts**: Por categoria (dinâmico do MongoDB)
  - **📝 Notes**: Public/Private
  - **📅 Metadata**: Visit date, source
  - **Actions**: [Discard] [Save Draft] [Publish]

#### **5. Settings (Reformulada)**
- **Propósito**: Configurar perfil, sync, preferências
- **Conteúdo**:
  - Curator profile
  - Sync settings
  - API keys (OpenAI, Google Places)
  - Default entity type filter
  - Auto-save preferences

---

## 🔄 Mapeamento: Atual → Nova Arquitetura

### O Que Fazer Com Cada Seção Atual

| Seção Atual | Status | Nova Localização | Motivo |
|-------------|--------|------------------|---------|
| `curator-section` | ✅ Manter | Top bar (sempre visível) | Identidade do curador sempre visível |
| `quick-actions-section` | 🔄 Transformar | Places Search (botão Nearby) | Quick Import vira feature de search |
| `recording-section` | 🔄 Promover | Curation Editor (CTA principal) | Recording é 90% do uso - merece destaque |
| `transcription-section` | ❌ Remover | Integrar no Curation Editor | Não precisa ser tela separada |
| `concepts-section` | 🔄 Dividir | Curation Editor (concepts form) | É o formulário de curation, não de entity |
| `entities-section` | 🔄 Reformular | My Curations + Recently Viewed | Lista deve ser "working set", não todas as entities |
| `export-import-section` | 🔄 Mover | Settings menu | Operação administrativa, não frequente |

### Novas Seções Necessárias

| Nova Seção | Propósito | Prioridade |
|------------|-----------|------------|
| **Places Search** | Buscar entities via Google Places | 🔴 CRÍTICA |
| **Entity Detail** | Ver dados + all curations | 🔴 CRÍTICA |
| **My Curations Dashboard** | Vista do trabalho do curador | 🟡 ALTA |
| **Recently Viewed Tab** | Entities exploradas recentemente | 🟢 MÉDIA |
| **Favorites Tab** | Entities marcadas para curar | 🟢 MÉDIA |

### Features a Remover

| Feature Atual | Motivo | Substituir Por |
|---------------|--------|----------------|
| "Add Entity Manually" | Entity deve vir de fonte (Google/Michelin) | Places Search |
| "Quick Import 20 Nearby" | Implementação não ideal como feature separada | Botão "Nearby" na Places Search |
| Transcription como tela | Fluxo quebrado, deve ser parte do editor | Seção dentro do Curation Editor |
| Export/Import destaque | Pouco usado, polui interface | Mover para Settings |

### Mudanças de Comportamento

| Comportamento Atual | Novo Comportamento | Impacto |
|---------------------|-------------------|---------|
| Entities section mostra todas | Mostra apenas working set do curador | Reduz noise, foco no relevante |
| Recording é tela opcional | Recording é CTA principal (90% uso) | Prioriza fluxo mais comum |
| Concepts extraction manual | Auto após recording/transcription | Menos fricção, mais AI-driven |
| Entity list = MongoDB entities | Entity list = My curations + Recent | Performance, UX mais limpa |
| Search Google Places separado | Search integrado (auto-save entities) | Unifica discovery + saving |

### Separação: Dados da Entidade vs. Curadoria

#### **Dados da Entidade (Objetivos e Compartilhados)**
- **Identificação**: Nome, tipo (restaurant/bar/hotel/cafe), status
- **Localização**: Lat/lng, endereço completo
- **Contato**: Telefone, website, redes sociais
- **Mídia**: Fotos (do estabelecimento, não da curation)
- **Dados externos**: Google Place ID, Michelin stars, etc.
- **Conceitos extraídos**: Resultado de análises (GPT-4, Google Places)
  - Organizados em categorias (Cuisine, Menu, Mood, Setting, etc.)
  - Podem vir de múltiplas fontes (metadata array)
  - Não são "opinião" - são características detectadas

**Onde**: 
- **Entity Detail View** (leitura para todos)
- **Entity Editor** (edição - admin/manager apenas)

#### **Dados da Curadoria (Subjetivos e Pessoais)**
- **Áudio**: Recording opcional do curador
- **Transcrição**: Do áudio ou digitada manualmente
- **Notas**: Públicas (para compartilhar) e privadas (pessoais)
- **Conceitos do curador**: Categorias preenchidas pela opinião do curador
  - Usa mesma estrutura de categorias da entity
  - Mas reflete **opinião pessoal** vs dados objetivos
  - Exemplo: Entity diz "Italian", curador adiciona "Homemade pasta"
- **Sources**: De onde veio a informação (personal_visit, audio_review, etc.)
- **Metadata**: Data da visita, contexto, etc.

**Onde**: 
- **Curation Editor** (criação/edição pelo curador dono)
- **Entity Detail View** (leitura por todos - veem todas as curations)

---

## 🎨 Wireframes da Nova Interface

### Tela 1: My Curations (Home)

```
┌────────────────────────────────────────────────────────────┐
│ 🏠 Concierge Collector              👤 João [Sync] [⚙️]   │
├────────────────────────────────────────────────────────────┤
│                                                             │
│ 📊 My Work                                                  │
│ ┌──────────┬──────────┬──────────┬──────────┐            │
│ │ 45       │ 3        │ 12       │ 5        │            │
│ │ Curations│ Drafts   │ Recent   │ Favorites│            │
│ └──────────┴──────────┴──────────┴──────────┘            │
│                                                             │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ 🔍 Search New Places                                 │   │
│ │ Find restaurants, bars, cafes to curate...           │   │
│ │ [Search] [📍 Nearby] [🌟 Michelin] [📋 Lists]       │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                             │
│ ┌─ Tabs ─────────────────────────────────────────────┐   │
│ │ [•My Curations] [Recently Viewed] [Favorites]      │   │
│ └────────────────────────────────────────────────────┘   │
│                                                             │
│ �️ Filter: [All] [Published] [Drafts] | Sort: [Recent ▼] │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┤
│ │ 🍽️ Maní                              São Paulo          │
│ │ Italian • Contemporary                                   │
│ │ ✅ Published 2 days ago                                 │
│ │ "Amazing pasta, must try the ravioli..."                │
│ │ [👁️ View] [✏️ Edit Curation]                           │
│ ├─────────────────────────────────────────────────────────┤
│ │ 🍝 D.O.M.                              São Paulo        │
│ │ Brazilian • Contemporary                                 │
│ │ ✅ Published 1 week ago                                 │
│ │ "Incredible Brazilian ingredients..."                   │
│ │ [👁️ View] [✏️ Edit Curation]                           │
│ ├─────────────────────────────────────────────────────────┤
│ │ 🥘 Evvai                               São Paulo        │
│ │ Brazilian • Contemporary                                 │
│ │ ⚠️ Draft saved 1 hour ago                               │
│ │ [👁️ View] [✏️ Finish Curation]                         │
│ └─────────────────────────────────────────────────────────┘
│                                                             │
│ 💡 Tip: Search for new places to discover and curate!      │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

#### **Tela 1b: Places Search (Modal/Full Screen)**

```
┌────────────────────────────────────────────────────────────┐
│ ← Back                      🔍 Search Places               │
├────────────────────────────────────────────────────────────┤
│                                                             │
│ Search: [Maní São Paulo_________________] [Search]         │
│                                                             │
│ Filters: Type: [Restaurant ▼] Distance: [5km ▼]           │
│          [📍 Nearby Me] [Clear Filters]                    │
│                                                             │
│ 💾 Auto-saving all results to your database...             │
│                                                             │
│ Found 23 results:                                          │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┤
│ │ 🍽️ Maní ⭐4.5 (1,250 reviews)                          │
│ │ 📍 Rua Joaquim Antunes, 210 - 0.8km away               │
│ │ Italian • Contemporary • $$$                            │
│ │ ✅ You curated this | 🌟 2 other curations             │
│ │ [👁️ View Details] [✏️ Edit My Curation]               │
│ ├─────────────────────────────────────────────────────────┤
│ │ 🍷 Rinconcito Peruano ⭐4.7 (890 reviews)              │
│ │ 📍 Rua Haddock Lobo, 1212 - 1.2km away                 │
│ │ Peruvian • Casual • $$                                  │
│ │ ❌ Not curated yet                                      │
│ │ [👁️ View Details] [➕ Create Curation]                 │
│ ├─────────────────────────────────────────────────────────┤
│ │ 🍝 Fasano ⭐4.6 (2,100 reviews)                        │
│ │ 📍 Rua Vittorio Fasano, 88 - 1.5km away                │
│ │ Italian • Fine Dining • $$$$                            │
│ │ 🌟 5 curations from other curators                      │
│ │ [👁️ View Details] [➕ Create Curation]                 │
│ └─────────────────────────────────────────────────────────┘
│                                                             │
│ [Load More Results...]                                     │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

### Tela 2: Entity Detail View

```
┌────────────────────────────────────────────────────────────┐
│ ← Back to Search                   👤 João [Sync] [⚙️]     │
├────────────────────────────────────────────────────────────┤
│                                                             │
│ 🍽️ Maní                                                    │
│ Italian • Contemporary • $$$                                │
│ ⭐ 4.5 (1,250 reviews) | 📍 0.8km away                     │
│                                                             │
│ ┌─ Entity Information (Objective Data) ──────────────┐    │
│ │                                                      │    │
│ │ 📍 Location                                          │    │
│ │ Rua Joaquim Antunes, 210 - Jardim Paulistano        │    │
│ │ São Paulo, SP 05415-000                              │    │
│ │ [📍 Show on Map]                                     │    │
│ │                                                      │    │
│ │ 📞 Contact                                           │    │
│ │ Phone: +55 11 3085-4148                              │    │
│ │ Website: manirestaurante.com                         │    │
│ │                                                      │    │
│ │ 🏷️ Extracted Concepts (from Google Places + AI)    │    │
│ │ Cuisine: Italian, Contemporary, Mediterranean        │    │
│ │ Menu: Pasta, Seafood, Italian Wine                   │    │
│ │ Setting: Modern, Sophisticated, Intimate             │    │
│ │ Price Range: Expensive                               │    │
│ │                                                      │    │
│ │ 📷 Photos (12)                                       │    │
│ │ [🖼️] [🖼️] [🖼️] [🖼️] [View All]                    │    │
│ │                                                      │    │
│ │ 📊 Metadata                                          │    │
│ │ Source: Google Places (ChIJ...)                      │    │
│ │ Added: 2025-11-15 via search                         │    │
│ │ Last Updated: 2025-11-18                             │    │
│ └──────────────────────────────────────────────────────┘    │
│                                                             │
│ ═══════════════════════════════════════════════════════════│
│                                                             │
│ ┌─ Curations (3) - Subjective Opinions ──────────────┐    │
│ │                                                      │    │
│ │ ✅ YOUR CURATION                                     │    │
│ │ ┌────────────────────────────────────────────────┐  │    │
│ │ │ 👤 João Silva | Published 2 days ago          │  │    │
│ │ │                                                │  │    │
│ │ │ "Amazing pasta! The pumpkin ravioli with sage │  │    │
│ │ │  butter is absolutely incredible. Cozy        │  │    │
│ │ │  atmosphere, perfect for a romantic dinner."  │  │    │
│ │ │                                                │  │    │
│ │ │ Concepts: Fresh Pasta, Pumpkin Ravioli,       │  │    │
│ │ │           Romantic, Cozy                      │  │    │
│ │ │                                                │  │    │
│ │ │ [✏️ Edit My Curation]                         │  │    │
│ │ └────────────────────────────────────────────────┘  │    │
│ │                                                      │    │
│ │ 🌟 OTHER CURATIONS (2)                               │    │
│ │ ┌────────────────────────────────────────────────┐  │    │
│ │ │ 👤 Maria Santos | Published 1 week ago        │  │    │
│ │ │ "Excellent Italian cuisine with Brazilian     │  │    │
│ │ │  touches. Service is impeccable..."           │  │    │
│ │ │ [👁️ View Full Curation]                       │  │    │
│ │ └────────────────────────────────────────────────┘  │    │
│ │ ┌────────────────────────────────────────────────┐  │    │
│ │ │ 👤 Pedro Lima | Published 2 weeks ago         │  │    │
│ │ │ "One of the best restaurants in São Paulo..." │  │    │
│ │ │ [👁️ View Full Curation]                       │  │    │
│ │ └────────────────────────────────────────────────┘  │    │
│ └──────────────────────────────────────────────────────┘    │
│                                                             │
│ [⭐ Add to Favorites]                                       │
│                                                             │
└────────────────────────────────────────────────────────────┘

// Se não tem curation, mostrar:
│ ┌─ Curations (2) ──────────────────────────────────────┐  │
│ │ ❌ You haven't curated this entity yet               │  │
│ │                                                        │  │
│ │ [➕ CREATE MY CURATION] ← CTA grande                  │  │
│ │                                                        │  │
│ │ 🌟 OTHER CURATIONS (2)                                │  │
│ │ ... (mostra curations de outros)                      │  │
│ └────────────────────────────────────────────────────────┘  │
```

### Tela 3: Curation Editor (Core - Foco em Recording!)

```
┌────────────────────────────────────────────────────────────┐
│ ← Back                                 👤 João [Sync] [⚙️] │
├────────────────────────────────────────────────────────────┤
│                                                             │
│ 🎯 Curating: Maní                                          │
│ ┌─────────────────────────────────────┐                   │
│ │ 🍽️ Maní                             │                   │
│ │ 📍 Rua Joaquim Antunes, São Paulo   │                   │
│ │ 🏷️ Italian • Contemporary • $$$    │                   │
│ │ [View Full Details →]               │                   │
│ └─────────────────────────────────────┘                   │
│                                                             │
│ ═══════════════════════════════════════════════════════════│
│                                                             │
│ 📝 Your Curation                                           │
│                                                             │
│ ┌─ 🎙️ RECORD YOUR REVIEW (Primary Method - 90%) ─────┐   │
│ │                                                       │   │
│ │           ⭕ 🔴 ⭕                                    │   │
│ │        ╱            ╲                                │   │
│ │      ╱   00:00       ╲    ← Circular progress       │   │
│ │     │     /05:00      │                             │   │
│ │      ╲              ╱                                │   │
│ │        ╲          ╱                                  │   │
│ │           ⭕ ⭕ ⭕                                     │   │
│ │                                                       │   │
│ │      [🔴 START RECORDING] ← CTA GRANDE               │   │
│ │                                                       │   │
│ │ 💡 Just tap and talk about your experience!          │   │
│ │    We'll transcribe and extract concepts for you.    │   │
│ │                                                       │   │
│ │ 🎵 ▁▂▃▅▇ Recording... [⏹️ Stop]                      │   │
│ │                                                       │   │
│ │ ✅ Recorded! [▶️ Play] [🗑️ Delete] [🔄 Re-record]    │   │
│ └───────────────────────────────────────────────────────┘   │
│                                                             │
│ ┌─ 📄 Transcription (Auto or Manual) ──────────────────┐   │
│ │ Status: [⏳ Transcribing...] OR [✅ Ready]            │   │
│ │                                                        │   │
│ │ ┌─────────────────────────────────────────────────┐  │   │
│ │ │ "Visitei o Maní ontem à noite e a experiência  │  │   │
│ │ │  foi incrível. A massa fresca é o grande       │  │   │
│ │ │  destaque, especialmente o ravioli de abóbora  │  │   │
│ │ │  com sálvia. O molho de manteiga estava        │  │   │
│ │ │  perfeito. O ambiente é sofisticado mas        │  │   │
│ │ │  acolhedor ao mesmo tempo, ótimo para um       │  │   │
│ │ │  jantar romântico. O serviço foi impecável."   │  │   │
│ │ └─────────────────────────────────────────────────┘  │   │
│ │                                                        │   │
│ │ [🤖 Extract Concepts] ← Se editou manualmente         │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                             │
│ ┌─ 🏷️ Concepts (Extracted from transcription) ─────────┐  │
│ │ ⏳ Extracting concepts...  OR  ✅ Ready to review     │  │
│ │                                                        │  │
│ │ These categories come from MongoDB. You can edit!     │  │
│ │                                                        │  │
│ │ Cuisine:                                              │  │
│ │ [Italian] [Contemporary] [+ Add]                      │  │
│ │                                                        │  │
│ │ Menu:                                                 │  │
│ │ [Fresh Pasta] [Pumpkin Ravioli] [Sage] [Butter       │  │
│ │  Sauce] [+ Add]                                       │  │
│ │                                                        │  │
│ │ Mood:                                                 │  │
│ │ [Romantic] [Sophisticated] [Cozy] [+ Add]            │  │
│ │                                                        │  │
│ │ Setting:                                              │  │
│ │ [Modern] [Intimate] [+ Add]                           │  │
│ │                                                        │  │
│ │ Price Range:                                          │  │
│ │ ( ) Affordable  ( ) Mid-range  (•) Expensive         │  │
│ │                                                        │  │
│ │ Suitable For:                                         │  │
│ │ [Dating] [Celebrations] [+ Add]                       │  │
│ │                                                        │  │
│ │ 💡 Click [x] to remove, [+ Add] to add custom concept│  │
│ └────────────────────────────────────────────────────────┘  │
│                                                             │
│ ┌─ 📝 Notes ─────────────────────────────────────────┐     │
│ │ Public notes (visible to all curators):            │     │
│ │ ┌───────────────────────────────────────────┐     │     │
│ │ │ Best pasta in São Paulo! Must try the     │     │     │
│ │ │ pumpkin ravioli. Reservation recommended. │     │     │
│ │ └───────────────────────────────────────────┘     │     │
│ │                                                     │     │
│ │ Private notes (only you see):                      │     │
│ │ ┌───────────────────────────────────────────┐     │     │
│ │ │ Went with Maria on Nov 17. Sat at table   │     │     │
│ │ │ 12 near the window. Waiter Paulo was      │     │     │
│ │ │ excellent - gave great wine pairing tips. │     │     │
│ │ └───────────────────────────────────────────┘     │     │
│ └───────────────────────────────────────────────────┘     │
│                                                             │
│ ┌─ 📅 Metadata ──────────────────────────────────────┐     │
│ │ Visit Date: [2025-11-17] (Optional)                │     │
│ │ Source: [Personal Visit ▼] (audio/personal/etc.)   │     │
│ └───────────────────────────────────────────────────────┘   │
│                                                             │
│ ═══════════════════════════════════════════════════════════│
│                                                             │
│ Status: (•) Draft  ( ) Published                           │
│                                                             │
│ [❌ Discard]              [💾 Save Draft] [✅ Publish]     │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

**Fluxo Alternativo (10% - Sem Recording):**

Se curador clica "Skip Recording" ou fecha o recording:

```
┌─ ✍️ Manual Entry ──────────────────────────────────────┐
│ No recording? No problem! Write your review:           │
│                                                         │
│ ┌─────────────────────────────────────────────────┐   │
│ │ Type your review here...                        │   │
│ │                                                  │   │
│ └─────────────────────────────────────────────────┘   │
│                                                         │
│ [🤖 Extract Concepts from Text] ← Usa GPT-4 igual     │
│                                                         │
│ OR                                                      │
│                                                         │
│ [Skip AI] [Fill Concepts Manually] → Pula pra form    │
└───────────────────────────────────────────────────────────┘
```

---

## 🛠️ Plano de Implementação

### Fase 1: Preparação (Sem Quebrar Nada)
1. ✅ Documentar interface atual
2. ✅ Definir nova arquitetura
3. ⏳ Criar wireframes/mockups
4. ⏳ Validar com usuário

### Fase 2: Refatoração Backend-Ready
1. Verificar se schema de curations está completo
2. Confirmar endpoints de curations funcionando
3. Testar CRUD de curations via API

### Fase 3: Nova UI Incremental
1. **Step 1**: Reformular Entities List
   - Adicionar coluna "My Curation"
   - Adicionar status badges (✅/❌/⚠️)
   - Manter botões atuais funcionando

2. **Step 2**: Criar Curation Editor (minimal)
   - Form básico: transcription + description
   - Botões: Save Draft / Publish
   - Integrar com SyncManager

3. **Step 3**: Integrar Audio Recording
   - Mover recording-section para Curation Editor
   - Auto-transcribe quando gravar
   - Generate description button

4. **Step 4**: Entity Detail View
   - Mostrar dados da entidade
   - Listar todas as curadorias
   - Link para "Edit My Curation"

5. **Step 5**: Dashboard (opcional)
   - Stats cards
   - Recent activity
   - Quick links

### Fase 4: Deprecar Código Antigo
1. Remover `transcription-section`
2. Remover `concepts-section` (migrar campos)
3. Simplificar `uiManager.js` (menos show/hide sections)
4. Remover duplicate recording controls

---

## 📋 Decisões Arquiteturais

### 1. **Separação Clara: Entity vs Curation**

**Entity** (Restaurant, Bar, Hotel, Café - agnostic de tipo):
- Dados objetivos e compartilhados
- **Nome, localização, fotos, contato** (dados factuais)
- **Conceitos extraídos** (cuisines, menu items, ambiance, etc.)
  - Organizados em **categorias** (Cuisine, Menu, Price Range, Mood, Setting, etc.)
  - Categorias vêm do **MongoDB** (coleção `categories`)
  - **Dinâmicas e extensíveis** - não hardcoded
  - Conceitos são extraídos da **transcrição via GPT-4**
- **Agnóstico de tipo**: Hoje restaurantes, amanhã hotéis, bares, atrações
- Todos os curadores veem mesma entity, mas podem ter curatorias diferentes

**Curation**:
- **Opinião pessoal** do curador sobre uma entity
- **Uma entity pode ter múltiplas curations** (uma por curador)
- **Campos**: notes (public/private), categories (conceitos do curador), sources
- Curador só edita **suas próprias** curations
- Recording + Transcription → usados para extrair conceitos da curation

### 2. **Sistema de Categorias e Conceitos**

**Como Funciona:**

```
MongoDB: categories collection
├── entity_type: "restaurant"
│   └── categories: ["Cuisine", "Menu", "Price Range", "Mood", "Setting", ...]
├── entity_type: "bar"
│   └── categories: ["Drinks", "Mood", "Setting", "Music", ...]
└── entity_type: "hotel"
    └── categories: ["Amenities", "Room Types", "Services", ...]
```

**Extração de Conceitos:**

1. Curador grava áudio (ou digita texto)
2. **GPT-4 extrai conceitos** organizados por categorias
3. Exemplo de resposta:
```json
{
  "Cuisine": ["Italian", "Contemporary"],
  "Menu": ["Pasta", "Risotto", "Tiramisu"],
  "Mood": ["Romantic", "Sophisticated"],
  "Setting": ["Modern", "Outdoor seating"],
  "Price Range": ["Expensive"]
}
```

**Conceitos Autorais:**

- Curador pode **adicionar conceitos novos**
- **MAS** devem se encaixar em uma **categoria existente**
- Exemplo: Categoria "Menu" já existe → Curador pode adicionar "Pão de queijo artesanal"
- **Não pode**: Criar categoria nova "Estacionamento" (admin precisa adicionar via MongoDB)

### 2. **Navegação Persistente**

**Atual**: Hide all → Show one (navegação destrutiva)  
**Nova**: Top nav sempre visível + main content area

```html
<nav id="top-nav">
  <a href="#entities">Entities</a>
  <a href="#my-curations">My Curations</a>
  <a href="#drafts">Drafts</a>
  <a href="#settings">Settings</a>
</nav>

<main id="main-content">
  <!-- Content changes, but nav stays -->
</main>
```

### 3. **Recording Como Feature, Não Como Workflow**

**Atual**: Recording é uma "tela" separada  
**Nova**: Recording é uma **feature dentro do Curation Editor**

Assim como "Take Photo" é um botão na concepts-section, "Record Audio" é um botão/accordion no Curation Editor.

### 4. **Entities List Como Ponto Central**

**Fluxo Principal**:
1. Curador abre app → vê Entities List
2. Vê quais entidades já tem curadoria (✅)
3. Vê quais estão pendentes (❌)
4. Clica "Create Curation" ou "Edit Curation"
5. Vai para Curation Editor
6. Salva → volta para Entities List

### 5. **Status de Curadoria**

Três estados possíveis:
- ✅ **Published**: Curadoria completa e publicada
- ⚠️ **Draft**: Curadoria salva mas não publicada
- ❌ **None**: Entidade sem curadoria deste curador

---

## 🎯 Benefícios da Nova Arquitetura

### Para o Curador
1. **Clareza Mental**: Entende a diferença entre "dados da entidade" e "minha opinião"
2. **Eficiência**: Vê imediatamente quais entities já curou vs pendentes
3. **Contexto Preservado**: Sempre vê dados da entity ao criar curation
4. **Controle Visual**: Dashboard mostra progresso (X curations, Y drafts, Z pendentes)
5. **Flexibilidade**: Pode gravar áudio (com AI) OU digitar direto
6. **Multi-Curator Aware**: Vê curations de outros curadores como referência

### Para o Código
1. **Manutenibilidade**: Menos lógica de show/hide, componentes mais independentes
2. **Escalabilidade**: Fácil adicionar features (ratings, photos na curation, etc.)
3. **Testabilidade**: Componentes isolados, fluxos lineares
4. **Performance**: Menos manipulação DOM, renderização sob demanda
5. **Clean Architecture**: Separação clara model/view/controller
6. **Type Safety**: Schema bem definido facilita validação

### Para o Projeto
1. **Alinhamento Backend-Frontend**: UI reflete schema MongoDB V3
2. **Sistema Agnóstico**: Pronto para restaurant → bar → hotel → qualquer tipo
3. **Categorias Dinâmicas**: Admin pode adicionar/remover categorias sem mexer no código
4. **Multi-Curator Native**: Já pensa em múltiplos curadores desde o design
5. **V3 Completion**: Fecha gap entre backend (pronto) e frontend (incompleto)
6. **Conceitos Autorais**: Curador pode contribuir conceitos novos dentro de estrutura existente

### Para o Negócio
1. **Onboarding Simples**: Novo curador entende fluxo em segundos
2. **Escalabilidade de Conteúdo**: N curadores podem curar mesmas entities (pontos de vista diferentes)
3. **Quality Control**: Admin/Manager gerencia entities, curadores focam em opinião
4. **Expansão de Verticais**: Fácil adicionar "bares", "hotéis" sem reescrever UI
5. **Data Consistency**: Categorias centralizadas evitam "salada de conceitos"

---

## ❓ Perguntas para Validação

### ✅ RESPOSTAS CONFIRMADAS

#### 1. **Fluxo principal do curador?**
**RESPOSTA:** Ambos são possíveis, mas com uma diferença crítica:
- ✅ **Entity SEMPRE vem de fonte externa** (Google Places ou scripts como Michelin)
- ✅ **Auto-save on search**: Quando curador busca no Google Places, todas as entities retornadas são salvas automaticamente no MongoDB
- ✅ Curador NÃO pode criar entity manual (sem source)
- ✅ Fluxo: Search Google Places → Results auto-saved → Curador escolhe qual curar

**Implicação UI:**
- Remover qualquer botão "Add Entity Manually"
- Interface de search é a única forma de "adicionar" entities
- Search results salvam entities em background (transparente para curador)

#### 2. **Recording é usado sempre ou só às vezes?**
**RESPOSTA:** 🎙️ **90% das vezes!** É a forma mais importante e fácil de criar curadoria.

**Implicação UI:**
- Recording deve ser **destaque principal** no Curation Editor
- Não é "opcional" - é o fluxo primário
- Transcription manual é fallback (10%)
- Botão grande: "🔴 Start Recording" como CTA principal

#### 3. **Quick Import (20 nearby)?**
**RESPOSTA:** Implementação atual não é ideal. Deveria ser:
- ❌ Não: Botão separado "Import 20 Nearby"
- ✅ Sim: Botão "📍 Nearby" na **interface de search do Google Places**
- Mostra results ordenados por proximidade
- Default sempre: `type=restaurant`

**Implicação UI:**
- Remover `quick-actions-section` atual
- Adicionar filtro "Nearby" na Places Search interface
- Integrar com Places Search (não feature separada)

#### 4. **Entity pode existir sem curation?**
**RESPOSTA:** ✅ **SIM! E é o caso mais comum.**
- Dezenas de milhares de entities
- Pequena parcela com curations
- **Auto-save**: Search Google Places → 51 results → 51 entities salvas
- Curador só cura 1 ou 2 dessas 51

**Implicação UI - Entity List:**
- **CRÍTICO**: Entity List do curador ≠ Todas as entities do MongoDB
- Lista do curador = "Working Set":
  - Entities que ele está curando
  - Entities que ele viu detalhes recentemente
  - Entities com suas curations
  - Entities favoritadas/starred
- Não mostrar milhares de entities sem curadoria

**Tipos de Listas:**
1. **My Curations** - Entities com minha curation (draft ou published)
2. **Recently Viewed** - Entities que vi detalhes nas últimas 24h/7d
3. **Favorites/Starred** - Entities que marquei para curar depois
4. **All Search Results** - Último search do Google Places

#### 5. **Quem pode criar entities?**
**RESPOSTA:** Criação automática em dois cenários:
- ✅ **On-demand**: Collector auto-save ao navegar Google Places
- ✅ **Batch scripts**: Import de listas Michelin, etc.
- ❌ Curador não cria manualmente

**Implicação UI:**
- Sem botão "Add Entity"
- Entity creation é side-effect de search
- Scripts de admin rodam em background (não precisa UI)

---

### 🔄 Fluxo Revisado do Curador

**Caso de Uso Principal:**

```
1. Curador abre app
   └─> Vê "My Curations" (entities que já curou)
   └─> Vê "Recently Viewed" (entities que explorou)

2. Curador quer curar restaurante novo
   ├─> Clica "🔍 Search Places"
   ├─> Digite "Maní São Paulo" OU clica "📍 Nearby"
   ├─> Google Places retorna 20-50 results
   └─> 🎯 TODOS salvos automaticamente no MongoDB

3. Curador clica em "Maní" nos results
   └─> Abre Entity Detail View
   └─> Mostra dados do Google Places
   └─> Mostra se já tem curations (de outros curadores)
   └─> Botão: "➕ Create My Curation"

4. Curador clica "Create My Curation"
   └─> Abre Curation Editor
   └─> Foco principal: "🔴 Start Recording" (CTA grande)

5. Curador grava áudio (90% dos casos)
   ├─> Fala sobre experiência: "Visitei o Maní..."
   ├─> Para gravação
   ├─> Whisper transcreve automaticamente
   ├─> GPT-4 extrai conceitos (por categoria)
   └─> Form popula com conceitos extraídos

6. Curador revisa/edita conceitos
   ├─> Pode adicionar conceitos manualmente
   ├─> Pode editar notas públicas/privadas
   └─> Salva como Draft OU Publica

7. Volta para "My Curations"
   └─> Vê lista atualizada com nova curation
```

**Caso Alternativo (10%):**

```
4. Curador clica "Create My Curation"
5. Curador NÃO grava áudio
   ├─> Digita transcription manualmente
   ├─> Clica "🤖 Extract Concepts"
   ├─> GPT-4 processa texto
   └─> Form popula com conceitos

OU

   ├─> Pula extração automática
   ├─> Preenche categorias manualmente
   └─> Salva
```

---

## 📝 Próximos Passos

### ✅ Fase 1: Documentação - COMPLETA
- ✅ Análise da interface atual (7 seções identificadas)
- ✅ Entendimento do modelo de dados (MongoDB, categories, concepts)
- ✅ Validação com usuário (5 perguntas respondidas)
- ✅ Wireframes completos (3 telas principais)
- ✅ Mapeamento atual → novo (tabelas de transformação)

### 🎯 Fase 2: Planejamento da Implementação

**Prioridade 1: Core Features (Semana 1)**
1. **Places Search Interface**
   - Integrar com Google Places API
   - Auto-save entities no MongoDB (background)
   - Filtros: type, distance, nearby
   - Results cards com status de curation

2. **Curation Editor**
   - Recording UI (CTA principal)
   - Transcription (Whisper integration)
   - Concept extraction (GPT-4 + MongoDB categories)
   - Notes (public/private)
   - Save Draft / Publish

3. **My Curations Dashboard**
   - Tabs: My Curations, Recently Viewed, Favorites
   - Stats cards
   - Filtros e sorting

**Prioridade 2: Views (Semana 2)**
4. **Entity Detail View**
   - Entity info (objective data)
   - All curations (multi-curator)
   - CTA: Create/Edit My Curation

5. **Working Set Management**
   - Recently Viewed tracking (IndexedDB)
   - Favorites/Starred system
   - Sync com MongoDB

**Prioridade 3: Polish (Semana 3)**
6. **Remover código legacy**
   - Deprecar sections antigas
   - Limpar show/hide logic
   - Simplificar navigation

7. **Performance**
   - Lazy loading de entities
   - Pagination na lista
   - Cache de searches

### 📋 Decisões Arquiteturais Finais

**Entity Creation:**
- ✅ Somente via Google Places API ou batch scripts
- ❌ Sem criação manual pelo curador
- 🔄 Auto-save transparente ao buscar

**Recording:**
- ✅ CTA principal no Curation Editor (90% dos casos)
- ✅ Fallback para digitação manual (10%)
- 🔄 Auto-transcribe → Auto-extract concepts

**Entity List:**
- ✅ Working set do curador (não todas as entities)
- ✅ Tabs: My Curations, Recently Viewed, Favorites
- ❌ Não mostrar milhares de entities sem contexto

**Quick Import:**
- ❌ Remover seção separada
- ✅ Integrar como botão "Nearby" na Places Search
- 🔄 Default filter: type=restaurant

**Categories & Concepts:**
- ✅ Categorias vêm do MongoDB (dinâmicas)
- ✅ Conceitos extraídos por GPT-4
- ✅ Curador pode adicionar conceitos dentro de categorias
- ❌ Curador não pode criar categorias (só admin)

### 🚀 Ready to Implement

O redesign está completamente documentado e validado. Próximo passo: começar implementação pela **Places Search Interface** (prioridade 1).

**Pergunta:** Quer que eu comece a implementação ou prefere revisar algo no documento antes?

---

**Documento vivo**: Este doc será atualizado conforme a implementação progride.
