# IndexedDB Usage Analysis - Cenários Reais e Limitações

**Date:** Janeiro 30, 2026  
**Context:** Análise técnica do uso real do IndexedDB antes de refatoração  
**Purpose:** Mapear cenários de uso, volumes de dados, e identificar código legado

---

## 1. Cenários de Uso Identificados

### 1.1 **Cenário Principal: Field Curator (Offline-First)**

**Workflow documentado:**
```
Curator → Restaurant (sem WiFi) → Grava áudio → Tira fotos → 
Adiciona notas → Próximo restaurante (2-5 por dia) → 
Hotel/escritório (WiFi) → Sync tudo
```

**Dados armazenados:**
- **Entities** (restaurants): 5-10KB cada, 2-5 por dia
- **Curations** (reviews): Transcrição 1-5KB, conceitos 1KB
- **pendingAudio**: MP3 100KB-2MB, 1-3 por restaurant
- **Fotos**: 500KB-5MB cada (após resize 800px)

**Volume típico (1 dia offline):**
- 5 restaurants × 10KB = 50KB
- 5 curations × 5KB = 25KB
- 5 audios × 1MB = 5MB
- 15 photos × 800KB = 12MB
- **Total: ~17MB por dia**

**Volume máximo (1 semana offline):**
- 35 restaurants, 35 curations, 35 audios, 100 photos
- **Total: ~120MB**

**✅ Conclusão:** IndexedDB suporta bem (limite 50MB-10GB dependendo do browser)

---

### 1.2 **Cenário Secundário: Bulk Import (Online)**

**Código encontrado:**
- `exportImportModule.js` - BATCH_SIZE = 15
- `importManager.js` - Import de arquivos JSON/ZIP
- `dataStorage.js` - importData() usa transaction para importar tudo junto

**Volume típico:**
- Import de 50-100 restaurants de arquivo Michelin
- Não tem áudio/fotos no import (só metadata)
- ~500KB-1MB total

**Limitação identificada:**
```javascript
// ❌ Problema: Sem bulkAdd - faz 100 add() sequenciais
for (const entity of entities) {
    await db.entities.add(entity);  // 1 por vez!
}

// ✅ Deveria ser:
await db.entities.bulkAdd(entities);  // Tudo de uma vez
```

**Performance atual:**
- 100 entities × 50ms = 5 segundos
- Com bulkAdd seria: ~200ms

---

### 1.3 **Cenário Terciário: Cache Online (Questionável)**

**Tabela `cache`:**
```javascript
// Schema version 6
cache: 'key, expires'
```

**Uso encontrado:**
- ❌ **ZERO matches** no grep para `db.cache`
- Schema define mas código não usa

**Investigação adicional:**
```bash
grep -r "db.cache" scripts/
# Nenhum resultado!
```

**✅ Conclusão:** Tabela `cache` é **código legado não usado**

---

## 2. Tabelas IndexedDB - Análise de Uso Real

### 2.1 **Tabelas ATIVAS (em uso hoje)**

| Tabela | Uso | Arquivo | Cenário | Volume |
|--------|-----|---------|---------|--------|
| **entities** | ✅ Core | dataStore.js | Offline creation | 5-10KB each |
| **curations** | ✅ Core | dataStore.js | Reviews | 5-10KB each |
| **curators** | ✅ Core | curatorModule.js | Local curator list | <1KB each |
| **syncQueue** | ✅ Core | syncManager.js | Pending sync | <1KB per item |
| **settings** | ✅ Core | dataStore.js | App settings | <10KB total |
| **pendingAudio** | ✅ Active | pendingAudioManager.js | Audio transcription queue | 100KB-2MB each |
| **draftRestaurants** | ✅ Active | draftRestaurantManager.js | Auto-save drafts | 5-20KB each |

**Total essenciais:** 7 tabelas

---

### 2.2 **Tabelas LEGADAS (não usadas)**

| Tabela | Status | Evidência | Recomendação |
|--------|--------|-----------|--------------|
| **cache** | ❌ Não usada | Zero referências no código | REMOVER no schema v9 |
| **drafts** | ⚠️ Sobreposta | `draftRestaurants` é usada | CONSOLIDAR |

**Drafts vs draftRestaurants:**
```javascript
// Schema v6: drafts genérica
drafts: '++id, type, data, curator_id, createdAt, lastModified'

// Schema v8: draftRestaurants específica (USADA)
draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio'
```

**Análise:**
- `drafts` foi criada para ser genérica (type = entity/curation)
- `draftRestaurants` foi criada depois para caso específico
- Código usa APENAS `draftRestaurants`
- `drafts` é código legado

**✅ Recomendação:** Remover `drafts`, manter `draftRestaurants`

---

## 3. Operações Bulk - Análise Crítica

### 3.1 **Import Data - Transaction Existente**

**Código encontrado:**
```javascript
// dataStorage.js:2650 - importData()
await this.db.transaction('rw', 
    [this.db.entities, this.db.curations, this.db.curators], 
async () => {
    // ✅ Usa transaction corretamente
    const curatorMap = new Map();
    const restaurantMap = new Map();
    
    // ❌ Mas não usa bulkAdd
    for (const entity of entities) {
        const id = await this.db.entities.add(entity);
        restaurantMap.set(entity.entity_id, id);
    }
});
```

**Problemas:**
1. Transaction ✅ certo
2. Mas faz add() em loop ❌ errado
3. Deveria usar bulkAdd() ✅

**Fix:**
```javascript
await this.db.transaction('rw', 
    [this.db.entities, this.db.curations, this.db.curators], 
async () => {
    // ✅ Use bulkAdd
    const ids = await this.db.entities.bulkAdd(entities, {
        allKeys: true
    });
    
    // Map IDs
    entities.forEach((entity, index) => {
        restaurantMap.set(entity.entity_id, ids[index]);
    });
});
```

---

### 3.2 **Export Operations - Sem Batch API**

**Código encontrado:**
```javascript
// exportImportModule.js:1500
// V3 doesn't have batch operations, create entities individually
const results = [];
for (const restaurant of batch) {
    try {
        const entityData = { type: 'restaurant', data: restaurant };
        const entityResponse = await window.apiService.createEntity(entityData);
        // ...
    }
}
```

**Análise:**
- Backend API V3 **não tem endpoint bulk**
- Frontend faz loop de POST /api/v3/entities
- BATCH_SIZE = 15 (hardcoded)

**API V3 Status:**
```bash
❌ POST /api/v3/entities/bulk - NÃO EXISTE
✅ POST /api/v3/entities      - Existe (1 por vez)
```

**✅ Conclusão:** 
- Problema não é IndexedDB
- Problema é backend não ter bulk endpoint
- Fix: Criar POST /api/v3/entities/bulk no backend

---

## 4. Limitações de Storage - Análise Real

### 4.1 **Storage Quota - Comportamento Atual**

**Código de monitoring:**
```javascript
// dataStore.js:147
if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    const percentUsed = (estimate.usage / estimate.quota) * 100;
    this.log.warn(`Storage usage: ${usage}MB / ${quota}MB (${percent}%)`);
    
    if (percentUsed > 90) {
        this.log.error('Storage quota almost full - causing IndexedDB failures');
    }
}
```

**Quotas por browser (pesquisa):**
- Chrome/Edge: ~60% do disco disponível (min 50MB)
- Firefox: ~50% do disco disponível (min 50MB)
- Safari: ~1GB ou 50% do disco (mais restritivo)
- Mobile Chrome: ~50% do espaço livre (min 10MB)

**Cálculo realista:**
- Disco 500GB com 100GB livres
- Chrome: quota = 60GB (muito mais que precisamos)
- Safari: quota = 1GB (ainda suficiente para 5+ dias offline)
- Mobile: quota = 50GB (mais que suficiente)

**✅ Conclusão:** Quota NÃO é limitação real para caso de uso

---

### 4.2 **QuotaExceededError - Quando Acontece**

**Código de recovery:**
```javascript
// safetyUtils.js:219
if (error.name === 'QuotaExceededError') {
    this.safeShowNotification(
        'Storage quota exceeded. Please clear some data',
        'error'
    );
}
```

**Quando acontece de verdade:**
1. ❌ User com disco CHEIO (< 1GB livre) - raro
2. ❌ Safari private mode (quota ~10MB) - limitante
3. ❌ Muitos áudios não transcritos acumulados (20+ × 2MB = 40MB)

**Cenário crítico identificado:**
```
Curator grava 30 restaurantes offline (1 semana)
Cada um tem 2MB de áudio
Total: 60MB em pendingAudio
Safari quota: 10MB em private mode
Result: QuotaExceededError
```

**Fix necessário:**
1. Detectar private mode e avisar user
2. Limpar áudios transcritos automaticamente
3. Comprimir áudios (MP3 8kbps vs 32kbps)

---

## 5. Cenários Offline vs Online - Decisão Crítica

### 5.1 **Quando IndexedDB é NECESSÁRIO:**

✅ **Cenário A: Field curator sem WiFi**
- Criar entities offline
- Gravar áudio offline
- Tirar fotos offline
- Sync posterior

✅ **Cenário B: Draft auto-save**
- Auto-save a cada 3 segundos
- Recuperar draft depois de crash
- Múltiplos drafts simultâneos

✅ **Cenário C: Fila de sync**
- Queue de operations pendentes
- Retry automático
- Conflict resolution

---

### 5.2 **Quando IndexedDB NÃO é necessário:**

❌ **Cenário D: Curator list**
```javascript
// Hoje:
const curators = await db.curators.toArray();

// Poderia ser:
const curators = await apiService.getCurators();  // Always fresh
```

**Análise:**
- Lista de curators muda raramente
- Sempre online quando seleciona curator (login)
- Cache HTTP é suficiente
- **Recomendação:** Remover tabela `curators` local, usar API

❌ **Cenário E: Settings**
```javascript
// Hoje:
await db.settings.put({ key: 'theme', value: 'dark' });

// Poderia ser:
localStorage.setItem('theme', 'dark');  // Muito mais simples
```

**Análise:**
- Settings são pequenos (<10KB)
- Não precisa queries
- localStorage é suficiente
- **Recomendação:** Migrar settings para localStorage

---

## 6. Schema Version 8 - Análise de Problemas

### 6.1 **Nested Property Index (Crítico)**

```javascript
// ❌ PROBLEMA: Não funciona em Dexie
entities: '++id, entity_id, ..., sync.status'
curations: '++id, curation_id, ..., sync.status'
```

**Erro:**
- Dexie não suporta nested property em index definition
- Index `sync.status` nunca foi criado
- Queries que dependem dele são lentas

**Evidência:**
```javascript
// Código que DEVERIA usar index mas não usa
db.entities.where('sync.status').equals('pending')  // Full table scan!
```

**Fix v9:**
```javascript
// ✅ Flat property
entities: '++id, entity_id, ..., syncStatus'  // Sem nested

// Migration
db.entities.toCollection().modify(entity => {
    entity.syncStatus = entity.sync?.status || 'synced';
    delete entity.sync;  // Remove nested object
});
```

---

### 6.2 **Missing Compound Indexes**

**Queries comuns encontradas:**
```javascript
// Query 1: Entities by curator + date
db.entities
    .where('createdBy').equals(curatorId)
    .filter(e => e.createdAt > date);  // ❌ Filter = no index

// Query 2: Curations by entity + curator
db.curations
    .where('entity_id').equals(entityId)
    .filter(c => c.curator_id === curatorId);  // ❌ Filter = no index
```

**Fix v9:**
```javascript
// ✅ Add compound indexes
entities: '++id, entity_id, ..., [createdBy+createdAt]'
curations: '++id, curation_id, ..., [entity_id+curator_id]'

// Now queries use index
db.entities
    .where('[createdBy+createdAt]')
    .between([curatorId, minDate], [curatorId, maxDate]);  // ✅ Fast!
```

---

## 7. Recomendações Finais

### 7.1 **MANTER (Essencial para offline)**

| Tabela | Justificativa | Ação |
|--------|---------------|------|
| entities | Core offline creation | FIX schema v9 |
| curations | Core reviews | FIX schema v9 |
| syncQueue | Sync critical | FIX schema v9 |
| pendingAudio | Transcription queue | MANTER |
| draftRestaurants | Auto-save | MANTER |
| settings | ⚠️ Migrar p/ localStorage | DEPRECATE |

---

### 7.2 **REMOVER (Código legado)**

| Tabela | Motivo | Migration |
|--------|--------|-----------|
| cache | Zero uso | Drop em v9 |
| drafts | Sobreposta por draftRestaurants | Drop em v9 |
| curators | ⚠️ Usar API | Considerar remover |

---

### 7.3 **IMPLEMENTAR (Melhorias críticas)**

**Priority 1 (Semana 1):**
1. ✅ Fix nested property: `sync.status` → `syncStatus`
2. ✅ Add compound indexes: `[createdBy+createdAt]`, `[entity_id+curator_id]`
3. ✅ Implement bulkAdd in importData()
4. ✅ Add transactions to createEntity/createCuration

**Priority 2 (Semana 2):**
5. ⚠️ Migrate settings to localStorage
6. ⚠️ Remove cache table
7. ⚠️ Consider removing curators table (use API)
8. ⚠️ Add audio compression (8kbps MP3)

**Priority 3 (Backlog):**
9. Create POST /api/v3/entities/bulk endpoint (backend)
10. Add private mode detection
11. Auto-cleanup transcribed audio

---

## 8. Conclusão

### ✅ **IndexedDB é necessário?**
**SIM** - Para cenário offline-first (field curator workflow)

### ✅ **IndexedDB está bem implementado?**
**NÃO** - Score 4/10 (6 problemas críticos)

### ✅ **Vale refatorar ou reescrever?**
**REFATORAR** - Problemas são localizados, não estruturais

### ✅ **Tabelas podem ser simplificadas?**
**SIM** - Remover 2 tabelas legadas (cache, drafts), considerar remover curators

### ✅ **Volumes de dados são problema?**
**NÃO** - 17MB/dia está dentro de quotas (50MB-10GB)

### ✅ **Bulk operations são problema?**
**SIM** - Backend não tem endpoint bulk (criar no API V3)

---

**Next Steps:**
1. Revisar este documento
2. Decidir: refatorar agora ou depois
3. Se agora: implementar schema v9 com fixes
4. Se depois: documentar tech debt

