# Frontend Scripts Organization

Esta pasta contém todos os scripts JavaScript do frontend, organizados por responsabilidade.

---

## 📁 Estrutura

### `/core` - Sistema Base
**Arquivos fundamentais carregados primeiro**
- `config.js` - Configurações globais e endpoints da API
- `logger.js` - Sistema centralizado de logging
- `moduleWrapper.js` - Padrão para criação de módulos
- `main.js` - Ponto de entrada da aplicação

### `/auth` - Autenticação e Controle de Acesso
**Gerenciamento de usuários e permissões**
- `auth.js` - OAuth Google e JWT token management
- `accessControl.js` - Controle de acesso às features
- `curatorProfile.js` - Perfil do curador

### `/storage` - Persistência de Dados
**IndexedDB e gerenciamento de dados locais**
- `dataStore.js` - Interface principal do IndexedDB
- `dataStorage.js` - Operações de armazenamento
- `dataStorageWrapper.js` - Wrapper para compatibilidade

### `/sync` - Sincronização
**Sincronização entre frontend e backend**
- `syncManagerV3.js` - Gerenciador principal de sync
- `syncSettingsManager.js` - Configurações de sync
- `importManager.js` - Importação de dados externos

### `/services` - Serviços
**Comunicação com APIs e serviços externos**
- `apiService.js` - Cliente HTTP para API V3
- `conceptMatcher.js` - Matching de conceitos
- `findEntityModal.js` - Modal de busca Google Places
- `promptTemplate.js` - Templates para AI prompts

### `/ui-core` - UI Framework
**Componentes base de interface**
- `uiManager.js` - Gerenciador central da UI
- `uiUtils.js` - Utilitários de UI
- `modalManager.js` - Sistema de modais
- `navigationManager.js` - Navegação entre views
- `bottomSheet.js` - Bottom sheets mobile
- `gestureManager.js` - Gestos touch
- `skeletonLoader.js` - Loading skeletons
- `lazyLoader.js` - Lazy loading de imagens
- `optimisticUI.js` - Updates otimistas
- `emptyStateManager.js` - Estados vazios
- `accessibilityChecker.js` - Verificações A11y

### `/managers` - State Management
**Gerenciadores de estado e workflows**
- `stateStore.js` - Store de estado global
- `errorManager.js` - Gerenciamento de erros
- `formManager.js` - Validação de formulários
- `progressManager.js` - Indicadores de progresso

### `/modules` - Módulos de Feature
**Módulos funcionais completos**
- `recordingModule.js` - Gravação de áudio
- `conceptModule.js` - Extração de conceitos
- `entityModule.js` - Gerenciamento de entidades
- `curatorModule.js` - Features do curador
- `syncStatusModule.js` - Status de sincronização
- `placesModule.js` - Google Places integration

### `/ui` - Componentes UI Específicos
**Componentes de interface especializados**
- Componentes reutilizáveis de UI

### `/utils` - Utilitários
**Funções auxiliares**
- Helpers e utilidades gerais

### `/legacy` - Código Legado
**Código mantido por compatibilidade**
- `apiHandler.js` - Handler antigo da API
- `audioRecorder.js` - Gravador de áudio legado

### `/python-tools` - Ferramentas Python
**Scripts Python para operações administrativas**
- `render_deployment_manager.py` - Gerenciamento de deploys Render
- `fetch_render_logs.py` - Download de logs do Render
- `import_concepts.py` - Importação de conceitos
- `import_concepts_api.py` - Importação via API
- `import_curations.py` - Importação de curadorias
- `generate_embeddings.py` - Geração de embeddings
- `requirements-render.txt` - Dependências Python

---

## 🔄 Ordem de Carregamento

Os scripts são carregados no `index.html` nesta ordem:

1. **Core** (config, logger, moduleWrapper)
2. **UI Core** (uiUtils, managers)
3. **Storage** (dataStore)
4. **Services** (apiService)
5. **Sync** (syncManager)
6. **Modules** (recording, concept, entity)
7. **Auth** (auth, accessControl)
8. **Main** (inicialização)

---

## 📝 Convenções

### Padrão ModuleWrapper
Todos os módulos devem usar o padrão ModuleWrapper:

```javascript
const MyModule = ModuleWrapper.create('MyModule', {
    initialize() {
        // Setup
    },
    
    myMethod() {
        // Implementation
    }
});
```

### Logging
Use o logger centralizado:

```javascript
this.log.info('Message');
this.log.warn('Warning');
this.log.error('Error', error);
```

### Dependências
Declare dependências explicitamente no início do arquivo:

```javascript
/**
 * MyModule
 * Dependencies: window.DataStore, window.ApiService
 */
```

---

## 🚀 Desenvolvimento

### Adicionar Novo Módulo

1. Escolha a pasta apropriada baseada na responsabilidade
2. Use o padrão ModuleWrapper
3. Adicione referência no `index.html` na ordem correta
4. Documente dependências

### Testar Localmente

```bash
python -m http.server 8000
# Abra http://localhost:8000
```

---

## 📦 Build/Deploy

O frontend é uma **Single Page Application** estática:
- Sem build step necessário
- Deploy direto no Render.com
- Cache busting via query params (`?v=timestamp`)
