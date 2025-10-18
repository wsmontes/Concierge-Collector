# Lógica de Sincronização Corrigida

## 🎯 REGRA MESTRA SIMPLIFICADA

### Source Field - Indica Estado de Sync:
- **`source = 'remote'`** → Restaurante está SINCRONIZADO com servidor
- **`source = 'local'`** → Restaurante NÃO está sincronizado (novo OU modificado)

### Campos de Suporte:
- **`serverId`**: ID no servidor (null se nunca foi sincronizado)
- **`needsSync`**: Flag explícita (redundante com source, mas útil para queries)
- **`lastSynced`**: Timestamp da última sincronização

---

## 📋 ESTADOS E TRANSIÇÕES

### Estado 1: Novo Restaurante Local
```javascript
{
    source: 'local',
    serverId: null,
    needsSync: true,
    lastSynced: null
}
```

### Estado 2: Restaurante Sincronizado
```javascript
{
    source: 'remote',  // ← SINCRONIZADO
    serverId: 123,
    needsSync: false,
    lastSynced: '2025-10-18T...'
}
```

### Estado 3: Restaurante Editado (antes sincronizado)
```javascript
{
    source: 'local',   // ← VOLTA PARA LOCAL (precisa re-sync)
    serverId: 123,     // ← MANTÉM serverId (não é novo)
    needsSync: true,
    lastSynced: '2025-10-18T...'  // ← Última vez que estava em sync
}
```

---

## 🔄 OPERAÇÕES

### CREATE (novo restaurante)
```javascript
await saveRestaurant(...);
// Result:
{
    source: 'local',
    serverId: null,
    needsSync: true,
    lastSynced: null
}
```

### UPDATE (editar existente)
```javascript
await updateRestaurant(id, ...);
// Result - SEMPRE muda para 'local':
{
    source: 'local',   // ← SEMPRE 'local' após edição
    serverId: <preservado>,
    needsSync: true,
    lastSynced: <preservado>
}
```

### SYNC SUCCESS (upload para servidor)
```javascript
// POST /api/restaurants
// Response: { id: 123 }
await db.restaurants.update(id, {
    source: 'remote',  // ← Agora está sincronizado
    serverId: 123,
    needsSync: false,
    lastSynced: new Date()
});
```

### IMPORT FROM SERVER (download do servidor)
```javascript
// GET /api/restaurants
// Para cada restaurante do servidor:

// Se não existe localmente:
await saveRestaurant(..., 'remote', serverId);
// Result: { source: 'remote', serverId: X, needsSync: false }

// Se existe E needsSync=false:
await updateRestaurant(...);
await db.restaurants.update(id, {
    source: 'remote',
    needsSync: false,
    lastSynced: new Date()
});

// Se existe E needsSync=true:
// SKIP - tem mudanças locais pendentes
```

---

## 🎨 UI - Badges e Indicadores

### Badge "Local"
- Condição: `source === 'local'`
- Cor: Verde/Amarelo
- Ícone: 📱
- Tooltip: "Não sincronizado" ou "Modificado localmente"

### Badge "Synced"
- Condição: `source === 'remote'`
- Cor: Azul
- Ícone: ☁️
- Tooltip: "Sincronizado com servidor"

### Sync Button
- Visível quando: `restaurantsNeedingSync.length > 0`
- Query: `where('needsSync').equals(true)`
- Badge: Contagem de restaurantes

---

## 🔍 QUERIES ÚTEIS

### Restaurantes Precisando Sync
```javascript
db.restaurants.where('needsSync').equals(true).toArray()
// OU
db.restaurants.where('source').equals('local').toArray()
```

### Restaurantes Sincronizados
```javascript
db.restaurants.where('source').equals('remote').toArray()
```

### Restaurantes Novos (nunca sincronizados)
```javascript
db.restaurants
    .where('source').equals('local')
    .and(r => r.serverId === null)
    .toArray()
```

### Restaurantes Modificados (já foram sincronizados antes)
```javascript
db.restaurants
    .where('source').equals('local')
    .and(r => r.serverId !== null)
    .toArray()
```

---

## ✅ BENEFÍCIOS

1. **Simplicidade**: Source = estado de sync, não origem
2. **Clareza Visual**: Fácil ver o que está ou não sincronizado
3. **Performance**: Queries simples e indexadas
4. **Offline-First**: Funciona offline, sincroniza quando online
5. **Sem Ambiguidade**: `'local'` = não sincronizado, `'remote'` = sincronizado

