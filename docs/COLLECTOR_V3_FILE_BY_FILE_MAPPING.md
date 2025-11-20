# Collector V3 - Mapeamento Arquivo por Arquivo

**Data:** 19 de Novembro de 2025  
**Objetivo:** Documentar TODAS as mudanças necessárias em cada arquivo para completar a migração V3

---

## 📋 Índice de Arquivos

### Prioridade CRÍTICA (Implementar Primeiro)
1. [dataStorage.js](#1-datastoragejs) - Database reset logic
2. [main.js](#2-mainjs) - SyncManager initialization
3. [syncManagerV3.js](#3-syncmanagerv3js) - Verificar integração

### Prioridade ALTA (Módulos Core)
4. [entityModule.js](#4-entitymodulejs) - UI de entities
5. [curatorModule.js](#5-curatormodulejs) - Curations
6. [syncStatusModule.js](#6-syncstatusmodulejs) - UI de sync status

### Prioridade MÉDIA (Features)
7. [placesModule.js](#7-placesmodulejs) - Google Places integration
8. [conceptModule.js](#8-conceptmodulejs) - Concept matching
9. [recordingModule.js](#9-recordingmodulejs) - Audio transcription

### Prioridade BAIXA (Utilities)
10. [migrationManager.js](#10-migrationmanagerjs) - DELETAR (não necessário)
11. [conceptModule.js](#11-conceptmodulejs) - Verificar endpoint V3
12. [recordingModule.js](#12-recordingmodulejs) - Verificar endpoint V3
13. [transcriptionModule.js](#13-transcriptionmodulejs) - Verificar integração
14. [importManager.js](#14-importmanagerjs) - Já V3, verificar
15. [apiHandler.js](#15-apihandlerjs) - Limpar legacy
16. [V3DataTransformer.js](#16-v3datatransformerjs) - ✅ OK
17. [quickActionModule.js](#17-quickactionmodulejs) - Verificar entity V3
18. [draftRestaurantManager.js](#18-draftrestaurantmanagerjs) - Verificar stores
19. [exportImportModule.js](#19-exportimportmodulejs) - Atualizar para V3
20. [dataStore.js](#20-datastorejs) - Verificar vs dataStorage.js

---

## 1. dataStorage.js

**Arquivo:** `scripts/dataStorage.js`  
**Linhas:** 3168  
**Status:** ⚠️ Parcialmente V3 - Precisa force reset  
**Prioridade:** 🔴 CRÍTICA

### Situação Atual

```javascript
// Linhas 42-68 - ATUAL
initializeDatabase() {
    const expectedSchemaVersion = 'v3.0';
    const currentSchemaVersion = localStorage.getItem('dbSchemaVersion');
    
    if (currentSchemaVersion !== expectedSchemaVersion) {
        // Delete old databases
        Dexie.delete('ConciergeCollector').catch(() => {});
        Dexie.delete('ConciergeCollectorV3').catch(() => {});
        
        localStorage.removeItem('v3MigrationComplete');
        localStorage.setItem('dbSchemaVersion', expectedSchemaVersion);
    }
    
    this.db = new Dexie(AppConfig.database.name);
    // ... schema definition
}
```

### ✅ Mudanças Necessárias

#### 1.1. Force Reset Mais Agressivo

**Localização:** Linha ~42 (método `initializeDatabase`)

**ANTES:**
```javascript
const expectedSchemaVersion = 'v3.0';
const currentSchemaVersion = localStorage.getItem('dbSchemaVersion');

if (currentSchemaVersion !== expectedSchemaVersion) {
    // Delete parcial
}
```

**DEPOIS:**
```javascript
// FORCE RESET - Clean break strategy
const SCHEMA_VERSION = 'v3.0-clean-break';
const storedVersion = localStorage.getItem('dbSchemaVersion');

if (storedVersion !== SCHEMA_VERSION) {
    this.log.warn('🧹 CLEAN BREAK: Resetting all local data...');
    
    // Delete ALL possible database names
    const dbNames = [
        'ConciergeCollector',
        'ConciergeCollectorV3',
        'concierge-collector',
        'concierge_collector'
    ];
    
    for (const dbName of dbNames) {
        try {
            await Dexie.delete(dbName);
            this.log.debug(`✅ Deleted database: ${dbName}`);
        } catch (e) {
            this.log.debug(`No database named ${dbName}`);
        }
    }
    
    // Clear ALL V2-related localStorage
    const keysToRemove = [
        'v3MigrationComplete',
        'lastSync',
        'syncMetadata',
        'migrationStatus',
        'dbSchemaVersion'  // Will be set to new value below
    ];
    
    keysToRemove.forEach(key => {
        localStorage.removeItem(key);
    });
    
    // Set new schema version
    localStorage.setItem('dbSchemaVersion', SCHEMA_VERSION);
    
    this.log.warn('✅ Clean break complete - starting fresh with V3');
    
    // Show user notification (optional)
    if (window.SafetyUtils && typeof window.SafetyUtils.showNotification === 'function') {
        window.SafetyUtils.showNotification(
            'Database upgraded to V3 - syncing data from server...',
            'info',
            3000
        );
    }
}
```

#### 1.2. Remover Código de Migração V2→V3

**Localização:** Procurar por funções de migração (se existirem)

**DELETAR:**
- Qualquer função `migrateFromV2()`
- Qualquer função `convertV2ToV3()`
- Checks de compatibilidade V2
- Código que tenta preservar dados antigos

**Exemplo de busca:**
```bash
grep -n "migrateFromV2\|convertV2\|v2Migration" scripts/dataStorage.js
```

#### 1.3. Simplificar Schema Definition

**Verificar:** Linhas 76-100 (definição de stores)

**GARANTIR:**
```javascript
// Version 1: V3 ONLY - No compatibility layers
this.db.version(1).stores({
    entities: `
        entity_id,
        type,
        name,
        status,
        externalId,
        version,
        [sync.status],
        updatedAt,
        createdAt
    `,
    
    curations: `
        curation_id,
        entity_id,
        [curator.id],
        [entity_id+curator.id],
        version,
        [sync.status],
        updatedAt,
        createdAt
    `,
    
    // Sync metadata
    sync_metadata: `
        key,
        value,
        updatedAt
    `,
    
    // Settings
    settings: `
        key,
        value
    `
});
```

**REMOVER:**
- Versões antigas do schema (version 2, 3, etc.)
- Upgrade hooks entre versões
- Compatibilidade com campos V2

### 🎯 Resultado Esperado

Após mudanças:
1. ✅ Qualquer versão != 'v3.0-clean-break' força reset total
2. ✅ Todos os databases antigos deletados
3. ✅ localStorage limpo de valores V2
4. ✅ Schema V3 puro, sem legacy
5. ✅ Notificação ao usuário sobre upgrade

---

## 2. main.js

**Arquivo:** `scripts/main.js`  
**Linhas:** 1141  
**Status:** ⚠️ Integração parcial do SyncManager  
**Prioridade:** 🔴 CRÍTICA

### Situação Atual

```javascript
// Linha 430-434 - ATUAL
if (window.SyncManagerV3) {
    console.log('🔄 V3: Initializing SyncManagerV3...');
    window.SyncManager = new window.SyncManagerV3();
    await window.SyncManager.initialize();
}
```

### ✅ Mudanças Necessárias

#### 2.1. Garantir Inicialização do SyncManager

**Localização:** Linha ~430 (função `initializeApp`)

**VERIFICAR E CORRIGIR:**
```javascript
// Initialize V3 SyncManager
async function initializeSyncManager() {
    try {
        if (!window.SyncManagerV3) {
            console.error('❌ SyncManagerV3 class not loaded');
            throw new Error('SyncManagerV3 not available');
        }
        
        console.log('🔄 Initializing SyncManagerV3...');
        window.SyncManager = new window.SyncManagerV3();
        await window.SyncManager.initialize();
        
        console.log('✅ SyncManagerV3 initialized successfully');
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize SyncManagerV3:', error);
        // Non-fatal - app can work offline
        return false;
    }
}

// Call it in initializeApp
await initializeSyncManager();
```

#### 2.2. Implementar Auto-Sync Após Reset

**Localização:** Adicionar após inicialização completa

**ADICIONAR:**
```javascript
/**
 * Trigger initial sync after database reset
 */
async function triggerInitialSync() {
    try {
        // Check if this is a fresh database (reset scenario)
        const lastSync = localStorage.getItem('lastSyncTimestamp');
        const schemaVersion = localStorage.getItem('dbSchemaVersion');
        
        if (schemaVersion === 'v3.0-clean-break' && !lastSync) {
            console.log('🔄 Fresh database detected - triggering initial sync...');
            
            if (window.SyncManager && typeof window.SyncManager.fullSync === 'function') {
                // Show loading indicator
                if (window.SafetyUtils) {
                    window.SafetyUtils.showNotification(
                        'Syncing data from server...',
                        'info',
                        0  // No auto-dismiss
                    );
                }
                
                // Perform full sync
                await window.SyncManager.fullSync();
                
                // Mark first sync complete
                localStorage.setItem('lastSyncTimestamp', new Date().toISOString());
                
                console.log('✅ Initial sync complete');
                
                // Dismiss notification
                if (window.SafetyUtils) {
                    window.SafetyUtils.showNotification(
                        'Data synced successfully!',
                        'success',
                        2000
                    );
                }
                
                // Refresh UI if needed
                if (window.entityModule && typeof window.entityModule.refresh === 'function') {
                    await window.entityModule.refresh();
                }
            }
        }
    } catch (error) {
        console.error('❌ Initial sync failed:', error);
        // Non-fatal - user can sync manually
        if (window.SafetyUtils) {
            window.SafetyUtils.showNotification(
                'Initial sync failed - you can sync manually',
                'warning',
                3000
            );
        }
    }
}
```

#### 2.3. Limpar Referências a syncManager Antigo

**Localização:** Linhas 586-611 (manual sync button)

**SIMPLIFICAR:**
```javascript
// Setup manual sync button
function setupManualSyncButton() {
    const syncButton = document.getElementById('manual-sync-btn');
    if (!syncButton) return;
    
    syncButton.addEventListener('click', async () => {
        try {
            syncButton.disabled = true;
            syncButton.classList.add('opacity-50', 'cursor-not-allowed');
            
            // Use V3 SyncManager only
            if (!window.SyncManager) {
                throw new Error('SyncManager not available');
            }
            
            console.log('🔄 Starting manual sync...');
            const result = await window.SyncManager.fullSync();
            
            console.log('✅ Manual sync complete:', result);
            
            // Show success notification
            if (window.SafetyUtils) {
                window.SafetyUtils.showNotification(
                    `Sync complete: ${result.entitiesPulled} entities, ${result.curationsPulled} curations`,
                    'success',
                    3000
                );
            }
            
            // Refresh UI
            if (window.entityModule) {
                await window.entityModule.refresh();
            }
            
        } catch (error) {
            console.error('❌ Manual sync failed:', error);
            
            if (window.SafetyUtils) {
                window.SafetyUtils.showNotification(
                    `Sync failed: ${error.message}`,
                    'error',
                    3000
                );
            }
        } finally {
            syncButton.disabled = false;
            syncButton.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    });
}
```

**REMOVER:**
- Referências a `window.V3SyncManager` (usar apenas `window.SyncManager`)
- Fallbacks para `syncManager.performComprehensiveSync` (legado)
- Lógica condicional entre V2 e V3

### 🎯 Resultado Esperado

Após mudanças:
1. ✅ SyncManager V3 inicializado corretamente
2. ✅ Auto-sync após database reset
3. ✅ Sync manual funcionando
4. ✅ Sem referências a código legado

---

## 3. syncManagerV3.js

**Arquivo:** `scripts/syncManagerV3.js`  
**Linhas:** 685  
**Status:** ✅ Implementado mas não testado  
**Prioridade:** 🔴 CRÍTICA

### Situação Atual

Código parece completo, mas precisa verificação de integração.

### ✅ Mudanças Necessárias

#### 3.1. Verificar Dependências

**Localização:** Linha ~47 (método `initialize`)

**VERIFICAR:**
```javascript
async initialize() {
    this.log.debug('Initializing SyncManagerV3...');
    
    // Check dependencies
    if (!window.DataStore && !window.dataStorage) {
        throw new Error('DataStore/dataStorage not available');
    }
    
    if (!window.ApiService) {
        throw new Error('ApiService not available');
    }
    
    // Use the correct reference
    this.dataStore = window.DataStore || window.dataStorage;
    this.apiService = window.ApiService;
    
    // ... rest of initialization
}
```

#### 3.2. Adicionar Método getSyncStatus

**Localização:** Adicionar novo método

**ADICIONAR:**
```javascript
/**
 * Get current sync status (for UI display)
 */
async getSyncStatus() {
    try {
        // Count pending items
        const pendingEntities = await this.dataStore.db.entities
            .where('sync.status').equals('pending')
            .count();
        
        const pendingCurations = await this.dataStore.db.curations
            .where('sync.status').equals('pending')
            .count();
        
        // Count conflicts
        const conflictEntities = await this.dataStore.db.entities
            .where('sync.status').equals('conflict')
            .count();
        
        const conflictCurations = await this.dataStore.db.curations
            .where('sync.status').equals('conflict')
            .count();
        
        return {
            isOnline: this.isOnline,
            isSyncing: this.isSyncing,
            pendingCount: pendingEntities + pendingCurations,
            conflictCount: conflictEntities + conflictCurations,
            lastPullAt: this.stats.lastPullAt,
            lastPushAt: this.stats.lastPushAt,
            stats: { ...this.stats }
        };
    } catch (error) {
        this.log.error('Failed to get sync status:', error);
        return null;
    }
}
```

#### 3.3. Melhorar Error Handling

**Localização:** Métodos `pullEntities` e `pushEntities`

**ADICIONAR try-catch mais robusto:**
```javascript
async pullEntities() {
    try {
        this.log.debug('⬇️ Pulling entities from server...');
        
        // Check if ApiService is available
        if (!this.apiService || typeof this.apiService.listEntities !== 'function') {
            throw new Error('ApiService.listEntities not available');
        }
        
        // ... resto do código
        
    } catch (error) {
        this.log.error('Failed to pull entities:', error);
        
        // Provide user-friendly error message
        const message = error.message || 'Unknown error';
        
        if (message.includes('network') || message.includes('fetch')) {
            this.log.warn('Network error during pull - will retry later');
        } else {
            this.log.error('Sync error:', message);
        }
        
        throw error;
    }
}
```

### 🎯 Resultado Esperado

Após mudanças:
1. ✅ Dependências verificadas corretamente
2. ✅ Método getSyncStatus disponível para UI
3. ✅ Error handling robusto
4. ✅ Logs claros para debugging

---

## 4. entityModule.js

**Arquivo:** `scripts/modules/entityModule.js`  
**Linhas:** 594  
**Status:** ⚠️ Funcional mas sem UI V3  
**Prioridade:** 🔴 ALTA

### Situação Atual

Módulo exibe entities mas não mostra:
- Version badge
- Sync status (synced/pending/conflict)
- Conflict resolution UI

### ✅ Mudanças Necessárias

#### 4.1. Adicionar Version e Sync Status Badges

**Localização:** Método que renderiza entity cards (procurar por `renderEntityCard` ou similar)

**ADICIONAR:**
```javascript
/**
 * Render entity card with V3 features
 */
renderEntityCard(entity) {
    // Extract sync status
    const syncStatus = entity.sync?.status || 'unknown';
    const version = entity.version || 0;
    
    // Sync status badge
    let syncBadge = '';
    switch (syncStatus) {
        case 'synced':
            syncBadge = `
                <span class="inline-flex items-center gap-1 px-2 py-1 text-xs bg-green-100 text-green-800 rounded">
                    <span class="material-icons text-xs">cloud_done</span>
                    Synced
                </span>
            `;
            break;
        case 'pending':
            syncBadge = `
                <span class="inline-flex items-center gap-1 px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded">
                    <span class="material-icons text-xs">cloud_upload</span>
                    Pending
                </span>
            `;
            break;
        case 'conflict':
            syncBadge = `
                <span class="inline-flex items-center gap-1 px-2 py-1 text-xs bg-red-100 text-red-800 rounded cursor-pointer"
                      onclick="entityModule.resolveConflict('${entity.entity_id}')">
                    <span class="material-icons text-xs">warning</span>
                    Conflict - Click to resolve
                </span>
            `;
            break;
        default:
            syncBadge = `
                <span class="inline-flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded">
                    <span class="material-icons text-xs">cloud_off</span>
                    Local
                </span>
            `;
    }
    
    // Version badge
    const versionBadge = `
        <span class="text-xs text-gray-500" title="Version for optimistic locking">
            v${version}
        </span>
    `;
    
    // Build card HTML
    return `
        <div class="entity-card p-4 border rounded-lg hover:shadow-md transition-shadow" 
             data-entity-id="${entity.entity_id}">
            
            <!-- Header with badges -->
            <div class="flex items-start justify-between mb-2">
                <h3 class="font-semibold text-lg">${entity.name || 'Unnamed'}</h3>
                <div class="flex items-center gap-2">
                    ${versionBadge}
                    ${syncBadge}
                </div>
            </div>
            
            <!-- Entity details -->
            <div class="text-sm text-gray-600">
                <p>${entity.data?.location?.city || 'Unknown city'}</p>
                <p class="text-xs text-gray-400">${entity.type}</p>
            </div>
            
            <!-- Actions -->
            <div class="mt-3 flex gap-2">
                <button onclick="entityModule.viewEntity('${entity.entity_id}')" 
                        class="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                    View
                </button>
                <button onclick="entityModule.editEntity('${entity.entity_id}')" 
                        class="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
                    Edit
                </button>
            </div>
        </div>
    `;
}
```

#### 4.2. Implementar Conflict Resolution UI

**Localização:** Adicionar novo método

**ADICIONAR:**
```javascript
/**
 * Resolve conflict between local and server version
 */
async resolveConflict(entityId) {
    try {
        this.log.debug('Resolving conflict for entity:', entityId);
        
        // Get local entity
        const localEntity = await this.dataStore.getEntity(entityId);
        if (!localEntity) {
            throw new Error('Local entity not found');
        }
        
        // Fetch server version
        let serverEntity = null;
        try {
            serverEntity = await window.ApiService.getEntity(entityId);
        } catch (error) {
            this.log.warn('Could not fetch server version:', error);
        }
        
        // Show modal to choose version
        this.showConflictResolutionModal(localEntity, serverEntity);
        
    } catch (error) {
        this.log.error('Failed to resolve conflict:', error);
        if (window.SafetyUtils) {
            window.SafetyUtils.showNotification(
                `Error resolving conflict: ${error.message}`,
                'error'
            );
        }
    }
}

/**
 * Show modal for user to choose which version to keep
 */
showConflictResolutionModal(localEntity, serverEntity) {
    // Create modal
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <h2 class="text-2xl font-bold mb-4 flex items-center gap-2">
                <span class="material-icons text-red-600">warning</span>
                Resolve Conflict: ${localEntity.name}
            </h2>
            
            <p class="text-gray-600 mb-6">
                This entity was modified both locally and on the server. Choose which version to keep:
            </p>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <!-- Local Version -->
                <div class="border-2 border-blue-500 rounded-lg p-4">
                    <h3 class="font-bold text-lg mb-2 text-blue-600">Local Version</h3>
                    <div class="text-sm space-y-1">
                        <p><strong>Name:</strong> ${localEntity.name}</p>
                        <p><strong>Version:</strong> ${localEntity.version}</p>
                        <p><strong>Modified:</strong> ${new Date(localEntity.updatedAt).toLocaleString()}</p>
                        <p><strong>City:</strong> ${localEntity.data?.location?.city || 'N/A'}</p>
                    </div>
                    <button id="keep-local" 
                            class="mt-4 w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                        Keep Local Version
                    </button>
                </div>
                
                <!-- Server Version -->
                <div class="border-2 border-green-500 rounded-lg p-4">
                    <h3 class="font-bold text-lg mb-2 text-green-600">Server Version</h3>
                    ${serverEntity ? `
                        <div class="text-sm space-y-1">
                            <p><strong>Name:</strong> ${serverEntity.name}</p>
                            <p><strong>Version:</strong> ${serverEntity.version}</p>
                            <p><strong>Modified:</strong> ${new Date(serverEntity.updatedAt).toLocaleString()}</p>
                            <p><strong>City:</strong> ${serverEntity.data?.location?.city || 'N/A'}</p>
                        </div>
                        <button id="keep-server" 
                                class="mt-4 w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
                            Keep Server Version
                        </button>
                    ` : `
                        <p class="text-red-600">Could not fetch server version</p>
                        <button id="keep-server" disabled
                                class="mt-4 w-full px-4 py-2 bg-gray-300 text-gray-500 rounded cursor-not-allowed">
                            Server Unavailable
                        </button>
                    `}
                </div>
            </div>
            
            <div class="flex gap-3">
                <button id="cancel-conflict" 
                        class="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
                    Cancel
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Event handlers
    const keepLocalBtn = document.getElementById('keep-local');
    const keepServerBtn = document.getElementById('keep-server');
    const cancelBtn = document.getElementById('cancel-conflict');
    
    keepLocalBtn?.addEventListener('click', async () => {
        await this.resolveConflictKeepLocal(localEntity);
        modal.remove();
    });
    
    keepServerBtn?.addEventListener('click', async () => {
        if (serverEntity) {
            await this.resolveConflictKeepServer(serverEntity);
        }
        modal.remove();
    });
    
    cancelBtn.addEventListener('click', () => {
        modal.remove();
    });
}

/**
 * Keep local version and force push to server
 */
async resolveConflictKeepLocal(localEntity) {
    try {
        // Force push to server (will fail if still conflict)
        await window.ApiService.updateEntity(
            localEntity.entity_id,
            localEntity,
            localEntity.version
        );
        
        // Mark as synced
        localEntity.sync.status = 'synced';
        localEntity.sync.lastSyncedAt = new Date().toISOString();
        await this.dataStore.updateEntity(localEntity.entity_id, localEntity);
        
        // Refresh display
        await this.loadEntities();
        
        if (window.SafetyUtils) {
            window.SafetyUtils.showNotification('Local version saved to server', 'success');
        }
    } catch (error) {
        this.log.error('Failed to keep local version:', error);
        if (window.SafetyUtils) {
            window.SafetyUtils.showNotification(`Error: ${error.message}`, 'error');
        }
    }
}

/**
 * Keep server version and overwrite local
 */
async resolveConflictKeepServer(serverEntity) {
    try {
        // Overwrite local with server version
        serverEntity.sync = {
            serverId: serverEntity._id || null,
            status: 'synced',
            lastSyncedAt: new Date().toISOString()
        };
        
        await this.dataStore.db.entities.put(serverEntity);
        
        // Refresh display
        await this.loadEntities();
        
        if (window.SafetyUtils) {
            window.SafetyUtils.showNotification('Server version applied locally', 'success');
        }
    } catch (error) {
        this.log.error('Failed to keep server version:', error);
        if (window.SafetyUtils) {
            window.SafetyUtils.showNotification(`Error: ${error.message}`, 'error');
        }
    }
}
```

### 🎯 Resultado Esperado

Após mudanças:
1. ✅ Entity cards mostram version e sync status
2. ✅ Conflicts são visualmente distintos (vermelho)
3. ✅ Click em conflict abre modal de resolução
4. ✅ Usuário escolhe entre local ou server
5. ✅ Resolução atualiza entity e UI

---

## 5. curatorModule.js

**Arquivo:** `scripts/modules/curatorModule.js`  
**Linhas:** 1266  
**Status:** ⚠️ Precisa análise de curations V3  
**Prioridade:** 🔴 ALTA

### Situação Atual

Módulo gerencia curators mas precisa verificar:
- Se usa `curation_id` (UUID) ou `id` (numérico)
- Se suporta campo `version`
- Se integra com syncManager V3

### ✅ Mudanças Necessárias

#### 5.1. Verificar Estrutura de Curation

**Localização:** Métodos que criam/atualizam curations

**GARANTIR estrutura V3:**
```javascript
async saveCuration(curationData) {
    try {
        // Build V3 curation structure
        const curation = {
            curation_id: curationData.curation_id || this.generateUUID(),
            entity_id: curationData.entity_id,  // UUID reference
            curator: {
                id: this.currentCurator.id,
                name: this.currentCurator.name,
                email: this.currentCurator.email
            },
            data: {
                notes: curationData.notes || '',
                rating: curationData.rating || null,
                visitDate: curationData.visitDate || null,
                tags: curationData.tags || [],
                // ... outros campos
            },
            metadata: [{
                source: 'manual',
                createdAt: new Date().toISOString(),
                curator: {
                    id: this.currentCurator.id,
                    name: this.currentCurator.name
                }
            }],
            version: curationData.version || 1,
            status: 'active',
            createdAt: curationData.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdBy: this.currentCurator.id,
            updatedBy: this.currentCurator.id,
            sync: {
                serverId: curationData.sync?.serverId || null,
                status: 'pending',  // Will be synced later
                lastSyncedAt: null
            }
        };
        
        // Save to IndexedDB
        await this.dataStore.db.curations.put(curation);
        
        this.log.debug('Curation saved:', curation.curation_id);
        
        return curation;
    } catch (error) {
        this.log.error('Failed to save curation:', error);
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
```

#### 5.2. Atualizar Sync Button

**Localização:** Linhas 184-200 (sync button handlers)

**SIMPLIFICAR:**
```javascript
// Sync button
const syncButton = document.getElementById('sync-compact-display');
if (syncButton) {
    syncButton.addEventListener('click', async () => {
        syncButton.disabled = true;
        syncButton.classList.add('syncing');
        
        try {
            // Use V3 SyncManager only
            if (!window.SyncManager) {
                throw new Error('SyncManager not available');
            }
            
            await window.SyncManager.fullSync();
            
            // Refresh UI
            if (this.uiManager && this.uiManager.currentCurator) {
                await this.loadCurations(this.uiManager.currentCurator.id);
            }
            
            if (window.SafetyUtils) {
                window.SafetyUtils.showNotification('Sync complete', 'success');
            }
        } catch (error) {
            this.log.error('Sync failed:', error);
            if (window.SafetyUtils) {
                window.SafetyUtils.showNotification(`Sync error: ${error.message}`, 'error');
            }
        } finally {
            syncButton.disabled = false;
            syncButton.classList.remove('syncing');
        }
    });
}
```

**REMOVER:**
- Referências a `syncManager.performComprehensiveSync` (legado)
- Lógica condicional entre diferentes sync managers

### 🎯 Resultado Esperado

Após mudanças:
1. ✅ Curations usam `curation_id` (UUID)
2. ✅ Curations têm campo `version`
3. ✅ Sync button usa apenas SyncManager V3
4. ✅ Estrutura totalmente compatível com API V3

---

## 6. syncStatusModule.js

**Arquivo:** `scripts/modules/syncStatusModule.js`  
**Linhas:** 315  
**Status:** ⚠️ Precisa integração com SyncManager V3  
**Prioridade:** 🔴 ALTA

### Situação Atual

Módulo tem UI para mostrar status mas pode não estar conectado ao SyncManager V3.

### ✅ Mudanças Necessárias

#### 6.1. Conectar ao SyncManager V3

**Localização:** Linha ~67 (método `updateStatus`)

**CORRIGIR:**
```javascript
async updateStatus() {
    // Use V3 SyncManager only
    if (!window.SyncManager || typeof window.SyncManager.getSyncStatus !== 'function') {
        this.container.innerHTML = `
            <span class="text-sm text-gray-400">Sync not available</span>
        `;
        return;
    }

    try {
        const status = await window.SyncManager.getSyncStatus();
        
        if (!status) {
            this.container.innerHTML = `
                <span class="text-sm text-gray-400">Unable to get sync status</span>
            `;
            return;
        }

        // Build status HTML
        const parts = [];

        // Online/Offline status
        if (status.isOnline) {
            parts.push(`
                <span class="flex items-center gap-1 text-sm text-green-600">
                    <span class="material-icons text-sm">cloud_done</span>
                    Online
                </span>
            `);
        } else {
            parts.push(`
                <span class="flex items-center gap-1 text-sm text-red-600">
                    <span class="material-icons text-sm">cloud_off</span>
                    Offline
                </span>
            `);
        }

        // Syncing indicator
        if (status.isSyncing) {
            parts.push(`
                <span class="flex items-center gap-1 text-sm text-blue-600 animate-pulse">
                    <span class="material-icons text-sm animate-spin">sync</span>
                    Syncing...
                </span>
            `);
        }

        // Pending count
        if (status.pendingCount > 0) {
            parts.push(`
                <span class="flex items-center gap-1 px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded">
                    <span class="material-icons text-xs">cloud_upload</span>
                    ${status.pendingCount} pending
                </span>
            `);
        }

        // Conflict count
        if (status.conflictCount > 0) {
            parts.push(`
                <button onclick="syncStatusModule.showConflicts()" 
                        class="flex items-center gap-1 px-2 py-1 text-xs bg-red-100 text-red-800 rounded hover:bg-red-200">
                    <span class="material-icons text-xs">warning</span>
                    ${status.conflictCount} conflicts
                </button>
            `);
        }

        // Last sync time
        if (status.lastPullAt) {
            const lastSync = new Date(status.lastPullAt);
            const minutesAgo = Math.floor((Date.now() - lastSync.getTime()) / 60000);
            const timeText = minutesAgo < 1 ? 'just now' : 
                            minutesAgo < 60 ? `${minutesAgo}m ago` : 
                            `${Math.floor(minutesAgo / 60)}h ago`;
            
            parts.push(`
                <span class="text-xs text-gray-500">
                    Last sync: ${timeText}
                </span>
            `);
        }

        // Manual sync button
        parts.push(`
            <button onclick="syncStatusModule.triggerManualSync()" 
                    class="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1"
                    ${status.isSyncing ? 'disabled' : ''}>
                <span class="material-icons text-sm">sync</span>
                Sync Now
            </button>
        `);

        this.container.innerHTML = parts.join('');
        
    } catch (error) {
        this.log.error('Failed to update sync status:', error);
        this.container.innerHTML = `
            <span class="text-sm text-red-500">Error: ${error.message}</span>
        `;
    }
}
```

#### 6.2. Adicionar Métodos Helper

**Localização:** Adicionar novos métodos

**ADICIONAR:**
```javascript
/**
 * Show list of conflicts
 */
async showConflicts() {
    try {
        // Get all conflict entities
        const conflictEntities = await window.dataStorage.db.entities
            .where('sync.status').equals('conflict')
            .toArray();
        
        const conflictCurations = await window.dataStorage.db.curations
            .where('sync.status').equals('conflict')
            .toArray();
        
        // Show modal with list
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 p-6 max-h-[80vh] overflow-y-auto">
                <h2 class="text-2xl font-bold mb-4 flex items-center gap-2">
                    <span class="material-icons text-red-600">warning</span>
                    Conflicts (${conflictEntities.length + conflictCurations.length})
                </h2>
                
                ${conflictEntities.length > 0 ? `
                    <h3 class="font-bold text-lg mb-2">Entities</h3>
                    <div class="space-y-2 mb-4">
                        ${conflictEntities.map(e => `
                            <div class="p-3 border border-red-300 rounded bg-red-50">
                                <p class="font-semibold">${e.name}</p>
                                <p class="text-sm text-gray-600">${e.entity_id}</p>
                                <button onclick="entityModule.resolveConflict('${e.entity_id}')"
                                        class="mt-2 px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700">
                                    Resolve
                                </button>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                
                ${conflictCurations.length > 0 ? `
                    <h3 class="font-bold text-lg mb-2">Curations</h3>
                    <div class="space-y-2">
                        ${conflictCurations.map(c => `
                            <div class="p-3 border border-red-300 rounded bg-red-50">
                                <p class="font-semibold">Curation ${c.curation_id}</p>
                                <p class="text-sm text-gray-600">Entity: ${c.entity_id}</p>
                                <button onclick="curatorModule.resolveConflict('${c.curation_id}')"
                                        class="mt-2 px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700">
                                    Resolve
                                </button>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                
                <button onclick="this.closest('.fixed').remove()" 
                        class="mt-4 w-full px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
                    Close
                </button>
            </div>
        `;
        
        document.body.appendChild(modal);
    } catch (error) {
        this.log.error('Failed to show conflicts:', error);
    }
}

/**
 * Trigger manual sync
 */
async triggerManualSync() {
    try {
        if (!window.SyncManager) {
            throw new Error('SyncManager not available');
        }
        
        // Update UI to show syncing
        await this.updateStatus();
        
        // Perform sync
        await window.SyncManager.fullSync();
        
        // Update UI again
        await this.updateStatus();
        
        if (window.SafetyUtils) {
            window.SafetyUtils.showNotification('Sync complete', 'success');
        }
    } catch (error) {
        this.log.error('Manual sync failed:', error);
        if (window.SafetyUtils) {
            window.SafetyUtils.showNotification(`Sync error: ${error.message}`, 'error');
        }
    }
}
```

### 🎯 Resultado Esperado

Após mudanças:
1. ✅ Sync status atualiza em tempo real
2. ✅ Mostra pending/conflict counts
3. ✅ Botão "Sync Now" funcional
4. ✅ Modal de conflicts listando todos

---

## 7. placesModule.js

**Arquivo:** `scripts/modules/placesModule.js`  
**Linhas:** 3316  
**Status:** ⚠️ Precisa integração com entities V3  
**Prioridade:** 🟡 MÉDIA

### Situação Atual

Módulo busca no Google Places, mas ao criar entity precisa usar estrutura V3.

### ✅ Mudanças Necessárias

#### 7.1. Garantir Criação de Entity V3

**Localização:** Método que importa place como entity

**VERIFICAR estrutura:**
```javascript
async importPlaceAsEntity(placeData) {
    try {
        // Build V3 entity structure
        const entity = {
            entity_id: this.generateUUID(),
            type: 'restaurant',  // or determine from place type
            name: placeData.name,
            status: 'active',
            externalId: placeData.place_id,  // Google Place ID
            
            data: {
                location: {
                    address: placeData.formatted_address || '',
                    city: this.extractCity(placeData.address_components),
                    country: this.extractCountry(placeData.address_components),
                    coordinates: {
                        lat: placeData.geometry?.location?.lat() || null,
                        lng: placeData.geometry?.location?.lng() || null
                    },
                    formatted_address: placeData.formatted_address
                },
                contacts: {
                    phone: placeData.formatted_phone_number || '',
                    website: placeData.website || '',
                    google_maps_url: placeData.url || ''
                },
                media: {
                    photos: (placeData.photos || []).map(photo => ({
                        url: photo.getUrl({maxWidth: 800}),
                        attribution: photo.html_attributions
                    }))
                },
                ratings: {
                    google: {
                        rating: placeData.rating || null,
                        total_ratings: placeData.user_ratings_total || 0
                    }
                },
                details: {
                    price_level: placeData.price_level || null,
                    types: placeData.types || [],
                    opening_hours: placeData.opening_hours?.weekday_text || []
                }
            },
            
            metadata: [{
                source: 'google_places',
                sourceId: placeData.place_id,
                importedAt: new Date().toISOString(),
                place_id: placeData.place_id,
                raw_data: placeData  // Keep original for reference
            }],
            
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdBy: this.getCurrentCuratorId() || 'system',
            updatedBy: this.getCurrentCuratorId() || 'system',
            
            sync: {
                serverId: null,
                status: 'pending',  // Will be synced
                lastSyncedAt: null
            }
        };
        
        // Save to IndexedDB
        await window.dataStorage.db.entities.put(entity);
        
        this.log.debug('Place imported as entity:', entity.entity_id);
        
        // Show success notification
        if (window.SafetyUtils) {
            window.SafetyUtils.showNotification(
                `Imported ${entity.name} - will be synced`,
                'success'
            );
        }
        
        return entity;
        
    } catch (error) {
        this.log.error('Failed to import place:', error);
        throw error;
    }
}

extractCity(addressComponents) {
    const cityComponent = addressComponents?.find(c => 
        c.types.includes('locality') || c.types.includes('administrative_area_level_2')
    );
    return cityComponent?.long_name || '';
}

extractCountry(addressComponents) {
    const countryComponent = addressComponents?.find(c => 
        c.types.includes('country')
    );
    return countryComponent?.long_name || '';
}

getCurrentCuratorId() {
    return window.uiManager?.currentCurator?.id || null;
}

generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
```

### 🎯 Resultado Esperado

Após mudanças:
1. ✅ Places importados com estrutura V3 completa
2. ✅ Entity tem `entity_id` UUID
3. ✅ Entity tem campo `version`
4. ✅ Entity marcado como `pending` para sync

---

## 8-10. Outros Módulos

### 8. conceptModule.js
**Prioridade:** 🟡 MÉDIA  
**Mudanças:** Verificar se usa endpoint `/concepts/match` V3

### 9. recordingModule.js
**Prioridade:** 🟡 MÉDIA  
**Mudanças:** Verificar se usa endpoint `/ai/transcribe` V3

### 10. Outros
**Prioridade:** 🟢 BAIXA  
**Ação:** Análise individual conforme necessário

---

## 📊 Resumo de Prioridades

### Sprint 1: Database & Core (1 dia)
- [ ] dataStorage.js - Force reset
- [ ] main.js - SyncManager init
- [ ] syncManagerV3.js - Verificação

### Sprint 2: UI Core (1 dia)
- [ ] entityModule.js - Badges + conflict UI
- [ ] curatorModule.js - Curations V3
- [ ] syncStatusModule.js - Status display

### Sprint 3: Features (1 dia)
- [ ] placesModule.js - Import V3
- [ ] conceptModule.js - Endpoint V3
- [ ] recordingModule.js - Endpoint V3

### Sprint 4: Testing (1 dia)
- [ ] Testes de integração
- [ ] Testes E2E
- [ ] Bug fixes

---

## 10. migrationManager.js

**Arquivo:** `scripts/migrationManager.js`  
**Status:** ❌ NÃO NECESSÁRIO - DELETAR  
**Prioridade:** 🟢 BAIXA

**AÇÃO:** Arquivar ou deletar completamente.

```bash
mv scripts/migrationManager.js archive/old-code/
```

---

## 11-20. Outros Módulos

Ver análise detalhada completa em seções acima no documento.

**Resumo de Prioridades:**

| Arquivo | Ação Principal | Prioridade |
|---------|---------------|------------|
| conceptModule.js | Verificar endpoint `/concepts/match` V3 | 🟡 MÉDIA |
| recordingModule.js | Verificar endpoint `/ai/transcribe` V3 | 🟡 MÉDIA |
| transcriptionModule.js | Migrar apiHandler → ApiService | 🟡 MÉDIA |
| importManager.js | Verificar SyncManager V3 | 🟢 BAIXA |
| apiHandler.js | Documentar + deprecar métodos antigos | 🟡 MÉDIA |
| V3DataTransformer.js | ✅ Sem mudanças | ✅ OK |
| quickActionModule.js | Garantir entity V3 em quick add | 🟡 MÉDIA |
| draftRestaurantManager.js | Verificar store ou usar status='draft' | 🟡 MÉDIA |
| exportImportModule.js | Mudar .id → .entity_id | 🟡 MÉDIA |
| dataStore.js | Consolidar com dataStorage.js | 🔴 ALTA |

---

## 🎯 Checklist de Verificação

Para cada arquivo modificado, verificar:

- [ ] Remove código de migração V2→V3
- [ ] Remove checks de compatibilidade V2
- [ ] Usa `entity_id`/`curation_id` (UUIDs)
- [ ] Usa campo `version` para optimistic locking
- [ ] Usa `sync.status` (pending/synced/conflict)
- [ ] Usa apenas `window.SyncManager` (V3)
- [ ] Remove referências a syncManager legado
- [ ] Logging adequado com Logger.module()
- [ ] Error handling robusto
- [ ] Headers de arquivo atualizados

---

**Este documento será atualizado conforme análise progride.**
