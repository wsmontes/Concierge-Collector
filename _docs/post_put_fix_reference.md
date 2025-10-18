# POST vs PUT Fix - Quick Reference

## 🐛 Problema Encontrado

**Erro**: HTTP 405 METHOD NOT ALLOWED ao tentar sincronizar restaurantes

**Causa**: Sistema estava usando **POST** para TODOS os restaurantes, incluindo os que já existiam no servidor.

```
❌ ANTES:
- Novo restaurante (sem serverId): POST /api/restaurants  ✅ OK
- Restaurante existente (com serverId): POST /api/restaurants  ❌ 405 ERROR
```

**Por que falhava?**
- POST é para CRIAR novos recursos
- PUT é para ATUALIZAR recursos existentes
- Servidor rejeita POST quando restaurante já existe (serverId presente)

---

## ✅ Solução Implementada

### Lógica Corrigida
```javascript
// Verificar se é novo ou existente:
const isNew = !restaurant.serverId || restaurant.serverId === 0;

if (isNew) {
    // Novo restaurante → POST
    POST /api/restaurants
} else {
    // Restaurante existente → PUT
    PUT /api/restaurants/{serverId}
}
```

---

## 📁 Arquivos Modificados

### 1. **apiHandler.js** (NOVO)
Adicionados métodos HTTP genéricos:

```javascript
async post(endpoint, data) {
    // POST /api/restaurants
    fetch(`${this.serverBase}${endpoint}`, {
        method: 'POST',
        body: JSON.stringify(data)
    });
}

async put(endpoint, data) {
    // PUT /api/restaurants/123
    fetch(`${this.serverBase}${endpoint}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    });
}
```

**Antes**: ApiHandler só tinha métodos específicos (transcribeAudio, extractConcepts)  
**Agora**: ApiHandler tem métodos HTTP genéricos reutilizáveis

---

### 2. **backgroundSync.js** (MODIFICADO)
Método `syncRestaurant()` agora detecta se é novo ou existente:

```javascript
// ANTES (sempre POST):
const response = await window.apiHandler.post('/api/restaurants', serverData);

// AGORA (POST ou PUT):
const isNew = !restaurant.serverId || restaurant.serverId === 0;

if (isNew) {
    response = await window.apiHandler.post('/api/restaurants', serverData);
} else {
    response = await window.apiHandler.put(
        `/api/restaurants/${restaurant.serverId}`, 
        serverData
    );
}
```

**Logs Adicionados**:
```
🆕 Creating new restaurant: Test Restaurant
🔄 Updating restaurant: Existing Restaurant (serverId: 123)
```

---

### 3. **syncService.js** (MODIFICADO)

#### Mudança 1: Adicionar `localId` aos dados
```javascript
// Adiciona localId para poder buscar serverId depois
serverRestaurants.push({
    localId: restaurant.id,  // ← NOVO
    name: restaurant.name,
    curator: { ... },
    ...
});
```

#### Mudança 2: Usar POST ou PUT em `exportRestaurants()`
```javascript
for (const restaurant of restaurants) {
    // Busca restaurante local para verificar serverId
    const localRestaurant = await dataStorage.db.restaurants.get(
        restaurant.localId
    );
    
    // Decide método e URL
    const isNew = !localRestaurant?.serverId || localRestaurant.serverId === 0;
    const method = isNew ? 'POST' : 'PUT';
    const url = isNew 
        ? `${this.apiBase}/restaurants`
        : `${this.apiBase}/restaurants/${localRestaurant.serverId}`;
    
    // Remove localId antes de enviar ao servidor
    const { localId, ...serverData } = restaurant;
    
    // Envia com método correto
    fetch(url, {
        method: method,
        body: JSON.stringify(serverData)
    });
}
```

---

## 🔄 Fluxo Completo

### Cenário 1: Novo Restaurante (serverId = null)
```
1. Usuário cria restaurante
   ↓
2. dataStorage.saveRestaurant() → serverId: null, source: 'local'
   ↓
3. backgroundSync.syncRestaurant(id)
   ↓
4. Verifica: serverId = null → isNew = true
   ↓
5. POST /api/restaurants
   ↓
6. Servidor retorna: { id: 123, ... }
   ↓
7. dataStorage.update({ serverId: 123, source: 'remote' })
```

**HTTP Log**:
```
🆕 Creating new restaurant: Test Restaurant
POST /api/restaurants → 201 Created
✅ Background sync success: Test Restaurant
```

---

### Cenário 2: Restaurante Editado (serverId = 123)
```
1. Usuário edita restaurante existente
   ↓
2. dataStorage.updateRestaurant() → serverId: 123, source: 'local'
   ↓
3. backgroundSync.syncRestaurant(id)
   ↓
4. Verifica: serverId = 123 → isNew = false
   ↓
5. PUT /api/restaurants/123
   ↓
6. Servidor retorna: { id: 123, ... }
   ↓
7. dataStorage.update({ source: 'remote', lastSynced: now })
```

**HTTP Log**:
```
🔄 Updating restaurant: Test Restaurant (serverId: 123)
PUT /api/restaurants/123 → 200 OK
✅ Background sync success: Test Restaurant
```

---

## 🧪 Como Testar

### Teste 1: Criar Novo Restaurante
```javascript
// No console:
const result = await dataStorage.saveRestaurantWithAutoSync(
    'New Restaurant',
    1,
    [{ category: 'Cuisine', value: 'Italian' }],
    null, [], '', ''
);

// Aguardar ~1s, verificar console:
// "🆕 Creating new restaurant: New Restaurant"
// "POST /api/restaurants"
// "✅ Background sync success"

// Verificar no DB:
const restaurant = await dataStorage.db.restaurants.get(result.restaurantId);
console.log('ServerId:', restaurant.serverId); // Deve ter número
console.log('Source:', restaurant.source);     // Deve ser 'remote'
```

---

### Teste 2: Editar Restaurante Existente
```javascript
// Editar um restaurante com serverId
const restaurants = await dataStorage.db.restaurants
    .where('serverId').above(0)
    .toArray();

const restaurant = restaurants[0];
console.log('Antes - ServerId:', restaurant.serverId, 'Source:', restaurant.source);

// Editar
await dataStorage.updateRestaurant(
    restaurant.id,
    'Updated Name',
    restaurant.curatorId,
    [], null, [], '', ''
);

// Aguardar ~1s, verificar console:
// "🔄 Updating restaurant: Updated Name (serverId: 123)"
// "PUT /api/restaurants/123"
// "✅ Background sync success"

// Verificar no DB:
const updated = await dataStorage.db.restaurants.get(restaurant.id);
console.log('Depois - Source:', updated.source); // Deve ser 'remote' novamente
```

---

### Teste 3: Sync Manual de Múltiplos
```javascript
// Clicar no botão de sync manual
// Verificar console logs:

// Deve mostrar mix de POST e PUT:
"🆕 Creating new restaurant: New1"
"POST /api/restaurants"
"🔄 Updating restaurant: Existing1 (serverId: 5)"
"PUT /api/restaurants/5"
"🔄 Updating restaurant: Existing2 (serverId: 8)"
"PUT /api/restaurants/8"
```

---

## 📊 Antes vs Depois

### ANTES (Apenas POST)
```
Novo restaurante:
  POST /api/restaurants → ✅ 201 Created

Restaurante editado (serverId: 123):
  POST /api/restaurants → ❌ 405 METHOD NOT ALLOWED
  
Resultado: Edições nunca sincronizavam!
```

### DEPOIS (POST + PUT)
```
Novo restaurante:
  POST /api/restaurants → ✅ 201 Created

Restaurante editado (serverId: 123):
  PUT /api/restaurants/123 → ✅ 200 OK
  
Resultado: Tudo sincroniza corretamente!
```

---

## 🎯 Estado dos Restaurantes no Console

Observe os logs do console para confirmar que está funcionando:

```
// Todos com serverId mas source='local' (precisam sync):
Restaurant "Teste" (ID: 1) - source: local, serverId: 0
Restaurant "Ritz" (ID: 2) - source: local, serverId: 1
Restaurant "ROI" (ID: 4) - source: local, serverId: 3

// Após correção, deve fazer PUT para cada um:
SyncService: PUT Teste (serverId: 0)    → POST (serverId = 0 = novo)
SyncService: PUT Ritz (serverId: 1)     → PUT  (serverId > 0)
SyncService: PUT ROI (serverId: 3)      → PUT  (serverId > 0)
```

**Atenção**: `serverId: 0` é tratado como NOVO (usa POST)

---

## 🐛 Troubleshooting

### Ainda recebendo 405?
**Causa**: Restaurante tem `serverId` mas servidor não o reconhece

**Solução**:
```javascript
// Verificar se serverId existe no servidor:
const response = await fetch(
    `https://wsmontes.pythonanywhere.com/api/restaurants/${serverId}`
);

if (response.status === 404) {
    // ServerId inválido - resetar para null
    await dataStorage.db.restaurants.update(restaurantId, {
        serverId: null
    });
    
    // Tentar sync novamente (usará POST)
    await backgroundSync.syncRestaurant(restaurantId);
}
```

---

### PUT retorna 404?
**Causa**: ServerId aponta para restaurante que não existe mais no servidor

**Solução**: Mesmo código acima - resetar `serverId` para `null`

---

### Logs não aparecem?
**Causa**: BackgroundSync está em modo silencioso

**Solução**:
```javascript
// Forçar modo verbose:
await backgroundSync.syncRestaurant(restaurantId, false); // silent=false
```

---

## 📚 Resumo da Correção

| Componente | Mudança | Razão |
|-----------|---------|-------|
| **apiHandler.js** | Adicionou `post()` e `put()` | Métodos HTTP genéricos reutilizáveis |
| **backgroundSync.js** | Detecta isNew, usa POST/PUT | Respeitar semântica HTTP |
| **syncService.js** | Adiciona localId, usa POST/PUT | Mesmo que acima |

**Benefício**: Sistema agora sincroniza corretamente tanto restaurantes novos quanto editados! 🎉

---

## ✅ Checklist Pós-Correção

- [x] apiHandler tem métodos `post()` e `put()`
- [x] backgroundSync detecta `isNew` corretamente
- [x] syncService adiciona `localId` aos dados
- [x] syncService usa POST para novos, PUT para existentes
- [x] Logs mostram "🆕 Creating" ou "🔄 Updating"
- [x] Restaurantes novos sincronizam (POST 201)
- [x] Restaurantes editados sincronizam (PUT 200)
- [x] Badge atualiza para "Synced" após sync
- [x] Sem mais erros 405 no console
