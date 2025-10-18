# Background Sync - Quick Reference

## ✅ Implementação Completa

Sistema de sincronização automática em background implementado sem bloquear a UI.

---

## 🔑 Conceitos Principais

### Source Field = Sync State
- **`source='local'`** = NÃO SINCRONIZADO (novo OU modificado)
- **`source='remote'`** = SINCRONIZADO com sucesso

### Background vs Blocking
- **ANTES**: Sync bloqueava UI, esperava resposta do servidor
- **AGORA**: Sync em background, UI responde instantaneamente

---

## 📁 Arquivos Modificados/Criados

### Novo Arquivo
- **`scripts/backgroundSync.js`** - BackgroundSyncService class

### Arquivos Modificados
1. **`index.html`** - Adicionado `<script src="scripts/backgroundSync.js">`
2. **`dataStorage.js`** - `saveRestaurantWithAutoSync()` usa background sync
3. **`dataStorage.js`** - `updateRestaurant()` dispara background sync após edição
4. **`styles/sync-badges.css`** - Animação `.syncing` com pulse

---

## 🚀 Como Funciona

### 1. Salvar Novo Restaurante
```javascript
// conceptModule.js chama:
const result = await dataStorage.saveRestaurantWithAutoSync(...);

// Fluxo:
// 1. Salva local IMEDIATAMENTE (source='local')
// 2. Retorna { restaurantId, syncStatus: 'pending' }
// 3. Dispara backgroundSync.syncRestaurant() (fire-and-forget)
// 4. Badge mostra "🔄 Syncing..." durante sync
// 5. Badge atualiza para "☁️ Synced" quando completo
```

### 2. Editar Restaurante Existente
```javascript
// Qualquer edição:
await dataStorage.updateRestaurant(...);

// Fluxo:
// 1. Atualiza local IMEDIATAMENTE
// 2. Define source='local', needsSync=true
// 3. Retorna restaurantId
// 4. Dispara backgroundSync.syncRestaurant() em background
// 5. Badge atualiza automaticamente
```

### 3. Retry Automático
```javascript
// BackgroundSyncService auto-start:
backgroundSync.startPeriodicSync(60000); // 60 segundos

// A cada 1 minuto:
// - Busca todos source='local'
// - Tenta sincronizar até 5 de cada vez
// - Silencioso, não incomoda usuário
```

### 4. Online/Offline Detection
```javascript
// Listeners automáticos:
window.addEventListener('online', () => {
    backgroundSync.syncAllPending(); // Sync tudo quando volta online
});

window.addEventListener('offline', () => {
    // Apenas log, continua funcionando local
});
```

---

## 🎨 Estados do Badge

### Badge Visual
| Estado | Aparência | Quando Aparece |
|--------|-----------|----------------|
| Local | `📱 Local` (amarelo) | source='local', não está sincronizando |
| Syncing | `🔄 Syncing...` (azul pulsando) | Sincronizando agora |
| Synced | `☁️ Synced` (verde) | source='remote', sincronizado |

### Classes CSS
```css
.data-badge.local {
    background-color: #FEF3C7; /* Amarelo */
    color: #92400E;
}

.data-badge.syncing {
    background-color: #DBEAFE; /* Azul */
    color: #1E40AF;
    animation: pulse 1.5s ease-in-out infinite;
}

.data-badge.remote {
    background-color: #D1FAE5; /* Verde */
    color: #065F46;
}
```

---

## 🔧 API do BackgroundSyncService

### Métodos Públicos

```javascript
// Sincronizar um restaurante específico
await backgroundSync.syncRestaurant(restaurantId, silent = true)
// Retorna: true se sincronizado, false se pendente/offline

// Sincronizar todos pendentes
await backgroundSync.syncAllPending(limit = 10)
// Retorna: { synced: number, failed: number, skipped: number }

// Iniciar retry periódico
backgroundSync.startPeriodicSync(intervalMs = 60000)
// Auto-sync a cada intervalo

// Parar retry periódico
backgroundSync.stopPeriodicSync()

// Atualizar badge sem reload
backgroundSync.updateUIBadge(restaurantId, 'local'|'remote'|'syncing')
```

### Propriedades Internas
```javascript
backgroundSync.isSyncing     // boolean - está sincronizando agora?
backgroundSync.syncQueue     // Set - IDs em processo
backgroundSync.isOnline      // boolean - status da rede
backgroundSync.retryInterval // intervalId - timer do retry periódico
```

---

## ✅ Benefícios

### Para o Usuário
- ✅ **UI nunca trava** - sempre responsiva
- ✅ **Funciona offline** - tudo salvo local
- ✅ **Sync transparente** - acontece automaticamente
- ✅ **Feedback visual** - badge mostra status em tempo real
- ✅ **Auto-recovery** - volta online e sincroniza tudo

### Para o Desenvolvedor
- ✅ **Fire-and-forget** - chama e esquece
- ✅ **Error handling silencioso** - não quebra a aplicação
- ✅ **Retry automático** - não precisa gerenciar manualmente
- ✅ **Estado consistente** - source field sempre correto

---

## 🧪 Cenários de Teste

### 1. Criar Restaurante Online
```
1. Criar novo restaurante
2. Badge mostra "🔄 Syncing..." por ~1s
3. Badge atualiza para "☁️ Synced"
4. Console: "✅ Background sync successful!"
```

### 2. Criar Restaurante Offline
```
1. Desconectar internet
2. Criar novo restaurante
3. Badge permanece "📱 Local"
4. Reconectar internet
5. Aguardar até 60s (ou forçar sync manual)
6. Badge atualiza para "☁️ Synced"
```

### 3. Editar Restaurante Sincronizado
```
1. Editar restaurante com badge "☁️ Synced"
2. Badge muda para "📱 Local" IMEDIATAMENTE
3. Badge muda para "🔄 Syncing..." por ~1s
4. Badge volta para "☁️ Synced"
```

### 4. Múltiplos Restaurantes Offline
```
1. Desconectar internet
2. Criar 5 restaurantes
3. Todos com badge "📱 Local"
4. Reconectar internet
5. backgroundSync processa 5 de cada vez
6. Badges atualizam um por um para "☁️ Synced"
```

---

## 🐛 Troubleshooting

### Badge não atualiza
**Problema**: Badge permanece "📱 Local" mesmo online
**Solução**: Verificar:
1. `data-restaurant-id` existe no card HTML?
2. Console mostra "Background sync successful"?
3. `window.backgroundSync` está definido?

### Sync não acontece
**Problema**: Restaurantes não sincronizam automaticamente
**Solução**: Verificar:
1. Console mostra "BackgroundSync service not available"?
2. `backgroundSync.js` carregado DEPOIS de `dataStorage.js`?
3. Periodic sync iniciado? `backgroundSync.retryInterval !== null`

### Sync duplicado
**Problema**: Mesmo restaurante sincroniza múltiplas vezes
**Solução**: Verificar:
1. `syncQueue.has(restaurantId)` retorna true durante sync?
2. `source` está sendo atualizado para 'remote' após sync?

---

## 📊 Queries Úteis

### Listar Pendentes de Sync
```javascript
const pending = await dataStorage.db.restaurants
    .where('source').equals('local')
    .toArray();
console.log(`${pending.length} restaurantes pendentes`);
```

### Forçar Sync Manual
```javascript
// Sync um específico
await backgroundSync.syncRestaurant(restaurantId, false);

// Sync todos pendentes
await backgroundSync.syncAllPending(50);
```

### Verificar Estado do Sync
```javascript
console.log('Online:', backgroundSync.isOnline);
console.log('Em sync:', backgroundSync.isSyncing);
console.log('Fila:', backgroundSync.syncQueue.size);
console.log('Retry ativo:', !!backgroundSync.retryInterval);
```

---

## 🔄 Fluxo Completo (Diagrama)

```
USUÁRIO                     LOCAL DB              BACKGROUND SYNC          SERVIDOR
   |                           |                         |                      |
   |-- Salva/Edita --------→   |                         |                      |
   |                           |                         |                      |
   |←─ Retorna Imediato ─────  |                         |                      |
   |   (UI não trava!)         |                         |                      |
   |                           |                         |                      |
   |                           |─── Dispara Sync ──────→ |                      |
   |                           |    (fire-and-forget)    |                      |
   |                           |                         |                      |
   |                           |                         |─── POST /api ──────→ |
   |                           |                         |                      |
   |                           |                         |←─── Success ────────|
   |                           |                         |                      |
   |                           |←─ Update source='remote'|                      |
   |                           |   needsSync=false       |                      |
   |                           |                         |                      |
   |←─ Badge Atualiza ──────────────────────────────────|                      |
   |   (sem page reload)       |                         |                      |
   
   // Se OFFLINE:
   |                           |                         |                      |
   |                           |─── Dispara Sync ──────→ |                      |
   |                           |                         |                      |
   |                           |                         |─ X (offline)         |
   |                           |                         |                      |
   |                           |                         |← Retry em 60s ────  |
   |                           |                         |  (automático)        |
```

---

## 💡 Próximas Melhorias (Opcionais)

### IndexedDB Sync API
- Usar Service Worker + Sync API para retry nativo
- Funciona mesmo com app fechado

### Batch Optimization
- Enviar múltiplos restaurantes em uma requisição
- Reduzir número de chamadas API

### Conflict Resolution
- Detectar conflitos se servidor mudou
- UI para resolver: keep local vs accept server

### Sync History
- Tabela `syncHistory` com log de todas tentativas
- Debug e analytics

---

## 📚 Referências

- **Código**: `scripts/backgroundSync.js`
- **Docs**: `_docs/background_sync_implementation.md`
- **Sync Logic**: `_docs/sync_implementation_summary.md`
- **Database**: `_docs/sync_logic_corrected.md`
