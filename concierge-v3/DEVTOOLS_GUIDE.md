# 🛠️ DevTools Guide

## Como Usar o Console In-App

**Agora você tem feedback visual diretamente no app!** Não precisa mais abrir o console do browser.

### Acessar o DevTools

1. Olhe no canto inferior direito da tela
2. Verá um **botão roxo flutuante** com ícone de código `</>`
3. Clique para abrir o painel

### Abas Disponíveis

#### 📜 **Logs**
Mostra todos os logs da aplicação:
- 🔵 **INFO** - Informações gerais
- 🟢 **SUCCESS** - Operações bem-sucedidas
- 🔴 **ERROR** - Erros
- 🟡 **WARNING** - Avisos
- 🌐 **NETWORK** - Chamadas de API

**Exemplo de logs que você verá:**
```
[14:32:15] INFO: Recording found { duration: 120, size: 45678 }
[14:32:16] INFO: Audio converted { base64Length: 61234 }
[14:32:17] SUCCESS: 🟢 API POST /ai/transcribe → 200 OK { duration: 1542ms }
[14:32:17] SUCCESS: Transcription complete { textLength: 456 }
```

#### 🗄️ **Stores**
Visualiza o estado dos stores Svelte:
- **Curations Store**: Total, published, draft
- **User Store**: Dados do usuário
- Expandir para ver objetos completos em JSON

#### 🌐 **Network**
Filtra apenas chamadas de API:
- Sucesso (verde): Status 200-299
- Erro (vermelho): Status 400+
- Mostra método, endpoint, status e duração

### Ações Disponíveis

- **📋 Copy**: Copia todos os logs para clipboard
- **🗑️ Clear**: Limpa todos os logs
- **✕**: Fecha o painel

### Logs Estruturados

O sistema usa um logger customizado com emojis para identificação rápida:

```typescript
import { logger } from '$lib/utils/logger';

// Diferentes tipos de logs
logger.info('Mensagem informativa', { data });
logger.success('Operação concluída!', { result });
logger.error('Algo deu errado', error);
logger.warn('Atenção', { warning });

// Logs especializados
logger.api('/endpoint', { method: 'POST', status: 200, duration: 150 });
logger.store('curations', 'update', { id: 123 });
logger.db('insert', 'recordings', { count: 1 });
logger.action('Button Click', { buttonId: 'save' });

// Performance timing
logger.time('Operation');
// ... código ...
logger.timeEnd('Operation'); // Mostra duração
```

### Exemplo de Uso Real

Quando você clicar em **"Transcribe"** na página de edição, verá:

```
👆 User Action: Transcribe Audio { curationId: "abc123" }
⏱️ Transcription: começou
💾 DB [recordings] query { curationId: "abc123" }
ℹ️ Recording found { duration: 120, size: 45678 }
⏱️ Blob to Base64: começou
⏱️ Blob to Base64: 245ms
ℹ️ Audio converted { base64Length: 61234 }
🌐 API POST /ai/transcribe
🟢 API POST /ai/transcribe → 200 OK { duration: 1542ms }
✅ Transcription complete { textLength: 456 }
🗄️ Store [curations] update { id: "abc123", field: "transcription" }
⏱️ Transcription: 1850ms
```

### Interceptação Automática

O DevTools intercepta automaticamente:
- ✅ `console.log()` → INFO
- ✅ `console.error()` → ERROR
- ✅ `console.warn()` → WARNING
- ✅ `fetch()` → NETWORK (com status e duração)

### Dicas

1. **Deixe o painel aberto** durante testes para ver feedback em tempo real
2. **Use "Copy"** para compartilhar logs comigo quando precisar de ajuda
3. **Network tab** mostra todas as chamadas de API com status codes
4. **Stores tab** ajuda a debugar estado da aplicação
5. Logs ficam **salvos até você dar Clear** ou recarregar a página

### Mobile

No celular, o botão fica **acima da navegação inferior** para não sobrepor.

---

**Agora você tem visibilidade total! 🎉**
