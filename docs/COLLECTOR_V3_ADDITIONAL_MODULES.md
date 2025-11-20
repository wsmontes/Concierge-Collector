# Collector V3 - Análise de Módulos Adicionais (11-20)

**Data:** 19 de Novembro de 2025  
**Complemento a:** COLLECTOR_V3_FILE_BY_FILE_MAPPING.md

---

## 10. migrationManager.js ❌ DELETAR

**Arquivo:** `scripts/migrationManager.js`  
**Linhas:** ~500 (estimado)  
**Status:** Obsoleto com clean break  
**Prioridade:** 🟢 BAIXA

### Análise

Código de migração V2→V3 que **não é mais necessário** com estratégia de clean break.

### Ação

**DELETAR ou ARQUIVAR:**

```bash
# Opção 1: Arquivar
mv scripts/migrationManager.js archive/old-code/

# Opção 2: Deletar
rm scripts/migrationManager.js

# Remover de index.html
grep -n "migrationManager" index.html
# Comentar ou deletar a linha
```

### Verificar Referências

```bash
# Procurar onde é usado
grep -r "migrationManager\|MigrationManager" scripts/ --exclude-dir=archive
```

**Se encontrar referências:**
- main.js: Remover import e inicialização
- Outros: Remover chamadas de métodos

---

## 11. conceptModule.js

**Arquivo:** `scripts/modules/conceptModule.js`  
**Linhas:** 2331  
**Status:** ⚠️ Precisa verificação de endpoints  
**Prioridade:** 🟡 MÉDIA

### Problemas Encontrados

```javascript
// Linha ~366
restaurantId = entity.id;  // ❌ Deve ser entity.entity_id
```

### Mudanças Necessárias

#### 1. Verificar Endpoint de Concepts

**Buscar:**
```bash
grep -n "concept" scripts/modules/conceptModule.js | grep -i "api\|fetch\|endpoint"
```

**Garantir:**
```javascript
async matchConcepts(concepts) {
    // Usar ApiService V3
    if (!window.ApiService) {
        throw new Error('ApiService not available');
    }
    
    // Endpoint V3: /api/v3/concepts/match
    const result = await window.ApiService.matchConcepts(concepts);
    return result;
}
```

#### 2. Corrigir Uso de IDs

**Localização:** Linha ~366

**ANTES:**
```javascript
restaurantId = entity.id;  // ❌
await window.dataStore.addToSyncQueue('entity', 'update', entity.id, entity.entity_id, entity);
```

**DEPOIS:**
```javascript
restaurantId = entity.entity_id;  // ✅
await window.dataStore.addToSyncQueue('entity', 'update', entity.entity_id, entity.entity_id, entity);
```

#### 3. Atualizar Salvar Concepts

```javascript
async saveConceptsToEntity(entityId, concepts) {
    try {
        const entity = await window.dataStorage.db.entities
            .where('entity_id').equals(entityId)
            .first();
        
        if (!entity) throw new Error('Entity not found');
        
        // Update with V3 structure
        entity.data = entity.data || {};
        entity.data.concepts = concepts;
        entity.version = (entity.version || 0) + 1;
        entity.updatedAt = new Date().toISOString();
        entity.sync = {
            ...entity.sync,
            status: 'pending'
        };
        
        await window.dataStorage.db.entities.put(entity);
        
        this.log.debug('Concepts saved:', entityId);
        return entity;
    } catch (error) {
        this.log.error('Failed to save concepts:', error);
        throw error;
    }
}
```

### Checklist

- [ ] Endpoint `/concepts/match` V3
- [ ] Usa `entity.entity_id` não `.id`
- [ ] Incrementa `version` ao atualizar
- [ ] Marca `sync.status = 'pending'`
- [ ] Error handling adequado

---

## 12. recordingModule.js

**Arquivo:** `scripts/modules/recordingModule.js`  
**Linhas:** 2247  
**Status:** ⚠️ Verificar endpoint de transcrição  
**Prioridade:** 🟡 MÉDIA

### Análise

IDs encontrados no grep são de elementos DOM (`start-record`, `stop-record`) - **OK, não precisa mudança**.

### Mudança Necessária

#### Verificar Transcrição com ApiService V3

**Localização:** Procurar método `transcribeAudio`

**Garantir:**
```javascript
async transcribeAudio(audioBlob) {
    try {
        this.log.debug('Transcribing audio with V3...');
        
        // Verificar ApiService disponível
        if (!window.ApiService || typeof window.ApiService.transcribeAudio !== 'function') {
            throw new Error('ApiService.transcribeAudio not available');
        }
        
        // Chamar endpoint V3: /api/v3/ai/transcribe
        const result = await window.ApiService.transcribeAudio(audioBlob);
        
        if (!result || !result.text) {
            throw new Error('No transcription returned from API');
        }
        
        this.log.debug('Transcription received:', result.text.substring(0, 100) + '...');
        
        return result.text;
        
    } catch (error) {
        this.log.error('Transcription failed:', error);
        
        // User-friendly error
        if (error.message.includes('network') || error.message.includes('fetch')) {
            throw new Error('Network error - check connection');
        } else if (error.message.includes('API key')) {
            throw new Error('API key not configured');
        }
        
        throw error;
    }
}
```

### Checklist

- [ ] Usa `ApiService.transcribeAudio()`
- [ ] Endpoint `/api/v3/ai/transcribe`
- [ ] Error handling com mensagens user-friendly
- [ ] IDs de DOM permanecem inalterados (correto)

---

## 13. transcriptionModule.js

**Arquivo:** `scripts/modules/transcriptionModule.js`  
**Linhas:** ~100  
**Status:** ⚠️ Usa apiHandler direto  
**Prioridade:** 🟡 MÉDIA

### Situação

Módulo usa `apiHandler` para chamadas diretas à OpenAI (não via backend V3).

### Decisão Arquitetural

**Duas opções:**

#### Opção A: Manter apiHandler (Recomendado)

```javascript
/**
 * Extract concepts from transcription
 * Note: Uses direct OpenAI API calls (not V3 backend)
 * This bypasses backend for direct GPT-4 access
 */
async extractConcepts() {
    const transcription = this.uiManager.transcriptionText.textContent.trim();
    
    if (!transcription) {
        this.uiManager.showNotification('No transcription to analyze', 'error');
        return;
    }
    
    try {
        // Direct OpenAI API call
        const translatedText = await apiHandler.translateText(transcription);
        const extractedConcepts = await apiHandler.extractConcepts(
            translatedText,
            promptTemplates.conceptExtraction
        );
        
        // Process results...
    } catch (error) {
        this.log.error('Concept extraction failed:', error);
        throw error;
    }
}
```

**Documentar claramente:**
```javascript
/**
 * File: transcriptionModule.js
 * 
 * IMPORTANT: This module uses direct OpenAI API calls via apiHandler
 * for translation and concept extraction. This is intentional to avoid
 * backend overhead for AI operations.
 * 
 * For entity/curation operations, use ApiService (V3 backend).
 */
```

#### Opção B: Migrar para ApiService V3

**SE** backend V3 tiver endpoints `/ai/translate` e `/ai/extract-concepts`:

```javascript
async extractConcepts() {
    const transcription = this.uiManager.transcriptionText.textContent.trim();
    
    if (!transcription) {
        this.uiManager.showNotification('No transcription to analyze', 'error');
        return;
    }
    
    try {
        if (!window.ApiService) {
            throw new Error('ApiService not available');
        }
        
        // Use V3 backend endpoints
        const result = await window.ApiService.extractConcepts(transcription);
        
        this.uiManager.currentConcepts = result.concepts || [];
        
        // Process results...
    } catch (error) {
        this.log.error('Concept extraction failed:', error);
        throw error;
    }
}
```

### Recomendação

**Opção A** - Manter apiHandler com documentação clara. Chamadas diretas à OpenAI são mais rápidas e não sobrecarregam o backend.

### Checklist

- [ ] Documentar que usa apiHandler direto (intencional)
- [ ] OU migrar para ApiService se endpoints existirem
- [ ] Error handling adequado
- [ ] Logging claro

---

## 14. importManager.js

**Arquivo:** `scripts/importManager.js`  
**Linhas:** 653  
**Status:** ✅ Já adaptado para V3  
**Prioridade:** 🟢 BAIXA

### Análise

Código parece estar correto - usa `DataStore`, `SyncManager`, estrutura V3.

### Verificações Mínimas

#### 1. Sync Button

**Linha ~90:**
```javascript
const syncBtn = document.getElementById('sync-with-server-v3');
if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
        try {
            // ✅ Verificar se usa window.SyncManager correto
            if (!window.SyncManager) {
                throw new Error('SyncManager not available');
            }
            
            await window.SyncManager.fullSync();
            
            SafetyUtils.showNotification('Sync complete', 'success');
        } catch (error) {
            this.log.error('Sync failed:', error);
            SafetyUtils.showNotification(`Sync failed: ${error.message}`, 'error');
        }
    });
}
```

#### 2. Import Format

**Garantir que importa em formato V3:**
```javascript
async importConciergeFile(file) {
    const data = JSON.parse(await file.text());
    
    // Verificar formato
    if (!data.version || data.version < '3.0') {
        throw new Error('Unsupported import format - need V3');
    }
    
    // Importar entities
    for (const entity of data.entities || []) {
        // Validar estrutura V3
        if (!entity.entity_id) {
            entity.entity_id = this.generateUUID();
        }
        if (!entity.version) {
            entity.version = 1;
        }
        if (!entity.sync) {
            entity.sync = {
                serverId: null,
                status: 'pending'
            };
        }
        
        await window.dataStorage.db.entities.put(entity);
    }
    
    // Importar curations
    for (const curation of data.curations || []) {
        if (!curation.curation_id) {
            curation.curation_id = this.generateUUID();
        }
        // ... validações similares
        
        await window.dataStorage.db.curations.put(curation);
    }
}
```

### Checklist

- [ ] Usa `window.SyncManager` V3
- [ ] Import valida formato V3
- [ ] Gera UUIDs se necessário
- [ ] Adiciona campos V3 (version, sync)

---

## 15. apiHandler.js

**Arquivo:** `scripts/apiHandler.js`  
**Linhas:** 339  
**Status:** ⚠️ Código legacy misturado  
**Prioridade:** 🟡 MÉDIA

### Problema

Mistura de:
- Chamadas diretas OpenAI (OK, manter)
- Chamadas ao servidor antigo (deprecated)

### Solução

#### 1. Atualizar Header

```javascript
/**
 * File: apiHandler.js
 * Purpose: Direct API calls to EXTERNAL services (NOT V3 backend)
 * Dependencies: ModuleWrapper, Logger
 * 
 * ⚠️ IMPORTANT: This is NOT the V3 API service layer.
 * 
 * This module handles DIRECT calls to:
 * - OpenAI API (Whisper transcription, GPT-4 completion)
 * - Legacy server endpoints (DEPRECATED - do not use)
 * 
 * For V3 backend operations (entities, curations, sync):
 * ➡️ Use ApiService (scripts/apiService.js)
 * 
 * Architecture:
 * - apiHandler.js → External APIs (OpenAI, etc.)
 * - apiService.js → V3 Backend (FastAPI + MongoDB)
 */
```

#### 2. Deprecar Métodos de Servidor Antigo

**Linhas 26-80:**
```javascript
/**
 * @deprecated Use ApiService.createEntity() for V3 backend
 * Generic POST request to OLD server API (wsmontes.pythonanywhere.com)
 * 
 * WARNING: This endpoint is from the old V2 API and should not be used.
 * Migrate to ApiService for all V3 operations.
 */
async post(endpoint, data) {
    console.warn('⚠️ apiHandler.post() is DEPRECATED');
    console.warn('➡️ Use ApiService for V3 backend operations');
    
    try {
        const response = await fetch(`${this.serverBase}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            mode: 'cors',
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const responseData = await response.json();
        return { success: true, data: responseData };
    } catch (error) {
        console.error('POST request error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * @deprecated Use ApiService.updateEntity() for V3 backend
 */
async put(endpoint, data) {
    console.warn('⚠️ apiHandler.put() is DEPRECATED');
    console.warn('➡️ Use ApiService for V3 backend operations');
    // ... similar implementation
}
```

#### 3. Documentar Métodos OpenAI (Manter)

```javascript
/**
 * Transcribe audio using OpenAI Whisper API
 * 
 * Direct call to OpenAI - does not go through V3 backend.
 * This is intentional for low latency and direct API access.
 * 
 * @param {Blob} audioBlob - Audio file (MP3 recommended)
 * @returns {Promise<string>} - Transcribed text
 */
async transcribeAudio(audioBlob) {
    if (!this.apiKey) {
        throw new Error('OpenAI API key not set');
    }

    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.mp3');
    formData.append('model', 'whisper-1');
    
    // ... implementation
}

/**
 * Extract concepts using OpenAI GPT-4
 * 
 * Direct call to OpenAI - does not go through V3 backend.
 * 
 * @param {string} text - Text to analyze
 * @param {Object} prompt - Prompt template
 * @returns {Promise<Object>} - Extracted concepts
 */
async extractConcepts(text, prompt) {
    // ... implementation
}
```

### Checklist

- [ ] Header documenta escopo claramente
- [ ] Métodos `.post()` e `.put()` marcados @deprecated
- [ ] Warnings em console ao usar métodos deprecated
- [ ] Métodos OpenAI documentados como "direct call"
- [ ] Sem confusão entre apiHandler vs ApiService

---

## 16. V3DataTransformer.js ✅

**Arquivo:** `scripts/services/V3DataTransformer.js`  
**Linhas:** 458  
**Status:** ✅ COMPLETO  
**Prioridade:** N/A

### Conclusão

**Código profissional, testado, sem mudanças necessárias.**

### Uso

```javascript
// Sempre que transformar dados
const localEntity = V3DataTransformer.mongoEntityToLocal(mongoEntity);
const mongoEntity = V3DataTransformer.localEntityToMongo(localEntity);
```

---

## 17. quickActionModule.js

**Arquivo:** `scripts/modules/quickActionModule.js`  
**Linhas:** 317  
**Status:** ⚠️ Verificar criação de entities  
**Prioridade:** 🟡 MÉDIA

### Mudanças Necessárias

#### Quick Add Restaurant

**Localização:** Procurar onde cria novo entity

**Implementar:**
```javascript
async quickAddRestaurant(name, location) {
    try {
        this.log.debug('Quick adding restaurant:', name);
        
        // Build V3 entity
        const entity = {
            entity_id: this.generateUUID(),
            type: 'restaurant',
            name: name || 'Quick Add',
            status: 'draft',  // Quick adds start as drafts
            
            data: {
                location: location ? {
                    coordinates: {
                        lat: location.latitude,
                        lng: location.longitude
                    },
                    capturedAt: new Date().toISOString()
                } : {},
                
                source: 'quick_add',
                quickAddTimestamp: new Date().toISOString()
            },
            
            metadata: [{
                source: 'quick_add',
                method: 'manual',
                createdAt: new Date().toISOString(),
                curator: {
                    id: this.uiManager.currentCurator?.id,
                    name: this.uiManager.currentCurator?.name
                }
            }],
            
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdBy: this.uiManager.currentCurator?.id || 'system',
            updatedBy: this.uiManager.currentCurator?.id || 'system',
            
            sync: {
                serverId: null,
                status: 'pending',
                lastSyncedAt: null
            }
        };
        
        // Save to IndexedDB
        await window.dataStorage.db.entities.put(entity);
        
        this.log.debug('Quick add saved:', entity.entity_id);
        
        // Show notification
        if (window.SafetyUtils) {
            window.SafetyUtils.showNotification(
                `${name} added - will be synced`,
                'success'
            );
        }
        
        // Close modal
        if (this.uiManager.quickActionModal) {
            this.uiManager.quickActionModal.classList.add('hidden');
        }
        
        // Refresh entity list if available
        if (window.entityModule && typeof window.entityModule.refresh === 'function') {
            await window.entityModule.refresh();
        }
        
        return entity;
        
    } catch (error) {
        this.log.error('Quick add failed:', error);
        
        if (window.SafetyUtils) {
            window.SafetyUtils.showNotification(
                `Failed to add restaurant: ${error.message}`,
                'error'
            );
        }
        
        throw error;
    }
}

/**
 * Generate UUID v4
 */
generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
```

### Checklist

- [ ] Quick add cria entity V3 completa
- [ ] Entity tem `entity_id` UUID
- [ ] Entity tem campo `version`
- [ ] Entity tem `status: 'draft'`
- [ ] Entity marcada `sync.status: 'pending'`
- [ ] Notificações user-friendly

---

## 18. draftRestaurantManager.js

**Arquivo:** `scripts/modules/draftRestaurantManager.js`  
**Linhas:** 353  
**Status:** ⚠️ Usa store que pode não existir  
**Prioridade:** 🟡 MÉDIA

### Problema

Código usa `this.dataStorage.db.draftRestaurants` mas esse store pode não existir no schema V3.

### Soluções

#### Opção A: Adicionar Store draftRestaurants

**Em dataStorage.js:**
```javascript
this.db.version(1).stores({
    entities: `entity_id, type, name, status, ...`,
    curations: `curation_id, entity_id, ...`,
    
    // Add drafts store
    draftRestaurants: `
        ++id,
        curatorId,
        timestamp,
        lastModified,
        hasAudio
    `,
    
    sync_metadata: `key, value, updatedAt`,
    settings: `key, value`
});
```

#### Opção B: Usar Entities com status='draft' (Recomendado)

**Substituir draftRestaurantManager por:**
```javascript
/**
 * Draft Restaurant Manager - V3 Version
 * Uses entities table with status='draft' instead of separate store
 */
const DraftRestaurantManager = ModuleWrapper.defineClass('DraftRestaurantManager', class {
    constructor() {
        this.log = Logger.module('DraftRestaurantManager');
        this.dataStorage = null;
    }

    init(dataStorage) {
        this.dataStorage = dataStorage;
        this.log.debug('DraftRestaurantManager initialized (V3 mode)');
    }

    /**
     * Create a new draft entity
     */
    async createDraft(curatorId, data = {}) {
        try {
            const entity = {
                entity_id: this.generateUUID(),
                type: 'restaurant',
                name: data.name || 'Draft',
                status: 'draft',  // ← Key difference
                
                data: {
                    transcription: data.transcription || '',
                    description: data.description || '',
                    concepts: data.concepts || [],
                    location: data.location || null,
                    photos: data.photos || [],
                    hasAudio: data.hasAudio || false
                },
                
                metadata: [{
                    source: 'draft',
                    createdAt: new Date().toISOString()
                }],
                
                version: 1,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdBy: curatorId,
                updatedBy: curatorId,
                
                sync: {
                    serverId: null,
                    status: 'local',  // Don't sync drafts
                    lastSyncedAt: null
                }
            };

            await this.dataStorage.db.entities.put(entity);
            
            this.log.debug('Draft created:', entity.entity_id);
            return entity.entity_id;
            
        } catch (error) {
            this.log.error('Error creating draft:', error);
            throw error;
        }
    }

    /**
     * Get draft by ID
     */
    async getDraft(entityId) {
        try {
            const entity = await this.dataStorage.db.entities
                .where('entity_id').equals(entityId)
                .first();
            
            if (!entity || entity.status !== 'draft') {
                return null;
            }
            
            return entity;
        } catch (error) {
            this.log.error('Error getting draft:', error);
            throw error;
        }
    }

    /**
     * List all drafts for curator
     */
    async listDrafts(curatorId) {
        try {
            const drafts = await this.dataStorage.db.entities
                .where('status').equals('draft')
                .filter(e => e.createdBy === curatorId)
                .toArray();
            
            return drafts;
        } catch (error) {
            this.log.error('Error listing drafts:', error);
            throw error;
        }
    }

    /**
     * Update draft
     */
    async updateDraft(entityId, updates) {
        try {
            const entity = await this.getDraft(entityId);
            if (!entity) {
                throw new Error('Draft not found');
            }
            
            // Merge updates
            entity.data = {
                ...entity.data,
                ...updates
            };
            entity.updatedAt = new Date().toISOString();
            
            await this.dataStorage.db.entities.put(entity);
            
            this.log.debug('Draft updated:', entityId);
            return entity;
        } catch (error) {
            this.log.error('Error updating draft:', error);
            throw error;
        }
    }

    /**
     * Delete draft
     */
    async deleteDraft(entityId) {
        try {
            const entity = await this.getDraft(entityId);
            if (!entity) {
                throw new Error('Draft not found');
            }
            
            await this.dataStorage.db.entities.delete(entity.id);
            
            this.log.debug('Draft deleted:', entityId);
        } catch (error) {
            this.log.error('Error deleting draft:', error);
            throw error;
        }
    }

    /**
     * Promote draft to active
     */
    async promoteDraft(entityId) {
        try {
            const entity = await this.getDraft(entityId);
            if (!entity) {
                throw new Error('Draft not found');
            }
            
            // Change status
            entity.status = 'active';
            entity.updatedAt = new Date().toISOString();
            entity.sync.status = 'pending';  // Now sync it
            
            await this.dataStorage.db.entities.put(entity);
            
            this.log.debug('Draft promoted to active:', entityId);
            return entity;
        } catch (error) {
            this.log.error('Error promoting draft:', error);
            throw error;
        }
    }

    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
});
```

### Recomendação

**Opção B** - Usar entities com `status='draft'`. Mais simples, menos stores, aproveita infraestrutura existente.

### Checklist

- [ ] Drafts usam store `entities`
- [ ] Drafts têm `status: 'draft'`
- [ ] Drafts têm `sync.status: 'local'` (não sincronizar)
- [ ] Método `promoteDraft()` muda para active
- [ ] Queries filtram por `status='draft'`

---

## 19. exportImportModule.js

**Arquivo:** `scripts/modules/exportImportModule.js`  
**Linhas:** ~1800  
**Status:** ⚠️ Usa `.id` numérico  
**Prioridade:** 🟡 MÉDIA

### Problema

Múltiplas referências a `restaurant.id`, `concept.id`, `curator.id` numéricos.

### Localização de Mudanças

**Grep encontrou:**
- Linha 268: `restaurant.id`
- Linha 1387: `restaurant.id`
- Linha 1398: `String(restaurant.id)`
- Linha 1829: `restaurant.id`
- Linha 1831: `String(restaurant.id)`

### Padrão de Mudança

**ANTES:**
```javascript
// Linha 268
const restaurantConcepts = conceptsByRestaurant.get(restaurant.id) || [];

// Linha 1387
if (!restaurant || restaurant.id === undefined) continue;

// Linha 1398
const restId = String(restaurant.id);
```

**DEPOIS:**
```javascript
// Usar entity_id (UUID)
const restaurantConcepts = conceptsByRestaurant.get(restaurant.entity_id) || [];

// Verificar entity_id existe
if (!restaurant || !restaurant.entity_id) continue;

// entity_id já é string (UUID)
const restId = restaurant.entity_id;
```

### Export Format V3

```javascript
async exportData() {
    try {
        this.log.debug('Exporting V3 data...');
        
        // Get all data
        const entities = await window.dataStorage.db.entities.toArray();
        const curations = await window.dataStorage.db.curations.toArray();
        
        // Build export object
        const exportData = {
            version: '3.0',
            exportedAt: new Date().toISOString(),
            exportedBy: window.uiManager?.currentCurator?.name || 'unknown',
            
            entities: entities.map(e => ({
                entity_id: e.entity_id,
                type: e.type,
                name: e.name,
                status: e.status,
                externalId: e.externalId,
                data: e.data,
                metadata: e.metadata,
                version: e.version,
                createdAt: e.createdAt,
                updatedAt: e.updatedAt,
                createdBy: e.createdBy,
                updatedBy: e.updatedBy
                // Omit sync info (local only)
            })),
            
            curations: curations.map(c => ({
                curation_id: c.curation_id,
                entity_id: c.entity_id,
                curator: c.curator,
                data: c.data,
                metadata: c.metadata,
                version: c.version,
                createdAt: c.createdAt,
                updatedAt: c.updatedAt
            })),
            
            stats: {
                totalEntities: entities.length,
                totalCurations: curations.length,
                entityTypes: this.countByType(entities)
            }
        };
        
        // Create blob and download
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: 'application/json'
        });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `concierge-export-v3-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.log.debug('Export complete');
        
        if (window.SafetyUtils) {
            window.SafetyUtils.showNotification(
                `Exported ${entities.length} entities and ${curations.length} curations`,
                'success'
            );
        }
        
    } catch (error) {
        this.log.error('Export failed:', error);
        throw error;
    }
}

countByType(entities) {
    const counts = {};
    for (const entity of entities) {
        counts[entity.type] = (counts[entity.type] || 0) + 1;
    }
    return counts;
}
```

### Checklist

- [ ] Todas refs `restaurant.id` → `restaurant.entity_id`
- [ ] Todas refs `curation.id` → `curation.curation_id`
- [ ] Export usa formato V3
- [ ] Import valida `version: '3.0'`
- [ ] Map keys usam UUIDs não numéricos

---

## 20. dataStore.js vs dataStorage.js

**Arquivos:** `scripts/dataStore.js` e `scripts/dataStorage.js`  
**Status:** ❓ Possível conflito de nomes  
**Prioridade:** 🔴 ALTA

### Investigação Necessária

```bash
# Verificar se ambos existem
ls -la scripts/dataStore.js
ls -la scripts/dataStorage.js

# Comparar
diff scripts/dataStore.js scripts/dataStorage.js

# Ver tamanhos
wc -l scripts/dataStore.js scripts/dataStorage.js
```

### Cenários Possíveis

#### Cenário A: São Arquivos Diferentes

**Se ambos existem e são diferentes:**

**DECISÃO:** Consolidar em apenas UM arquivo.

**Recomendação:** Manter `dataStorage.js` (maior, mais completo).

**Ações:**
1. Backup de dataStore.js
2. Migrar funcionalidades únicas de dataStore.js para dataStorage.js
3. Deletar dataStore.js
4. Atualizar todas referências:
   ```javascript
   // Padronizar para:
   window.dataStorage  // ✅ Usar este
   
   // Remover:
   window.DataStore    // ❌
   window.dataStore    // ❌
   ```

#### Cenário B: dataStore.js é Alias

**Se dataStore.js apenas cria alias:**

```javascript
// dataStore.js
window.DataStore = window.dataStorage;
window.dataStore = window.dataStorage;
```

**MANTER** mas documentar claramente:

```javascript
/**
 * File: dataStore.js
 * Purpose: Alias/wrapper for dataStorage.js (backward compatibility)
 * 
 * IMPORTANT: This file only creates aliases.
 * All actual data operations are in dataStorage.js
 * 
 * Aliases:
 * - window.DataStore → window.dataStorage
 * - window.dataStore → window.dataStorage
 * 
 * TODO: Eventually deprecate aliases and use only window.dataStorage
 */

if (!window.dataStorage) {
    console.error('❌ dataStorage not loaded - dataStore aliases will not work');
} else {
    window.DataStore = window.dataStorage;
    window.dataStore = window.dataStorage;
    console.log('✅ DataStore aliases created');
}
```

#### Cenário C: Apenas Um Existe

**Se apenas dataStorage.js existe:**

Ótimo! Nada a fazer. Apenas garantir que todas referências usam:
```javascript
window.dataStorage  // Consistente em todo código
```

### Ações Recomendadas

1. **Investigar:**
   ```bash
   # Ver se arquivo existe
   [ -f scripts/dataStore.js ] && echo "EXISTS" || echo "NOT FOUND"
   
   # Se existe, ver conteúdo
   head -50 scripts/dataStore.js
   ```

2. **Padronizar Referências:**
   ```bash
   # Encontrar todas as variações
   grep -r "window\.dataStore\|window\.DataStore\|window\.dataStorage" scripts/ \
     --exclude-dir=archive \
     | wc -l
   ```

3. **Decisão:**
   - Se dataStore.js é alias simples → Manter com documentação
   - Se dataStore.js tem código significativo → Consolidar
   - Se dataStore.js não existe → Perfeito, usar apenas dataStorage.js

### Checklist

- [ ] Verificar existência de ambos arquivos
- [ ] Identificar relacionamento (duplicado/alias/único)
- [ ] Padronizar todas referências no código
- [ ] Documentar decisão arquitetural
- [ ] Remover arquivos duplicados se aplicável

---

## 📊 Resumo Final

### Matriz de Prioridades

| # | Arquivo | Status | Ação | Prioridade | Tempo |
|---|---------|--------|------|------------|-------|
| 10 | migrationManager.js | ❌ Obsoleto | Deletar | 🟢 BAIXA | 10min |
| 11 | conceptModule.js | ⚠️ IDs | Corrigir | 🟡 MÉDIA | 30min |
| 12 | recordingModule.js | ⚠️ Endpoint | Verificar | 🟡 MÉDIA | 20min |
| 13 | transcriptionModule.js | ⚠️ ApiHandler | Documentar | 🟡 MÉDIA | 15min |
| 14 | importManager.js | ✅ OK | Verificar | 🟢 BAIXA | 10min |
| 15 | apiHandler.js | ⚠️ Legacy | Deprecar | 🟡 MÉDIA | 30min |
| 16 | V3DataTransformer.js | ✅ OK | Nada | ✅ N/A | 0min |
| 17 | quickActionModule.js | ⚠️ Structure | Implementar | 🟡 MÉDIA | 45min |
| 18 | draftRestaurantManager.js | ⚠️ Store | Refatorar | 🟡 MÉDIA | 1h |
| 19 | exportImportModule.js | ⚠️ IDs | Corrigir | 🟡 MÉDIA | 1h |
| 20 | dataStore.js | ❓ Conflito | Investigar | 🔴 ALTA | 30min |

**TOTAL ESTIMADO:** ~5 horas

---

## 🎯 Ordem de Implementação Sugerida

### Dia 1 - Investigação (30min)
1. ✅ dataStore.js vs dataStorage.js - Resolver conflito

### Dia 2 - Limpeza (1h)
2. ❌ migrationManager.js - Deletar
3. ⚠️ apiHandler.js - Deprecar métodos antigos

### Dia 3 - Correções Core (2.5h)
4. ⚠️ conceptModule.js - Corrigir IDs
5. ⚠️ exportImportModule.js - Corrigir IDs
6. ⚠️ draftRestaurantManager.js - Refatorar para usar entities

### Dia 4 - Features (1.5h)
7. ⚠️ recordingModule.js - Verificar endpoint
8. ⚠️ transcriptionModule.js - Documentar
9. ⚠️ quickActionModule.js - Implementar V3

### Dia 5 - Verificações (30min)
10. ✅ importManager.js - Verificar
11. ✅ V3DataTransformer.js - Nada

---

**Este documento complementa COLLECTOR_V3_FILE_BY_FILE_MAPPING.md**
