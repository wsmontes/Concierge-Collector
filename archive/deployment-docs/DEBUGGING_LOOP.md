# 🐛 Debugging Loop Issues

## Problema Identificado

O bug de loop estava sendo causado por múltiplas chamadas a `window.startApplication()` no módulo `accessControl.js`.

## O que foi corrigido

### Antes (BUG):
```javascript
// accessControl.js - função checkAccess()
if (hasAccess()) {
    // Chamava startApplication duas vezes!
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', window.startApplication); // Chamada #1
    } else {
        window.startApplication(); // Chamada #2
    }
}
```

### Depois (CORRIGIDO):
```javascript
// accessControl.js - função checkAccess()
if (hasAccess()) {
    // Agora chama apenas initializeApp, que chama startApplication uma vez
    initializeApp();
}
```

## Como Investigar Loops

### 1. Use o Script de Debug

Cole no console do browser (F12):

```javascript
// Salvar no arquivo: debug-loop.js
// Ou copiar e colar no console

console.clear();
console.log('🔍 DEBUG: Interceptando chamadas a startApplication...\n');

const originalStartApplication = window.startApplication;
let callCount = 0;

window.startApplication = function() {
    callCount++;
    console.group(`🔴 startApplication CALL #${callCount}`);
    console.log('⏰ Timestamp:', new Date().toISOString());
    console.log('📍 Call Stack:');
    console.trace();
    console.groupEnd();
    
    if (originalStartApplication && typeof originalStartApplication === 'function') {
        return originalStartApplication.apply(this, arguments);
    }
};

console.log('✅ Debug instalado! Recarregue a página.\n');
```

### 2. Verifique os Logs no Console

Após a correção, você deve ver:

```
🔐 AccessControl: Script loaded, checking access...
📄 AccessControl: DOM already loaded, calling checkAccess() immediately
Access granted - user previously authenticated
🔓 AccessControl: initializeApp() called
✅ AccessControl: window.startApplication is ready, calling it now
🔵 startApplication called, applicationStarted: false
🚀 Starting Concierge Collector application...
```

**SE AINDA HOUVER LOOP**, você verá múltiplas chamadas:
```
🔵 startApplication called, applicationStarted: false
🔵 startApplication called, applicationStarted: true  ⚠️ PROBLEMA!
⚠️ Application already started, ignoring duplicate call
```

### 3. Checar Listeners de Eventos

No console:
```javascript
// Ver todos os event listeners do document
getEventListeners(document);

// Ver especificamente DOMContentLoaded
getEventListeners(document).DOMContentLoaded;
```

### 4. Verificar localStorage

No console:
```javascript
// Ver se tem acesso
console.log('Access:', localStorage.getItem('concierge_access_granted'));
console.log('Timestamp:', localStorage.getItem('concierge_access_timestamp'));

// Resetar acesso (se necessário testar login)
localStorage.removeItem('concierge_access_granted');
localStorage.removeItem('concierge_access_timestamp');
location.reload();
```

## Fluxo de Inicialização Correto

```
1. index.html carrega
   ↓
2. accessControl.js carrega
   ↓
3. AccessControl.checkAccess() é chamado
   ↓
4. Se hasAccess() === true:
   → initializeApp()
     → Espera window.startApplication estar definido
       → Chama window.startApplication() UMA VEZ ✅
   ↓
5. Se hasAccess() === false:
   → showPasswordPrompt()
     → Usuário digita senha
       → verifyPassword()
         → Se correto: initializeApp()
           → Chama window.startApplication() UMA VEZ ✅
```

## Pontos de Verificação

### ✅ Garantias de Segurança

1. **Flag `applicationStarted`** em `main.js`:
   ```javascript
   if (applicationStarted) {
       console.warn('⚠️ Application already started, ignoring duplicate call');
       return;
   }
   ```

2. **Chamada única em `initializeApp()`**:
   - Só chama `startApplication()` uma vez
   - Usa `checkAndStart()` recursivo para esperar definição

3. **Chamada única em `checkAccess()`**:
   - Agora só chama `initializeApp()` (não mais `startApplication` diretamente)

## Problemas Comuns

### 🔴 Loop infinito
**Sintomas**: Console com centenas de logs repetidos
**Causa**: Múltiplas chamadas a `startApplication()`
**Solução**: ✅ Já corrigido neste commit

### 🟡 Inicialização dupla
**Sintomas**: `startApplication called` aparece 2 vezes
**Causa**: `checkAccess()` chamando tanto via `addEventListener` quanto direto
**Solução**: ✅ Já corrigido neste commit

### 🟢 Inicialização lenta
**Sintomas**: Demora para aparecer a interface
**Causa**: `checkAndStart()` esperando `window.startApplication` ser definido
**Solução**: Normal, timeout de 50ms é esperado

## Testes

### Teste 1: Usuário com acesso
1. Certifique que `localStorage` tem `concierge_access_granted`
2. Recarregue a página
3. Verifique console: deve ter apenas 1 chamada a `startApplication`

### Teste 2: Usuário sem acesso
1. Limpe localStorage: `localStorage.clear()`
2. Recarregue a página
3. Digite senha correta
4. Verifique console: deve ter apenas 1 chamada a `startApplication`

### Teste 3: Debug script
1. Cole o debug script no console
2. Recarregue a página
3. Deve mostrar call stack de cada chamada
4. Deve ter apenas 1 chamada

## Arquivos Modificados

- ✅ `scripts/accessControl.js` - Corrigido `checkAccess()` para não chamar `startApplication` múltiplas vezes
- ✅ `scripts/accessControl.js` - Adicionado logs detalhados
- 📝 `debug-loop.js` - Script de diagnóstico criado
- 📝 `DEBUGGING_LOOP.md` - Este documento

## Próximos Passos

Se ainda houver problemas:

1. **Execute o debug script** e capture os logs
2. **Verifique o Network tab** do DevTools para ver se há scripts carregando múltiplas vezes
3. **Verifique o Sources tab** para ver se há breakpoints ou pausas inesperadas
4. **Limpe o cache** do browser: Ctrl+Shift+R (ou Cmd+Shift+R no Mac)
