# Análise Completa dos Mecanismos de Sincronização

## 🔍 PROBLEMA IDENTIFICADO

**Sintoma:** Restaurante marcado como `source='remote'` vira `source='local'` após sync.

**Causa Raiz:** Lógica de sincronização conflitante em múltiplos pontos do código.

---

## 📊 ANÁLISE DOS DADOS DISPONÍVEIS

### Campos de Sincronização por Restaurante:

1. **`source`**: `'local'` | `'remote'` | `'google_places'` | etc.
2. **`serverId`**: ID do restaurante no servidor (null se nunca sincronizado)
3. **`timestamp`**: Data de criação/modificação local
4. **`lastSynced`**: Data da última sincronização (quando existe)

### Estados Possíveis:

| Estado | source | serverId | Significado |
|--------|--------|----------|-------------|
| 1 | `'local'` | `null` | Criado localmente, nunca sincronizado |
| 2 | `'local'` | `123` | Criado localmente, já sincronizado mas modificado depois |
| 3 | `'remote'` | `123` | Baixado do servidor, não modificado localmente |
| 4 | `'remote'` | `null` | **INCONSISTENTE** - Não deveria existir |

---

## 🐛 PROBLEMAS ATUAIS

### 1. **updateRestaurant() - linha 1480**
```javascript
// Always mark as 'local' when updating, even if it was originally remote
const source = 'local';
```
**Problema:** Qualquer edição marca como local, mesmo se foi só visualizar.

### 2. **syncService.importRestaurants() - linha 114**
```javascript
if (existingRestaurant.source === 'remote') {
    // Update...
} else {
    results.skipped++;
    console.log('Skipping update because it has local changes');
}
```
**Problema:** Não atualiza restaurantes com `source='local'`, mesmo se não foram modificados desde o último sync.

### 3. **exportImportModule.syncWithServer() - linhas 849-930**
```javascript
// Compara local vs remote
const comparison = dataStorage.compareRestaurants(localRest, serverRest);
```
**Problema:** Compara TODOS locais com TODOS remotos, criando conflitos desnecessários.

### 4. **Conflito de Lógica:**
- `updateRestaurant()` marca tudo como `'local'`
- `importRestaurants()` só atualiza se for `'remote'`
- Resultado: Restaurante do servidor editado localmente NUNCA recebe updates do servidor

---

## 💡 SOLUÇÃO INTELIGENTE

### Princípios da Nova Lógica:

1. **Source of Truth:** `serverId` é o identificador único
2. **Dirty Flag:** Usar timestamp + lastSynced para detectar modificações
3. **Merge Inteligente:** Comparar timestamps server vs local
4. **Preservar Local:** Nunca sobrescrever mudanças locais não sincronizadas

### Novo Fluxo:

```
┌─────────────────────────────────────────────────────────────┐
│  REGRA MESTRA: serverId determina se é o mesmo restaurante  │
└─────────────────────────────────────────────────────────────┘

CRIAR NOVO:
  → source = 'local'
  → serverId = null
  → needsSync = true

EDITAR EXISTENTE:
  → source PERMANECE INALTERADO
  → serverId PRESERVADO
  → timestamp = now()
  → needsSync = true (flag de pendência)

SYNC LOCAL → SERVER:
  Se needsSync:
    → POST ao servidor
    → Recebe serverId
    → source = 'remote'
    → lastSynced = now()
    → needsSync = false

SYNC SERVER → LOCAL:
  Se serverId existe localmente:
    Se server.timestamp > local.lastSynced:
      → MERGE (server vence se não houver mudanças locais pendentes)
    Senão:
      → SKIP (versão local é mais nova)
  Senão:
    → CREATE LOCAL (novo do servidor)
    → source = 'remote'
    → serverId = server.id
```

---

## 🔧 PLANO DE IMPLEMENTAÇÃO

### Etapa 1: Adicionar Campo `needsSync`
- Migração database v12
- Boolean flag para indicar pendência de sincronização

### Etapa 2: Refatorar `updateRestaurant()`
- **NÃO** mudar source
- **APENAS** setar `needsSync = true` e `timestamp = now()`

### Etapa 3: Refatorar `saveRestaurant()`
- Novos: `source='local'`, `serverId=null`, `needsSync=true`
- Preservar lógica atual para outros casos

### Etapa 4: Refatorar `saveRestaurantWithAutoSync()`
- Após sync bem-sucedido:
  - `source='remote'`
  - `serverId=<server_id>`
  - `needsSync=false`
  - `lastSynced=now()`

### Etapa 5: Refatorar `syncService.importRestaurants()`
- Comparar por `serverId` (única fonte de verdade)
- Se `serverId` existe localmente:
  - Se `needsSync=true`: SKIP (local tem mudanças pendentes)
  - Senão: UPDATE (aceitar versão do servidor)
- Se `serverId` não existe:
  - CREATE novo restaurante local

### Etapa 6: Refatorar `exportImportModule.syncWithServer()`
- Upload: Apenas restaurantes com `needsSync=true`
- Download: Importar todos do servidor
- Conflict Resolution: Usar `needsSync` + timestamps
- Não comparar local vs remote indiscriminadamente

### Etapa 7: Adicionar `getRestaurantsNeedingSync()`
- Query otimizada: `where('needsSync').equals(true)`
- Usar no botão de sync da UI

### Etapa 8: Atualizar UI
- Ícone diferenciado para `needsSync=true` (⏳ pendente)
- Badge de contagem usa `needsSync` em vez de `source='local'`

---

## ✅ BENEFÍCIOS

1. **Consistência:** Source não muda arbitrariamente
2. **Performance:** Queries otimizadas via `needsSync` index
3. **Clareza:** Estado de sync explícito, não inferido
4. **Confiabilidade:** Menos conflitos, mais automação
5. **Offline-First:** Funciona offline, sincroniza quando online
6. **Bidirecional:** Server pode atualizar local sem perder mudanças locais

---

## 🎯 REGRAS FINAIS

| Ação | source | serverId | needsSync | lastSynced |
|------|--------|----------|-----------|------------|
| Create Local | `'local'` | `null` | `true` | `null` |
| Edit | **unchanged** | **preserved** | `true` | **unchanged** |
| Sync Success | `'remote'` | `<id>` | `false` | `now()` |
| Import from Server | `'remote'` | `<id>` | `false` | `now()` |
| Conflict Local Wins | **unchanged** | **preserved** | `true` | **unchanged** |
| Conflict Server Wins | `'remote'` | `<id>` | `false` | `now()` |

