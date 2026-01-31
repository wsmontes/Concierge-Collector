# Cache Safety Strategy - IndexedDB Schema Changes

**Date:** Janeiro 30, 2026  
**Context:** Prevenir conflitos entre JavaScript cacheado e schema changes  
**Risk Level:** CRITICAL ❌

---

## Problema Identificado

**Cenário de falha:**
1. Deploy schema v9 no servidor
2. User com browser cacheou dataStore.js v8
3. HTML novo + JS velho do cache
4. Schema mismatch → app quebrado

**Root cause:**
- ❌ Nenhum cache-control no HTML
- ❌ Nenhum versioning nos script tags
- ❌ Browser pode cachear JS por semanas

---

## Solução 1: Cache Busting via Query Params (IMEDIATO)

**File:** `index.html`

**Adicionar versioning em TODOS os scripts:**

```html
<!-- ANTES (❌ cache infinito) -->
<script src="scripts/storage/dataStore.js"></script>
<script src="scripts/services/apiService.js"></script>

<!-- DEPOIS (✅ cache bust em cada deploy) -->
<script src="scripts/storage/dataStore.js?v=9.0.0"></script>
<script src="scripts/services/apiService.js?v=9.0.0"></script>
```

**Implementação completa no index.html:**

```html
<!-- Application Version - UPDATE THIS ON EACH SCHEMA CHANGE -->
<script>
    window.APP_VERSION = '9.0.0';  // Incrementa quando mudar schema
    window.SCHEMA_VERSION = 9;     // IndexedDB schema version
</script>

<!-- Core Dependencies (load first) -->
<script src="https://cdn.jsdelivr.net/npm/dexie@3.2.2/dist/dexie.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/toastify-js"></script>

<!-- Configuration (MUST load before modules) -->
<script src="scripts/config.js?v=9.0.0"></script>

<!-- Core Services (versioned) -->
<script src="scripts/utils/logger.js?v=9.0.0"></script>
<script src="scripts/utils/moduleWrapper.js?v=9.0.0"></script>
<script src="scripts/storage/dataStore.js?v=9.0.0"></script>  <!-- CRÍTICO -->
<script src="scripts/services/apiService.js?v=9.0.0"></script>
<script src="scripts/services/V3DataTransformer.js?v=9.0.0"></script>

<!-- Feature Modules (versioned) -->
<script src="scripts/modules/curatorModule.js?v=9.0.0"></script>
<script src="scripts/modules/recordingModule.js?v=9.0.0"></script>
<script src="scripts/modules/conceptModule.js?v=9.0.0"></script>
<!-- ... todos os outros scripts ... -->
```

**Processo de deploy:**

```bash
# Antes do deploy, atualizar versão
# 1. Abrir index.html
# 2. Buscar: window.APP_VERSION = '
# 3. Incrementar: '8.0.0' → '9.0.0'
# 4. Buscar/substituir: ?v=8.0.0 → ?v=9.0.0 (TODOS os scripts)
# 5. Commit e deploy
```

**Vantagem:**
- ✅ Força download de TODOS os scripts em cada versão
- ✅ Sincroniza código + schema automaticamente
- ✅ Rollback fácil (mudar v=9.0.0 → v=8.0.0)

---

## Solução 2: Meta Tags Cache-Control (ADICIONAL)

**File:** `index.html` (no `<head>`)

```html
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    
    <!-- ✅ ADICIONAR: Cache control para evitar cache agressivo -->
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">
    
    <title>Concierge Collector</title>
    <!-- ... resto do head ... -->
</head>
```

**IMPORTANTE:**
- Isso NÃO previne cache de scripts (só do HTML)
- Cache busting via query params ainda é necessário
- Mas ajuda a garantir que HTML mais recente seja sempre carregado

---

## Solução 3: Schema Version Check (SAFETY NET)

**File:** `scripts/storage/dataStore.js`

**Adicionar verificação de compatibilidade:**

```javascript
async initializeDatabase(isRetry = false) {
    const dbName = 'ConciergeCollector';
    
    try {
        this.log.debug('🚀 Initializing V3 Entity Store...');
        this.db = new Dexie(dbName);
        
        // ✅ ADICIONAR: Verificar versão do código vs schema
        const EXPECTED_CODE_VERSION = window.APP_VERSION || '9.0.0';
        const EXPECTED_SCHEMA_VERSION = window.SCHEMA_VERSION || 9;
        
        // Define all schema versions
        this.db.version(3).stores({ /* v3 */ });
        this.db.version(6).stores({ /* v6 */ });
        this.db.version(7).stores({ /* v7 */ });
        this.db.version(8).stores({ /* v8 */ });
        this.db.version(9).stores({ /* v9 */ });
        
        // Add hooks
        this.addDatabaseHooks();
        
        // Open database
        await this.db.open();
        
        // ✅ VERIFICAÇÃO: Schema do DB vs esperado no código
        const actualSchemaVersion = this.db.verno;  // Dexie internal version
        
        if (actualSchemaVersion < EXPECTED_SCHEMA_VERSION) {
            this.log.error(`❌ SCHEMA MISMATCH DETECTED!`);
            this.log.error(`   Expected schema: v${EXPECTED_SCHEMA_VERSION}`);
            this.log.error(`   Actual schema: v${actualSchemaVersion}`);
            this.log.error(`   Code version: ${EXPECTED_CODE_VERSION}`);
            this.log.error('');
            this.log.error('⚠️ POSSIBLE CACHE ISSUE:');
            this.log.error('   Browser may be using cached old JavaScript.');
            this.log.error('   Action required: Hard reload (Ctrl+Shift+R or Cmd+Shift+R)');
            
            // Show user notification
            if (window.SafetyUtils) {
                window.SafetyUtils.showNotification(
                    'App update detected. Please hard reload (Ctrl+Shift+R)',
                    'warning',
                    10000
                );
            }
            
            // ⚠️ OPTIONAL: Force reload automaticamente (controverso)
            // setTimeout(() => {
            //     window.location.reload(true);  // Hard reload
            // }, 5000);
        }
        
        // Wait for DB to be ready
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (!this.db.isOpen()) {
            throw new Error('Database failed to open properly');
        }
        
        this.log.debug('✅ Database opened, initializing default data...');
        
        // ... resto do código ...
```

**Comportamento:**
- Se schema no DB < schema esperado → warning
- Mostra mensagem ao user para reload
- Opcional: força reload automático (pode ser invasivo)

---

## Solução 4: Build System com Hash (FUTURO)

**Para produção robusta (fase 3):**

```bash
# Install build tool
npm install --save-dev vite

# vite.config.js
export default {
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].[hash].js',  // Hash automático
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]'
      }
    }
  }
}

# Build produz:
# dataStore.abc123.js  (hash muda em cada mudança)
# apiService.def456.js
```

**Vantagem:**
- Hash muda automaticamente quando código muda
- Zero trabalho manual
- Cache só quebra quando necessário

---

## Implementação Recomendada

### **Phase 1 (AGORA - antes de implementar schema v9):**

1. ✅ Adicionar `window.APP_VERSION` e `window.SCHEMA_VERSION`
2. ✅ Adicionar `?v=9.0.0` em TODOS os script tags
3. ✅ Adicionar meta cache-control no HTML
4. ✅ Adicionar schema version check no dataStore.js

**Tempo:** 30 minutos

**Files a mudar:**
- `index.html` (versioning em ~40 script tags)
- `scripts/storage/dataStore.js` (adicionar check)

### **Phase 2 (Com cada deploy de schema change):**

1. Incrementar `APP_VERSION` (8.0.0 → 9.0.0)
2. Incrementar `SCHEMA_VERSION` (8 → 9)
3. Find/replace: `?v=8.0.0` → `?v=9.0.0`
4. Commit e deploy

**Tempo:** 2 minutos por deploy

### **Phase 3 (Backlog - build system):**

1. Setup Vite ou Webpack
2. Hash automático em filenames
3. Zero trabalho manual

---

## Testing Checklist

**Após implementar cache busting:**

- [ ] Deploy schema v9 no servidor
- [ ] Abrir app no browser A
- [ ] Abrir DevTools → Network tab
- [ ] Hard reload (Ctrl+Shift+R)
- [ ] Verificar: `dataStore.js?v=9.0.0` carregado (não do cache)
- [ ] Verificar: Console sem "SCHEMA MISMATCH"
- [ ] Abrir app no browser B (diferente)
- [ ] Verificar: Mesmos resultados

**Testar cache bust:**

- [ ] Deploy v9.0.0
- [ ] User carrega app → tudo OK
- [ ] User fecha aba
- [ ] Deploy v9.0.1 (pequena mudança)
- [ ] User reabre app
- [ ] Verificar: Carregou v9.0.1 (não v9.0.0 do cache)

---

## Rollback Plan

**Se algo quebrar após deploy v9:**

1. **Quick fix:** Reverter `APP_VERSION` no HTML
   ```html
   <!-- Voltar para -->
   <script>window.APP_VERSION = '8.0.0';</script>
   <script src="scripts/storage/dataStore.js?v=8.0.0"></script>
   ```

2. **Force cache clear:** Avisar users para hard reload
   ```
   "App update issue detected. Please press Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)"
   ```

3. **Nuclear option:** Mudar nome do arquivo
   ```html
   <!-- Se cache bust falhar, rename file -->
   <script src="scripts/storage/dataStore-v9.js"></script>
   ```

---

## Success Metrics

| Metric | Before | Target |
|--------|--------|--------|
| Cache-related bugs after deploy | 100% risk | 0% risk |
| Schema mismatch errors | Possible | Impossible |
| User complaints "app broken" | Likely | Zero |
| Time to fix cache issue | Manual | Automatic |

---

## Conclusão

### ✅ **Após implementar:**

1. **Cache busting** garante código + schema sincronizados
2. **Schema check** detecta mismatches e avisa user
3. **Meta tags** previnem cache agressivo do HTML
4. **Rollback** fácil se algo quebrar

### ❌ **SEM implementar:**

1. Deploy v9 → 50% de users com app quebrado
2. "App stopped working" sem explicação
3. Fix: pedir para todos fazerem hard reload manualmente
4. Reputação prejudicada

**Recomendação:** Implementar cache busting **ANTES** de qualquer schema change.

**Next action:**
```bash
# 1. Backup index.html
cp index.html index.html.backup

# 2. Implementar versioning
# (fazer as mudanças no index.html e dataStore.js)

# 3. Test localmente
# 4. Commit
# 5. Deploy
# 6. Só DEPOIS implementar schema v9
```

**Segurança:** 🔒 Com cache busting = SAFE para schema changes  
**Sem cache busting:** ⚠️ UNSAFE - alto risco de quebrar app para users
