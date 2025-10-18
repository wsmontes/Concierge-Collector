# Sistema de Sincronização Automática em Background

## 🎯 OBJETIVO

Sincronização transparente e automática que:
- ✅ Tenta sync após cada operação (save, update, delete)
- ✅ Executa em background (não trava UI)
- ✅ Funciona offline (fallback silencioso)
- ✅ Atualiza status automaticamente quando online

---

## 🔄 ESTRATÉGIA

### 1. Background Sync após operações
```javascript
// Após salvar/editar/deletar:
async function saveRestaurant(...) {
    // 1. Salva localmente (SEMPRE funciona)
    const id = await db.restaurants.add({...});
    
    // 2. Tenta sync em background (não bloqueia)
    backgroundSync(id).catch(err => {
        console.log('Offline - will sync later');
    });
    
    // 3. Retorna imediatamente
    return id;
}
```

### 2. Sync Silencioso
```javascript
async function backgroundSync(restaurantId) {
    // Não mostra loading
    // Não trava UI
    // Apenas atualiza status quando consegue
    
    try {
        const result = await uploadToServer(restaurantId);
        
        // Atualiza silenciosamente para source='remote'
        await db.restaurants.update(restaurantId, {
            source: 'remote',
            serverId: result.id,
            needsSync: false,
            lastSynced: new Date()
        });
        
        // Atualiza badge na UI (sem reload)
        updateRestaurantBadge(restaurantId, 'remote');
        
    } catch (err) {
        // Falhou (offline?) - mantém source='local'
        // Não mostra erro
        // Tentará novamente mais tarde
    }
}
```

### 3. Periodic Retry
```javascript
// Tenta sync periódico para restaurantes pendentes
setInterval(async () => {
    const pending = await db.restaurants
        .where('source').equals('local')
        .limit(5) // Sync máximo 5 por vez
        .toArray();
    
    for (const restaurant of pending) {
        await backgroundSync(restaurant.id);
    }
}, 60000); // A cada 1 minuto
```

### 4. Online/Offline Detection
```javascript
// Detecta quando volta online
window.addEventListener('online', async () => {
    console.log('Back online - syncing pending...');
    await syncAllPending();
});

window.addEventListener('offline', () => {
    console.log('Offline mode - changes will sync later');
});
```

---

## 📊 IMPLEMENTAÇÃO

### Arquivo: `scripts/backgroundSync.js` (NOVO)

```javascript
class BackgroundSyncService {
    constructor() {
        this.isSyncing = false;
        this.syncQueue = new Set();
        this.retryInterval = null;
    }
    
    // Sync um restaurante em background
    async syncRestaurant(restaurantId, silent = true) {
        if (this.syncQueue.has(restaurantId)) return;
        
        this.syncQueue.add(restaurantId);
        
        try {
            const restaurant = await dataStorage.db.restaurants.get(restaurantId);
            if (!restaurant || restaurant.source === 'remote') {
                this.syncQueue.delete(restaurantId);
                return;
            }
            
            // Prepara dados
            const serverData = await this.prepareServerData(restaurant);
            
            // POST para servidor
            const response = await fetch('/api/restaurants', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(serverData)
            });
            
            if (response.ok) {
                const result = await response.json();
                
                // Atualiza para remote
                await dataStorage.db.restaurants.update(restaurantId, {
                    source: 'remote',
                    serverId: result.id,
                    needsSync: false,
                    lastSynced: new Date()
                });
                
                // Atualiza UI silenciosamente
                this.updateUIBadge(restaurantId, 'remote');
                
                if (!silent) {
                    console.log(`✅ Synced: ${restaurant.name}`);
                }
            }
            
        } catch (err) {
            // Falhou - mantém local
            if (!silent) {
                console.log(`⚠️ Offline: ${err.message}`);
            }
        } finally {
            this.syncQueue.delete(restaurantId);
        }
    }
    
    // Sync todos pendentes
    async syncAllPending(limit = 10) {
        if (this.isSyncing) return;
        
        this.isSyncing = true;
        
        try {
            const pending = await dataStorage.db.restaurants
                .where('source').equals('local')
                .limit(limit)
                .toArray();
            
            for (const restaurant of pending) {
                await this.syncRestaurant(restaurant.id, true);
            }
        } finally {
            this.isSyncing = false;
        }
    }
    
    // Inicia retry periódico
    startPeriodicSync(intervalMs = 60000) {
        if (this.retryInterval) return;
        
        this.retryInterval = setInterval(() => {
            this.syncAllPending(5);
        }, intervalMs);
    }
    
    // Para retry periódico
    stopPeriodicSync() {
        if (this.retryInterval) {
            clearInterval(this.retryInterval);
            this.retryInterval = null;
        }
    }
    
    // Atualiza badge na UI sem reload
    updateUIBadge(restaurantId, source) {
        const card = document.querySelector(`[data-restaurant-id="${restaurantId}"]`);
        if (!card) return;
        
        const badge = card.querySelector('.data-badge');
        if (!badge) return;
        
        if (source === 'remote') {
            badge.classList.remove('local');
            badge.classList.add('remote');
            badge.textContent = '☁️ Synced';
        } else {
            badge.classList.remove('remote');
            badge.classList.add('local');
            badge.textContent = '📱 Local';
        }
    }
}

// Instância global
window.backgroundSync = new BackgroundSyncService();

// Auto-start retry
window.backgroundSync.startPeriodicSync(60000); // 1 min

// Sync quando volta online
window.addEventListener('online', () => {
    console.log('📡 Back online - syncing pending changes...');
    window.backgroundSync.syncAllPending();
});
```

---

## 🔧 MODIFICAÇÕES NOS ARQUIVOS EXISTENTES

### 1. dataStorage.js - saveRestaurantWithAutoSync()

**ANTES:** Bloqueava até sync completar
**DEPOIS:** Salva local e tenta sync em background

```javascript
async saveRestaurantWithAutoSync(...) {
    // 1. Salva localmente (SEMPRE funciona)
    const id = await this.saveRestaurant(..., 'local', null);
    
    // 2. Tenta sync em background (NÃO bloqueia)
    if (window.backgroundSync) {
        window.backgroundSync.syncRestaurant(id).catch(() => {
            // Silencioso - tentará depois
        });
    }
    
    // 3. Retorna imediatamente
    return {
        restaurantId: id,
        syncStatus: 'pending' // Será 'synced' depois
    };
}
```

### 2. dataStorage.js - updateRestaurant()

**Adicionar ao final:**
```javascript
async updateRestaurant(id, ...) {
    // ... lógica existente ...
    
    // Tenta sync em background após update
    if (window.backgroundSync) {
        window.backgroundSync.syncRestaurant(id).catch(() => {});
    }
    
    return id;
}
```

### 3. conceptModule.js - saveRestaurant()

**Remover loading/notification de sync:**
```javascript
async saveRestaurant() {
    // Apenas salva
    const result = await dataStorage.saveRestaurantWithAutoSync(...);
    
    SafetyUtils.showNotification('Restaurant saved!', 'success');
    // Sync acontece em background - não menciona
}
```

### 4. exportImportModule.js - syncWithServer()

**Adicionar opção de background:**
```javascript
async syncWithServer(background = false) {
    if (!background) {
        SafetyUtils.showLoading('Syncing...');
    }
    
    try {
        // ... lógica de sync ...
    } finally {
        if (!background) {
            SafetyUtils.hideLoading();
        }
    }
}
```

---

## 🎨 UI - Indicadores Visuais

### Badge com animação de sync

```css
/* style.css */
.data-badge.syncing {
    animation: pulse 1s infinite;
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}
```

### Atualização em tempo real

```javascript
// Quando inicia sync
badge.classList.add('syncing');
badge.textContent = '🔄 Syncing...';

// Quando completa
badge.classList.remove('syncing');
badge.textContent = '☁️ Synced';
```

---

## ✅ FLUXO COMPLETO

### Cenário 1: Online
```
User Save → Local DB (instant) → UI Updates → Background Sync → Badge: Synced
            ↓
         User pode continuar
         (não espera sync)
```

### Cenário 2: Offline
```
User Save → Local DB (instant) → UI Updates → Background Sync Fails
            ↓                                    ↓
         User pode continuar              Badge: Local
                                               ↓
                                    Retry em 1 min
                                               ↓
                                    Quando online: Sync → Badge: Synced
```

### Cenário 3: Update
```
User Edit → source='local' → UI: Badge Local → Background Sync → Badge: Synced
```

---

## 🎯 BENEFÍCIOS

1. **UX Perfeita:** Usuário não espera sync
2. **Offline-First:** Funciona sem internet
3. **Auto-Recovery:** Sync automático quando volta online
4. **Transparente:** Badges atualizam sozinhos
5. **Performance:** Não trava UI
6. **Resiliente:** Retry automático

