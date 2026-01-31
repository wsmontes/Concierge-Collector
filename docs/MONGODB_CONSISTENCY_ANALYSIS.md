# MongoDB Data Consistency Analysis

**Date:** Janeiro 30, 2026  
**Context:** Análise de integridade de dados IndexedDB ↔ MongoDB API V3  
**Purpose:** Verificar consistência de schemas, transformações, e validações

---

## 1. Arquitetura de Comunicação

### 1.1 **Fluxo de Dados**

```
Frontend (IndexedDB)
    ↕ V3DataTransformer
MongoDB API V3 (FastAPI)
    ↕ Pydantic Schemas
MongoDB (Persistence)
```

**Camadas identificadas:**
1. **IndexedDB** - Cliente local (Dexie)
2. **V3DataTransformer** - Transformação bidirecional
3. **API V3** - FastAPI endpoints
4. **Pydantic** - Validação de schemas
5. **MongoDB** - Persistência

---

## 2. Identificadores (IDs) - Análise Crítica

### 2.1 **Entity IDs - 3 Tipos Diferentes** ⚠️

**MongoDB:**
```python
# entities.py:74
doc["_id"] = entity.entity_id  # entity_id usado como _id
doc["version"] = 1
```

**IndexedDB:**
```javascript
// dataStore.js:87
entities: '++id, entity_id, type, name, ...'
// Dois IDs:
// - id: auto-increment (local)
// - entity_id: string (sync com MongoDB _id)
```

**Tipos encontrados:**
1. **`id`** (IndexedDB) - Auto-increment local (5, 10, 15)
2. **`entity_id`** (Frontend/Backend) - UUID/slug (`entity_ChIJ...`, `rest_dom_saopaulo`)
3. **`_id`** (MongoDB) - Igual a entity_id

**Problema de consistência:**
```javascript
// IndexedDB tem id != entity_id
const entity = await db.entities.get(5);  // id=5
entity.entity_id  // "entity_ChIJxxx"  (diferente!)

// MongoDB usa entity_id como _id
db.entities.find_one({"_id": "entity_ChIJxxx"})  // OK
```

**✅ Conclusão:** Não é problema - `id` é só chave IndexedDB, `entity_id` é a chave real.

---

### 2.2 **Curation IDs - Mesmo Padrão**

**Backend geração:**
```python
# ai_orchestrator.py:293
"curation_id": f"cur_{uuid.uuid4().hex[:12]}"
```

**Frontend esperado:**
```javascript
// Não encontrado geração de curation_id no frontend
// Sempre vem do backend ou é passado manualmente
```

**⚠️ Problema:** Frontend não tem geração de curation_id consistente.

---

## 3. Transformação de Dados - V3DataTransformer

### 3.1 **Entity: MongoDB → IndexedDB**

**Código encontrado:**
```javascript
// V3DataTransformer.js:43
mongoEntityToLocal(mongoEntity) {
    const local = {
        entity_id: mongoEntity.entity_id || mongoEntity._id,  // ✅ Fallback correto
        type: mongoEntity.type || 'restaurant',
        name: mongoEntity.name,
        // ...
        sync: {
            serverId: mongoEntity._id || null,  // ✅ Armazena _id do MongoDB
            status: 'synced',
            lastSyncedAt: new Date()
        }
    };
    return local;
}
```

**Mapeamento:**
| MongoDB | → | IndexedDB | Consistente? |
|---------|---|-----------|--------------|
| `_id` | → | `sync.serverId` | ✅ Sim |
| `entity_id` | → | `entity_id` | ✅ Sim |
| `createdAt` (ISO string) | → | `createdAt` (Date) | ✅ Sim (parseDate) |
| `metadata` (array) | → | `metadata` (array) | ✅ Sim |
| `data` (object) | → | `data` (object) | ✅ Sim |
| `version` | → | `version` | ✅ Sim |

**✅ Transformação consistente.**

---

### 3.2 **Entity: IndexedDB → MongoDB**

**Código encontrado:**
```javascript
// V3DataTransformer.js:96
localEntityToMongo(localEntity) {
    const mongo = {
        entity_id: localEntity.entity_id,
        type: localEntity.type || 'restaurant',
        name: localEntity.name,
        // ...
        createdAt: this.formatDate(localEntity.createdAt),  // Date → ISO
        updatedAt: this.formatDate(localEntity.updatedAt),
        version: localEntity.version || 1
    };
    
    // ✅ Adiciona _id se tiver serverId
    if (localEntity.sync && localEntity.sync.serverId) {
        mongo._id = localEntity.sync.serverId;
    }
    
    return mongo;
}
```

**Mapeamento reverso:**
| IndexedDB | → | MongoDB | Consistente? |
|-----------|---|---------|--------------|
| `entity_id` | → | `entity_id` | ✅ Sim |
| `sync.serverId` | → | `_id` | ✅ Sim |
| `createdAt` (Date) | → | `createdAt` (ISO) | ✅ Sim (formatDate) |
| `metadata` (array) | → | `metadata` (array) | ✅ Sim |
| `version` | → | `version` | ✅ Sim |

**✅ Transformação reversa consistente.**

---

### 3.3 **Roundtrip Validation**

**Teste de integridade:**
```javascript
// V3DataTransformer.js:359
validateEntityRoundtrip(original, direction = 'toLocal') {
    if (direction === 'toLocal') {
        // MongoDB → IndexedDB → MongoDB
        transformed = this.mongoEntityToLocal(original);
        roundtrip = this.localEntityToMongo(transformed);
    }
    
    // Verifica campos críticos:
    // - entity_id
    // - name
    // - type
    // - version
}
```

**✅ Validação implementada** (mas não vejo sendo usada nos testes).

---

## 4. Validação de Schemas - Pydantic vs IndexedDB

### 4.1 **Entity Schema - Backend (Pydantic)**

```python
# schemas.py:36
class EntityBase(BaseModel):
    type: EntityType  # ✅ ENUM validado
    name: str = Field(..., min_length=1, max_length=500)  # ✅ Required
    status: EntityStatus = Field(default="active")  # ✅ ENUM validado
    externalId: Optional[str] = None
    metadata: List[Metadata] = Field(default_factory=list)
    data: Optional[Dict[str, Any]] = None  # ✅ Flexível
```

**Validações Pydantic:**
- ✅ `type` - Enum literal ("restaurant", "hotel", etc.)
- ✅ `name` - Required, 1-500 chars
- ✅ `status` - Enum literal ("active", "inactive", "draft")
- ✅ `metadata` - Array validada

---

### 4.2 **Entity Schema - Frontend (IndexedDB)**

```javascript
// dataStore.js:87
entities: '++id, entity_id, type, name, status, createdBy, ...'
```

**Validações IndexedDB:**
- ❌ **Nenhuma** - Dexie não valida tipos
- ❌ `type` pode ser qualquer string
- ❌ `name` pode ser vazio
- ❌ `status` pode ser qualquer string

**Exemplo de problema:**
```javascript
// ❌ Aceito no IndexedDB
await db.entities.add({
    entity_id: "test",
    type: "invalid_type",  // Backend rejeita
    name: "",              // Backend rejeita
    status: "wrong"        // Backend rejeita
});

// ✅ Vai quebrar no sync com API
await apiService.createEntity(entity);
// HTTPException 422: Validation error
```

---

### 4.3 **Curation Schema - Backend (Pydantic)**

```python
# schemas.py:112
class CurationCreate(CurationBase):
    curation_id: str = Field(..., description="Unique curation ID")  # ✅ Required
    entity_id: str = Field(..., description="Entity reference")      # ✅ Required
    curator: CuratorInfo  # ✅ Structured validator
```

**CuratorInfo validation:**
```python
class CuratorInfo(BaseModel):
    id: str         # ✅ Required
    name: str       # ✅ Required
    email: Optional[EmailStr] = None  # ✅ Email validado
```

---

### 4.4 **Curation Schema - Frontend (IndexedDB)**

```javascript
// dataStore.js:87
curations: '++id, curation_id, entity_id, curator_id, ...'
```

**Problema identificado:**
```javascript
// IndexedDB armazena:
curation = {
    curation_id: "cur_xxx",
    entity_id: "entity_yyy",
    curator_id: "curator_123",  // ❌ Só ID
    curatorName: "John Doe"     // ❌ Denormalizado
}

// Backend espera:
{
    curation_id: "cur_xxx",
    entity_id: "entity_yyy",
    curator: {                   // ✅ Structured
        id: "curator_123",
        name: "John Doe",
        email: "john@example.com"
    }
}
```

**✅ Transformação corrige:**
```javascript
// V3DataTransformer.js:196
localCurationToMongo(localCuration) {
    return {
        curator: {
            id: localCuration.curator_id,
            name: localCuration.curatorName || 'Unknown'  // ⚠️ Fallback
        }
    };
}
```

**⚠️ Problema:** Se `curatorName` estiver null, vai criar curation com "Unknown".

---

## 5. Problemas de Consistência Encontrados

### 5.1 **❌ Problema 1: Validação Missing no Frontend**

**Localização:** dataStore.js - createEntity()

**Código atual:**
```javascript
// dataStore.js:399
async createEntity(entityData) {
    const entity = {
        entity_id: entityData.entity_id || this.generateId('ent'),
        type: entityData.type || 'restaurant',  // ❌ Aceita qualquer string
        name: entityData.name,                  // ❌ Pode ser undefined
        status: entityData.status || 'active'   // ❌ Aceita qualquer string
    };
    
    const id = await this.db.entities.add(entity);  // ❌ Sem validação
    return entity;
}
```

**Impacto:**
- Entity criado localmente com dados inválidos
- Sync falha no backend (422 Validation Error)
- User perde dados offline

**Fix necessário:**
```javascript
async createEntity(entityData) {
    // ✅ Validate antes de salvar
    if (!entityData.name || entityData.name.length === 0) {
        throw new Error('Entity name is required');
    }
    
    const validTypes = ['restaurant', 'hotel', 'venue', 'bar', 'cafe', 'other'];
    if (entityData.type && !validTypes.includes(entityData.type)) {
        throw new Error(`Invalid entity type: ${entityData.type}`);
    }
    
    const validStatuses = ['active', 'inactive', 'draft'];
    if (entityData.status && !validStatuses.includes(entityData.status)) {
        throw new Error(`Invalid status: ${entityData.status}`);
    }
    
    // Agora sim, criar
    const entity = { /* ... */ };
    const id = await this.db.entities.add(entity);
    return entity;
}
```

---

### 5.2 **⚠️ Problema 2: Curator Info Denormalizada**

**Localização:** Curations - curator data

**IndexedDB:**
```javascript
curation = {
    curator_id: "cur_123",
    curatorName: "John Doe"  // ⚠️ Pode ficar desatualizado
}
```

**Cenário problemático:**
1. Curator "John Doe" cria curation offline
2. `curatorName: "John Doe"` salvo no IndexedDB
3. Curator muda nome para "John Smith" no backend
4. Frontend nunca atualiza curatorName (não tem trigger)
5. Sync envia `curator: {name: "John Doe"}` (errado)

**Fix:**
```javascript
// Opção A: Sempre buscar curator atual antes de sync
async syncCuration(curation) {
    const curator = await apiService.getCurator(curation.curator_id);
    curation.curatorName = curator.name;  // Atualizar
    await apiService.createCuration(curation);
}

// Opção B: Não armazenar curatorName, sempre buscar
// (mais correto mas mais lento)
```

---

### 5.3 **❌ Problema 3: Version Conflict - No Retry**

**Localização:** Optimistic locking failures

**Backend:**
```python
# entities.py:110
def update_entity(entity_id, updates, if_match):
    if not if_match:
        raise HTTPException(400, "If-Match header required")
    
    current_version = int(if_match)
    entity = db.entities.find_one({"_id": entity_id})
    
    if entity["version"] != current_version:
        raise HTTPException(409, "Version conflict")  # ❌ Frontend não trata
```

**Frontend:**
```javascript
// Não encontrado: Handling de 409 Version Conflict
// apiService.js não tem retry logic para conflicts
```

**Cenário:**
1. User A offline edita entity (version=5)
2. User B online edita entity (version=5→6)
3. User A volta online, tenta sync (If-Match: 5)
4. Backend rejeita: 409 Conflict
5. Frontend: **Dados perdidos** (sem retry)

**Fix necessário:**
```javascript
// apiService.js
async updateEntity(entityId, updates, currentVersion) {
    try {
        return await this.request('PATCH', `/entities/${entityId}`, {
            headers: { 'If-Match': String(currentVersion) }
        });
    } catch (error) {
        if (error.status === 409) {
            // ✅ Conflict: fetch latest, merge, retry
            const latest = await this.getEntity(entityId);
            const merged = this.mergeConflicts(updates, latest);
            return await this.updateEntity(entityId, merged, latest.version);
        }
        throw error;
    }
}
```

---

### 5.4 **⚠️ Problema 4: Nested Property em Sync**

**Localização:** IndexedDB schema

**Schema v8:**
```javascript
// dataStore.js:87
entities: '++id, entity_id, ..., sync.status'  // ❌ Nested não funciona
```

**Impacto:**
```javascript
// Query quebrado
const pending = await db.entities
    .where('sync.status').equals('pending')  // ❌ Full scan (sem index)
    .toArray();
```

**Evidência:**
- Schema define `sync.status` como index
- Dexie **não suporta** nested property em index
- Index nunca foi criado
- Todas queries de sync são lentas

**Fix (já documentado):**
```javascript
// Schema v9
entities: '++id, entity_id, ..., syncStatus'  // ✅ Flat property

// Migration
db.entities.toCollection().modify(entity => {
    entity.syncStatus = entity.sync?.status || 'synced';
});
```

---

### 5.5 **❌ Problema 5: Date Timezone Inconsistente**

**Backend:**
```python
# entities.py:87
doc["createdAt"] = datetime.now(timezone.utc)  # ✅ UTC
doc["updatedAt"] = datetime.now(timezone.utc)
```

**V3DataTransformer:**
```javascript
// V3DataTransformer.js:47
createdAt: this.parseDate(mongoEntity.createdAt),  // ISO → Date

formatDate(date) {
    if (date instanceof Date) {
        return date.toISOString();  // ✅ UTC
    }
}
```

**Frontend creation:**
```javascript
// dataStore.js:410
const entity = {
    createdAt: new Date(),  // ⚠️ LOCAL timezone
    updatedAt: new Date()
};
```

**Problema:**
```javascript
// User em São Paulo (UTC-3)
const entity = {
    createdAt: new Date()  // 2026-01-30T15:00:00-03:00
};

// Transforma para MongoDB
const mongo = transformer.localEntityToMongo(entity);
mongo.createdAt  // "2026-01-30T18:00:00.000Z"  ✅ Correto (UTC)

// Mas... queries by date são problemáticas
db.entities.where('createdAt').above(new Date('2026-01-30'))
// Compara Date object com string ISO (tipo diferente!)
```

**Fix:**
```javascript
// dataStore.js - sempre criar em UTC
const entity = {
    createdAt: new Date(Date.now()),  // ✅ Always UTC in Date object
    updatedAt: new Date(Date.now())
};
```

---

## 6. Validação no Backend - Análise

### 6.1 **Entity Validations (Pydantic)**

**Validações encontradas:**
```python
# schemas.py:38
type: EntityType  # ✅ Literal["restaurant", "hotel", "venue", "bar", "cafe", "other"]
name: str = Field(..., min_length=1, max_length=500)  # ✅ Required + length
status: EntityStatus = Field(default="active")  # ✅ Literal["active", "inactive", "draft"]
metadata: List[Metadata]  # ✅ Array validada
```

**✅ Backend bem protegido.**

---

### 6.2 **Curation Validations (Pydantic)**

**Validações encontradas:**
```python
# schemas.py:116
curation_id: str = Field(...)  # ✅ Required
entity_id: str = Field(...)    # ✅ Required
curator: CuratorInfo           # ✅ Structured validation

# curations.py:67
entity = db.entities.find_one({"_id": curation.entity_id})
if not entity:
    raise HTTPException(404, "Entity not found")  # ✅ FK validation
```

**✅ Backend valida foreign keys.**

---

### 6.3 **Missing Validations**

**❌ Não encontrado:**
1. `entity_id` format validation (aceita qualquer string)
2. `curation_id` format validation
3. `curator.id` existence check (pode referenciar curator inexistente)
4. `metadata.type` validation (aceita qualquer string)

**Exemplo de problema:**
```javascript
// ✅ Backend aceita
POST /api/v3/entities
{
    "entity_id": "invalid###id",  // ❌ Deveria validar formato
    "type": "restaurant",
    "name": "Test"
}
```

---

## 7. Problemas de Sync - Análise de Falhas

### 7.1 **Partial Sync Failures**

**Cenário:**
```javascript
// User cria 10 entities offline
for (let i = 0; i < 10; i++) {
    await db.entities.add({...});
}

// Sync
for (const entity of entities) {
    await apiService.createEntity(entity);  // ❌ Entity 5 falha
    // Entities 6-10 nunca são sincronizadas
}
```

**Problema:** Sem transaction no sync, partial failures deixam dados inconsistentes.

---

### 7.2 **Duplicate Sync**

**Cenário:**
```javascript
// User cria entity offline
const entity = await db.entities.add({entity_id: "ent_123"});

// Sync 1 (WiFi instável)
await apiService.createEntity(entity);  // ✅ Sucesso no backend
// Mas timeout no frontend (não recebeu response)

// Frontend marca como não sincronizado
entity.sync.status = 'pending';

// Sync 2
await apiService.createEntity(entity);  // ❌ 500 "already exists"
```

**Fix necessário:**
```javascript
// apiService.js
async createEntity(entity) {
    try {
        return await this.post('/entities', entity);
    } catch (error) {
        if (error.status === 500 && error.message.includes('already exists')) {
            // ✅ Entity já existe, buscar do servidor
            return await this.getEntity(entity.entity_id);
        }
        throw error;
    }
}
```

---

## 8. Recomendações Finais

### 8.1 **Priority 1 - Data Integrity (Crítico)**

| Fix | Onde | Impacto |
|-----|------|---------|
| ✅ Add frontend validation | dataStore.js:createEntity() | Previne sync failures |
| ✅ Handle 409 conflicts | apiService.js | Previne data loss |
| ✅ Handle duplicate sync | apiService.js:createEntity() | Previne errors 500 |
| ✅ Fix nested sync.status | Schema v9 | Acelera sync queries |

---

### 8.2 **Priority 2 - Data Consistency**

| Fix | Onde | Impacto |
|-----|------|---------|
| ⚠️ Validate entity_id format | Backend schemas.py | Previne IDs inválidos |
| ⚠️ Check curator existence | curations.py:create | Previne FK órfãos |
| ⚠️ Update curatorName on sync | syncManager.js | Mantém nomes atualizados |
| ⚠️ Add UUID validation | Frontend + Backend | Garante IDs únicos |

---

### 8.3 **Priority 3 - Error Recovery**

| Fix | Onde | Impacto |
|-----|------|---------|
| 📝 Add sync transaction | syncManager.js | All-or-nothing sync |
| 📝 Implement conflict resolver UI | conflictResolver.js | User escolhe versão |
| 📝 Add data migration validator | V3DataTransformer.js | Previne schema breaks |

---

## 9. Conclusão

### ✅ **O que está bem implementado:**

1. **V3DataTransformer** - Transformações bidirecionais corretas
2. **Backend Pydantic** - Validações de schemas robustas
3. **Optimistic locking** - Version control implementado
4. **Date handling** - UTC timestamps consistentes

### ❌ **O que precisa consertar:**

1. **Frontend validation** - Zero validação antes de salvar IndexedDB
2. **Conflict handling** - 409 errors não tratados (data loss)
3. **Duplicate sync** - Tentativas repetidas quebram sistema
4. **Nested properties** - Index sync.status não funciona

### 📊 **Score de Consistência:**

- **Backend → IndexedDB**: 9/10 ✅ (V3DataTransformer excelente)
- **IndexedDB → Backend**: 5/10 ⚠️ (falta validação no frontend)
- **Conflict resolution**: 2/10 ❌ (não implementado)
- **Sync reliability**: 4/10 ⚠️ (duplicate/partial failures)

**Overall: 5/10** - Precisa fixes em validação frontend e conflict handling.

---

**Next Steps:**
1. Implementar validação frontend em createEntity/createCuration
2. Adicionar retry logic para 409 conflicts
3. Tratar duplicate sync (idempotência)
4. Migrar schema v9 (fix nested sync.status)
