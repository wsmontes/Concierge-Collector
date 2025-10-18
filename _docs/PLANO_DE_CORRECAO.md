# Plano de Correção - Código Duplicado e Inconsistências

**Data**: 18 de Outubro de 2025  
**Baseado em**: ANALISE_PROFUNDA_RELATORIO.md  
**Tempo Estimado Total**: 6-8 horas

---

## 🎯 ESTRATÉGIA DE EXECUÇÃO

### Princípios:
1. **Segurança Primeiro**: Fazer backup antes de qualquer deleção
2. **Incremental**: Uma correção por vez, testar entre cada mudança
3. **Reversível**: Usar Git para poder reverter se necessário
4. **Validar**: Testar aplicação após cada mudança crítica

### Ordem de Execução:
Seguir ordem de **IMPACTO** (problemas que afetam funcionalidade primeiro):

1. 🔴 Problemas Críticos (Features quebradas)
2. 🟡 Problemas Médios (Manutenibilidade)
3. 🟢 Problemas Baixos (Code cleanup)

---

## 🔴 FASE 1: CORREÇÕES CRÍTICAS (2-3 horas)

### TAREFA 1.1: Remover Código Duplicado em dataStorage.js

**Problema**: Métodos `saveRestaurant`, `saveRestaurantWithTransaction`, `updateRestaurant` definidos 2x  
**Impacto**: Shared restaurants quebrados, import de Concierge format perde dados  
**Tempo Estimado**: 30 minutos

#### Passos:

1. **Backup**
```bash
cp scripts/dataStorage.js scripts/dataStorage.js.backup
git add scripts/dataStorage.js.backup
git commit -m "backup: dataStorage.js before removing duplicates"
```

2. **Identificar Linhas Exatas**
```bash
# Confirmar linhas duplicadas
grep -n "async saveRestaurant\|async updateRestaurant" scripts/dataStorage.js

# Resultado esperado:
# 915:  async saveRestaurant(      ← MANTER (tem sharedRestaurantId)
# 988:  async saveRestaurantWith... ← MANTER
# 1096: async saveRestaurantWith... ← MANTER
# 1460: async updateRestaurant(     ← MANTER (tem background sync)
# 1662: async saveRestaurant(       ← DELETAR
# 1702: async saveRestaurantWith... ← DELETAR
# 2023: async updateRestaurant(     ← DELETAR
```

3. **Deletar Linhas 1662-2100**
```javascript
// ANTES DE DELETAR, verificar que nada depende dessas linhas
grep -r "linha 1662\|linha 1702\|linha 2023" scripts/

// Se nenhum resultado: SAFE TO DELETE
```

4. **Executar Deleção**
   - Abrir `/scripts/dataStorage.js`
   - Ir para linha 1662
   - Selecionar até aproximadamente linha 2100 (até próximo método não-duplicado)
   - Deletar
   - Salvar

5. **Validar**
```javascript
// No console do browser após recarregar:
const ds = window.dataStorage;

// Verificar signature correta:
console.log(ds.saveRestaurant.toString().includes('sharedRestaurantId'));
// Deve retornar: true

// Testar funcionalidade:
const result = await ds.saveRestaurant(
    'Test Restaurant', 
    1,  // curatorId
    [],
    null, null, '', '',
    'local', null, null,
    'test-uuid-123',  // sharedRestaurantId ← NOVO
    1                  // originalCuratorId ← NOVO
);

// Verificar se foi salvo:
const restaurant = await ds.db.restaurants.get(result);
console.log('sharedRestaurantId:', restaurant.sharedRestaurantId);
// Deve mostrar: 'test-uuid-123'
```

6. **Commit**
```bash
git add scripts/dataStorage.js
git commit -m "fix: remove duplicate methods in dataStorage.js (lines 1662-2100)

- Removed duplicate saveRestaurant() (line 1662)
- Removed duplicate saveRestaurantWithTransaction() (line 1702)
- Removed duplicate updateRestaurant() (line 2023)
- Kept versions with sharedRestaurantId support (lines 915, 988, 1460)
- Fixes: shared restaurants functionality
- Fixes: Concierge import data loss"
```

---

### TAREFA 1.2: Remover Arquivos Duplicados

**Problema**: 3 arquivos existem em dois lugares  
**Impacto**: Desenvolvedores editam arquivo errado, mudanças perdidas  
**Tempo Estimado**: 30 minutos

#### Arquivos a Remover:

| Arquivo | Deletar | Manter | Razão |
|---------|---------|--------|-------|
| `restaurantModule.js` | `/scripts/restaurantModule.js` | `/scripts/modules/restaurantModule.js` | HTML carrega versão em `/modules/` |
| `uiManager.js` | `/scripts/modules/uiManager.js` | `/scripts/uiManager.js` | HTML carrega versão em `/scripts/` |
| `uiUtilsModule.js` | `/scripts/uiUtilsModule.js` | `/scripts/modules/uiUtilsModule.js` | HTML carrega versão em `/modules/` |

#### Passos:

1. **Verificar qual versão é carregada no HTML**
```bash
grep -n "restaurantModule\|uiManager\|uiUtilsModule" index.html

# Resultado:
# 577: <script src="scripts/uiManager.js"></script>
# 582: <script src="scripts/modules/uiUtilsModule.js"></script>
# 590: <script src="scripts/modules/restaurantModule.js"></script>
```

2. **Comparar Arquivos Antes de Deletar**
```bash
# Verificar se arquivos são realmente idênticos ou qual tem mais código

# restaurantModule
wc -l scripts/restaurantModule.js scripts/modules/restaurantModule.js
diff scripts/restaurantModule.js scripts/modules/restaurantModule.js

# uiManager
wc -l scripts/uiManager.js scripts/modules/uiManager.js
diff scripts/uiManager.js scripts/modules/uiManager.js

# uiUtilsModule
wc -l scripts/uiUtilsModule.js scripts/modules/uiUtilsModule.js
diff scripts/uiUtilsModule.js scripts/modules/uiUtilsModule.js
```

3. **Mover para Backup (NÃO deletar completamente)**
```bash
mkdir -p _backup/removed_duplicates_2025-10-18

# Mover arquivos não usados para backup
mv scripts/restaurantModule.js _backup/removed_duplicates_2025-10-18/
mv scripts/modules/uiManager.js _backup/removed_duplicates_2025-10-18/
mv scripts/uiUtilsModule.js _backup/removed_duplicates_2025-10-18/
```

4. **Validar que App Continua Funcionando**
   - Recarregar página
   - Verificar console sem erros de "script not found"
   - Testar criar restaurante
   - Testar editar restaurante

5. **Commit**
```bash
git add .
git commit -m "cleanup: move duplicate files to backup

Moved to _backup/removed_duplicates_2025-10-18/:
- scripts/restaurantModule.js (unused, duplicate of modules/restaurantModule.js)
- scripts/modules/uiManager.js (unused, duplicate of scripts/uiManager.js)
- scripts/uiUtilsModule.js (unused, duplicate of modules/uiUtilsModule.js)

Kept files that are actually loaded by index.html"
```

---

### TAREFA 1.3: Consolidar Sistemas de Sync

**Problema**: Três sistemas de sync rodando simultaneamente  
**Impacto**: Requests duplicados, confusão, performance  
**Tempo Estimado**: 1-1.5 horas

#### Sistemas Atuais:

| Sistema | Arquivo | Função | Frequência | Status |
|---------|---------|--------|------------|--------|
| **BackgroundSync** | `backgroundSync.js` | Sync individual após save/edit | 60s retry | ✅ MANTER |
| **AutoSync** | `autoSync.js` | Full two-way sync | 30 minutos | ❌ DESABILITAR |
| **Manual Sync** | `syncService.js` | Sync sob demanda | Manual | ✅ MANTER (via BackgroundSync) |

#### Decisão:
- **MANTER**: BackgroundSync (mais moderno, não-bloqueante)
- **REMOVER**: AutoSync (redundante, mais antigo)
- **ADAPTAR**: SyncService para ser usado apenas por BackgroundSync

#### Passos:

1. **Desabilitar AutoSync Completamente**

**Editar `scripts/autoSync.js`**:
```javascript
// INÍCIO DO ARQUIVO - Adicionar early return
console.warn('⚠️ AutoSync DISABLED - Using BackgroundSync instead');
console.warn('This file is kept for reference but not executing');

// Wrap everything in if(false) para desabilitar sem deletar
if (false) {
    // ... todo o código existente ...
}

// Export empty object
window.AutoSync = {
    init: () => console.log('AutoSync disabled'),
    performSync: () => Promise.resolve({ message: 'AutoSync disabled, using BackgroundSync' })
};
```

2. **Atualizar main.js para Não Chamar AutoSync**

**Editar `scripts/main.js`**:
```javascript
// Procurar por AutoSync.init()
// ANTES:
if (window.AutoSync && typeof window.AutoSync.init === 'function') {
    await window.AutoSync.init();
}

// DEPOIS:
// DISABLED: Using BackgroundSync instead
// if (window.AutoSync && typeof window.AutoSync.init === 'function') {
//     await window.AutoSync.init();
// }
console.log('Using BackgroundSync for automatic sync (60s intervals)');
```

3. **Atualizar syncSettingsManager.js**

**Editar `scripts/syncSettingsManager.js`**:
```javascript
// Procurar referências a AutoSync
// ANTES:
if (!window.dataStorage || !window.AutoSync) {
    // ...
}

// DEPOIS:
if (!window.dataStorage || !window.backgroundSync) {
    console.error('SyncSettingsManager requires dataStorage and backgroundSync');
    return;
}
```

4. **Adicionar Manual Sync via BackgroundSync**

**Editar `scripts/modules/restaurantModule.js`** (linha ~40):
```javascript
// Botão de sync manual
syncButton.addEventListener('click', async () => {
    // ANTES:
    // await syncService.syncUnsyncedRestaurants();
    
    // DEPOIS: Usar BackgroundSync
    if (window.backgroundSync) {
        console.log('Manual sync triggered');
        const result = await window.backgroundSync.syncAllPending(50); // Sync até 50
        
        if (result.synced > 0) {
            uiUtils.showNotification(`Synced ${result.synced} restaurants!`, 'success');
        } else if (result.failed > 0) {
            uiUtils.showNotification(`Failed to sync ${result.failed} restaurants`, 'error');
        } else {
            uiUtils.showNotification('All restaurants already synced', 'info');
        }
        
        // Reload list to update badges
        await this.loadRestaurantList();
        await this.updateSyncButton();
    }
});
```

5. **Validar**
```javascript
// No console:
console.log('AutoSync active?', !!window.AutoSync);  // false ou object vazio
console.log('BackgroundSync active?', !!window.backgroundSync);  // true
console.log('BackgroundSync retry active?', !!window.backgroundSync.retryInterval);  // true

// Verificar que apenas BackgroundSync está rodando:
// - NÃO deve ter timer de 30 minutos
// - DEVE ter timer de 60 segundos
```

6. **Testar**
   - Criar novo restaurante → Deve sync automaticamente
   - Editar restaurante → Deve sync automaticamente
   - Clicar botão sync manual → Deve funcionar
   - Console NÃO deve mostrar "AutoSync" logs

7. **Commit**
```bash
git add scripts/autoSync.js scripts/main.js scripts/syncSettingsManager.js scripts/modules/restaurantModule.js
git commit -m "refactor: disable AutoSync, consolidate to BackgroundSync only

- Disabled AutoSync.js (30min periodic sync - redundant)
- Kept BackgroundSync.js (60s retry + on-demand sync)
- Updated manual sync button to use BackgroundSync
- Removed AutoSync initialization from main.js
- Updated syncSettingsManager to use backgroundSync

Benefits:
- Single source of truth for sync
- No duplicate requests
- Simpler mental model
- Better performance"
```

---

## 🟡 FASE 2: CORREÇÕES MÉDIAS (3-4 horas)

### TAREFA 2.1: Padronizar Dependency Injection

**Problema**: Módulos acessam `window.dataStorage` diretamente  
**Impacto**: Tight coupling, difícil testar, race conditions  
**Tempo Estimado**: 2 horas

#### Módulos a Refatorar:

| Módulo | Acessos Diretos a `window.*` | Prioridade |
|--------|------------------------------|------------|
| `placesModule.js` | 15x | Alta |
| `michelinStagingModule.js` | 10x | Alta |
| `conceptModule.js` | 8x | Média |
| `exportImportModule.js` | 6x | Média |

#### Padrão a Seguir:

```javascript
// ❌ ANTES (RUIM):
class PlacesModule {
    async importPlace() {
        if (window.dataStorage) {  // Acesso direto
            await window.dataStorage.saveRestaurant(...);
        }
    }
}

// ✅ DEPOIS (BOM):
class PlacesModule {
    constructor(dependencies = {}) {
        this.dataStorage = dependencies.dataStorage || window.dataStorage;
        this.uiManager = dependencies.uiManager || window.uiManager;
        
        // Validar que dependências existem
        if (!this.dataStorage) {
            throw new Error('PlacesModule requires dataStorage dependency');
        }
    }
    
    async importPlace() {
        await this.dataStorage.saveRestaurant(...);  // Usar this.dataStorage
    }
}
```

#### Passos:

**Para cada módulo:**

1. Adicionar constructor com dependencies
2. Substituir `window.dataStorage` por `this.dataStorage`
3. Substituir `window.uiManager` por `this.uiManager`
4. Atualizar criação da instância em main.js
5. Testar funcionalidade

#### Exemplo Completo para placesModule.js:

**1. Adicionar Constructor:**
```javascript
// Linha ~20, ANTES do init()
constructor(dependencies = {}) {
    this.dataStorage = dependencies.dataStorage || window.dataStorage;
    this.uiManager = dependencies.uiManager || window.uiManager;
    this.apiHandler = dependencies.apiHandler || window.apiHandler;
    
    if (!this.dataStorage) {
        throw new Error('PlacesModule requires dataStorage');
    }
    
    this.apiKey = null;
    this.map = null;
    this.service = null;
    this.autocompleteService = null;
    this.selectedPlace = null;
}
```

**2. Substituir window.dataStorage:**
```bash
# Fazer substituição global NO ARQUIVO
# Substituir: window.dataStorage
# Por: this.dataStorage

# Substituir: window.uiManager
# Por: this.uiManager

# Substituir: window.apiHandler
# Por: this.apiHandler
```

**3. Atualizar Instância Global:**
```javascript
// Final do arquivo placesModule.js

// ANTES:
window.placesModule = new PlacesModule();

// DEPOIS:
window.placesModule = new PlacesModule({
    dataStorage: window.dataStorage,
    uiManager: window.uiManager,
    apiHandler: window.apiHandler
});
```

**4. Commit por Módulo:**
```bash
git add scripts/modules/placesModule.js
git commit -m "refactor(placesModule): use dependency injection

- Added constructor with dependencies parameter
- Replaced 15 instances of window.dataStorage with this.dataStorage
- Replaced window.uiManager with this.uiManager
- Added dependency validation in constructor
- Makes module testable and less coupled"
```

**Repetir para cada módulo.**

---

### TAREFA 2.2: Consolidar UI Utils

**Problema**: Três módulos fazem a mesma coisa  
**Impacto**: Código duplicado, confusão  
**Tempo Estimado**: 1 hora

#### Decisão de Consolidação:

| Módulo | Manter? | Razão |
|--------|---------|-------|
| `scripts/uiUtils.js` | ✅ SIM | Base, mais usado |
| `scripts/modules/uiUtilsModule.js` | ❌ NÃO | Duplicata |
| `scripts/modules/safetyUtils.js` | ⚠️ MERGE | Tem helpers únicos (withLoading, withErrorHandling) |

#### Passos:

**1. Mover Métodos Únicos de SafetyUtils para uiUtils:**

```javascript
// Adicionar ao final de scripts/uiUtils.js:

/**
 * Execute function with loading indicator
 * @param {Function} fn - Async function to execute
 * @param {string} message - Loading message
 * @param {string} moduleName - Module name for logging
 * @returns {Promise<any>}
 */
async withLoading(fn, message = 'Loading...', moduleName = 'Unknown') {
    try {
        this.showLoading(message);
        const result = await fn();
        return result;
    } catch (error) {
        console.error(`${moduleName}: Error in withLoading:`, error);
        throw error;
    } finally {
        this.hideLoading();
    }
},

/**
 * Execute function with error handling and notification
 * @param {Function} fn - Async function to execute
 * @param {string} errorMessage - Error message to show
 * @param {string} moduleName - Module name for logging
 * @returns {Promise<any>}
 */
async withErrorHandling(fn, errorMessage = 'An error occurred', moduleName = 'Unknown') {
    try {
        return await fn();
    } catch (error) {
        console.error(`${moduleName}: Error:`, error);
        this.showNotification(errorMessage, 'error');
        throw error;
    }
}
```

**2. Atualizar Módulos que Usam SafetyUtils:**

```bash
# Encontrar todos os usos:
grep -r "SafetyUtils.withLoading\|SafetyUtils.withErrorHandling" scripts/

# Substituir por:
# SafetyUtils.withLoading → uiUtils.withLoading
# SafetyUtils.withErrorHandling → uiUtils.withErrorHandling
```

**3. Deprecar SafetyUtils:**

```javascript
// scripts/modules/safetyUtils.js
console.warn('SafetyUtils is deprecated. Use window.uiUtils instead.');

// Redirect para uiUtils
const SafetyUtils = {
    withLoading: (...args) => window.uiUtils.withLoading(...args),
    withErrorHandling: (...args) => window.uiUtils.withErrorHandling(...args),
    showLoading: (...args) => window.uiUtils.showLoading(...args),
    hideLoading: (...args) => window.uiUtils.hideLoading(...args),
    showNotification: (...args) => window.uiUtils.showNotification(...args)
};
```

**4. Remover uiUtilsModule.js (já foi movido para backup na Tarefa 1.2)**

**5. Commit:**
```bash
git add scripts/uiUtils.js scripts/modules/safetyUtils.js
git commit -m "refactor: consolidate UI utilities into uiUtils.js

- Moved withLoading() and withErrorHandling() from SafetyUtils to uiUtils
- Deprecated SafetyUtils (redirects to uiUtils)
- uiUtilsModule already removed (duplicate)
- Single source of truth: window.uiUtils"
```

---

## 🟢 FASE 3: LIMPEZA E POLIMENTO (1 hora)

### TAREFA 3.1: Remover TODOs Obsoletos

**Tempo Estimado**: 15 minutos

```bash
# scripts/dataStorage.js linha 2693
# ANTES:
// TODO: Handle Michelin data when storage is implemented

# DEPOIS: (deletar - já implementado em michelinStagingModule.js)

# scripts/dataStorage.js linha 2696
# ANTES:
// TODO: Handle Google Places data when storage is implemented

# DEPOIS: (deletar - já implementado em placesModule.js)
```

**Commit:**
```bash
git add scripts/dataStorage.js
git commit -m "cleanup: remove obsolete TODO comments

- Removed TODO for Michelin storage (implemented in michelinStagingModule)
- Removed TODO for Places storage (implemented in placesModule)"
```

---

### TAREFA 3.2: Implementar Sistema de Log Levels

**Tempo Estimado**: 45 minutos

**Criar novo arquivo: `scripts/logger.js`**

```javascript
/**
 * Logger module - Centralized logging with levels
 * 
 * Usage:
 *   logger.debug('Details:', data);
 *   logger.info('Restaurant saved');
 *   logger.warn('Network slow');
 *   logger.error('Failed:', error);
 */

const logger = {
    // Log levels
    LEVELS: {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3,
        NONE: 4
    },
    
    // Current level (set to INFO in production, DEBUG in development)
    currentLevel: 1,  // INFO
    
    // Set log level
    setLevel(level) {
        if (typeof level === 'string') {
            this.currentLevel = this.LEVELS[level.toUpperCase()] || 1;
        } else {
            this.currentLevel = level;
        }
        console.log(`Logger level set to: ${this.getLevelName(this.currentLevel)}`);
    },
    
    getLevelName(level) {
        return Object.keys(this.LEVELS).find(key => this.LEVELS[key] === level);
    },
    
    debug(...args) {
        if (this.currentLevel <= this.LEVELS.DEBUG) {
            console.log('[DEBUG]', ...args);
        }
    },
    
    info(...args) {
        if (this.currentLevel <= this.LEVELS.INFO) {
            console.log('[INFO]', ...args);
        }
    },
    
    warn(...args) {
        if (this.currentLevel <= this.LEVELS.WARN) {
            console.warn('[WARN]', ...args);
        }
    },
    
    error(...args) {
        if (this.currentLevel <= this.LEVELS.ERROR) {
            console.error('[ERROR]', ...args);
        }
    }
};

// Expose globally
window.logger = logger;

// Set level based on environment
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    logger.setLevel('DEBUG');
} else {
    logger.setLevel('INFO');
}
```

**Adicionar ao index.html (depois de moduleWrapper.js):**
```html
<script src="scripts/moduleWrapper.js"></script>
<script src="scripts/logger.js"></script>  <!-- NOVO -->
<script src="scripts/promptTemplate.js"></script>
```

**Exemplo de Uso em dataStorage.js:**
```javascript
// ANTES:
console.log('Saving restaurant:', name);
console.log('Concepts count:', concepts.length);

// DEPOIS:
logger.debug('Saving restaurant:', name);
logger.debug('Concepts count:', concepts.length);

// ANTES:
console.log('Restaurant saved with ID:', restaurantId);

// DEPOIS:
logger.info('Restaurant saved with ID:', restaurantId);

// Erros permanecem:
logger.error('Error saving restaurant:', error);
```

**Refatorar dataStorage.js gradualmente** (pode ser feito depois):
- Substituir `console.log` de detalhes por `logger.debug`
- Substituir `console.log` de ações por `logger.info`
- Manter `console.error` como `logger.error`

**Commit:**
```bash
git add scripts/logger.js index.html
git commit -m "feat: add centralized logger with levels

- Created logger.js with DEBUG, INFO, WARN, ERROR levels
- Auto-detects localhost vs production
- Allows filtering logs by level
- Exposes window.logger globally

Next step: Gradually replace console.log in modules"
```

---

## ✅ VALIDAÇÃO FINAL

Após todas as correções, executar checklist completo:

### Checklist de Validação:

```javascript
// 1. Verificar que não há mais duplicações
const ds = window.dataStorage;
console.log('saveRestaurant has sharedRestaurantId?', 
    ds.saveRestaurant.toString().includes('sharedRestaurantId'));
// Deve ser: true

// 2. Verificar arquivos não duplicados
// No terminal:
// ls scripts/restaurantModule.js  → Não deve existir
// ls scripts/modules/uiManager.js → Não deve existir
// ls scripts/uiUtilsModule.js → Não deve existir

// 3. Verificar apenas um sistema de sync ativo
console.log('BackgroundSync active?', !!window.backgroundSync.retryInterval);
// Deve ser: true

console.log('AutoSync active?', 
    window.AutoSync && typeof window.AutoSync.init === 'function');
// Deve ser: false ou warning que está disabled

// 4. Testar funcionalidades críticas:

// Criar restaurante
const result = await dataStorage.saveRestaurantWithAutoSync(
    'Test', 1, [], null, [], '', ''
);
console.log('Restaurant created:', result);

// Editar restaurante
await dataStorage.updateRestaurant(result.restaurantId, 'Test Updated', 1, [], null, [], '', '');
console.log('Restaurant updated');

// Verificar sync automático
setTimeout(() => {
    dataStorage.db.restaurants.get(result.restaurantId).then(r => {
        console.log('After sync - source:', r.source);
        // Deve ser: 'remote' (se online)
    });
}, 5000);

// 5. Verificar logs
logger.setLevel('DEBUG');
logger.debug('Debug works');
logger.info('Info works');
logger.warn('Warn works');
logger.error('Error works');
```

### Testes Funcionais:

1. ✅ Criar novo restaurante → Salva e sincroniza
2. ✅ Editar restaurante → Marca como local, depois sincroniza
3. ✅ Shared restaurant → sharedRestaurantId é salvo corretamente
4. ✅ Import Concierge → Não perde sharedRestaurantId
5. ✅ Sync manual → Funciona via botão
6. ✅ Badge atualiza → Mostra Local/Syncing/Synced
7. ✅ Sem requests duplicados → Network tab não mostra 2x POST/PUT
8. ✅ Console limpo → Apenas logs relevantes

---

## 📊 MÉTRICAS DE SUCESSO

### Antes das Correções:
- **Linhas de código**: ~3130 (dataStorage.js)
- **Arquivos duplicados**: 6 (3 pares)
- **Métodos duplicados**: 3
- **Sistemas de sync**: 3 ativos simultaneamente
- **Acesso direto a window.***: ~50 locais
- **Console logs**: ~50 por operação

### Após as Correções:
- **Linhas de código**: ~2680 (dataStorage.js) - redução de 15%
- **Arquivos duplicados**: 0
- **Métodos duplicados**: 0
- **Sistemas de sync**: 1 ativo
- **Acesso direto a window.***: ~10 locais (80% redução)
- **Console logs**: Controláveis via logger levels

### Bugs Corrigidos:
- ✅ Shared restaurants agora funcionam
- ✅ Import Concierge preserva todos os dados
- ✅ Sync não faz 3x requests
- ✅ Background sync consistente

### Melhoria em Manutenibilidade:
- ✅ Código mais limpo e organizado
- ✅ Um lugar para cada responsabilidade
- ✅ Fácil encontrar e corrigir bugs
- ✅ Dependency injection facilitates testes

---

## 🔄 PRÓXIMOS PASSOS (OPCIONAL - Fora deste Plano)

### Refatorações Adicionais Recomendadas:

1. **Split dataStorage.js em Múltiplos Arquivos**
   - `database.js` - Dexie setup e migrations
   - `restaurantStorage.js` - Restaurant CRUD
   - `curatorStorage.js` - Curator CRUD
   - `conceptStorage.js` - Concept CRUD
   - `syncStorage.js` - Sync-related methods

2. **Criar Testes Unitários**
   - Usar Jest ou Mocha
   - Testar cada módulo isoladamente
   - Mock dependencies

3. **TypeScript Migration**
   - Adicionar type safety
   - Catch errors em compile time

4. **Performance Optimization**
   - Lazy load módulos não-essenciais
   - IndexedDB query optimization
   - Debounce sync operations

---

**Fim do Plano de Correção**

**Próxima Ação**: Executar Fase 1 - Correções Críticas
