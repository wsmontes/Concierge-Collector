# OAuth Multi-Environment Setup Guide

## ✅ O que foi implementado

O código OAuth agora funciona **automaticamente** tanto em localhost quanto no GitHub Pages, sem necessidade de alteração manual.

### 🔄 Detecção Automática de Ambiente

O sistema detecta automaticamente onde está rodando:

**Frontend (`config.js`):**
- ✅ Detecta `github.io` → modo produção
- ✅ Detecta `localhost` → modo desenvolvimento
- ✅ Ajusta URL da API automaticamente

**Backend (`auth.py`):**
- ✅ Recebe `callback_url` do frontend
- ✅ Salva URL no `state` OAuth
- ✅ Redireciona para a URL correta após login

## 📋 Setup para Localhost (Desenvolvimento)

### 1. Configuração já está pronta!

O código atual já funciona em localhost. Não precisa fazer nada.

### 2. Testar

1. Inicie a API: `./start-api.sh`
2. Abra: `http://localhost:8080`
3. Click "Login with Google"
4. Complete o OAuth
5. ✅ Será redirecionado para `http://localhost:8080` com tokens

## 🌐 Setup para GitHub Pages (Produção)

### 1. Configure o Google OAuth Console

Adicione a URL do GitHub Pages nas **Authorized redirect URIs**:

```
https://your-production-api.com/api/v3/auth/callback
```

**E nas Authorized JavaScript origins:**

```
https://wsmontes.github.io
```

### 2. Configure o Backend de Produção

Crie arquivo `.env` no servidor com:

```bash
FRONTEND_URL_PRODUCTION=https://wsmontes.github.io/Concierge-Collector
GOOGLE_OAUTH_REDIRECT_URI=https://your-production-api.com/api/v3/auth/callback
CORS_ORIGINS=["https://wsmontes.github.io"]
```

### 3. Atualize a URL da API

Em `scripts/config.js`, linha 19, atualize:

```javascript
const getApiBaseUrl = () => {
    if (isGitHubPages) {
        return 'https://your-production-api.com/api/v3';  // ← Substitua aqui
    }
    // ...
};
```

### 4. Deploy

1. **Backend:** Deploy sua API em um servidor (Heroku, Railway, DigitalOcean, etc.)
2. **Frontend:** Commit e push para GitHub
3. ✅ GitHub Pages publica automaticamente

## 🧪 Como Funciona

### Fluxo Localhost

```
1. Frontend (localhost:8080)
   ↓ callback_url=http://localhost:8080
2. Backend (/auth/google?callback_url=...)
   ↓ Salva URL no state
3. Google OAuth
   ↓ Redireciona para backend
4. Backend (/auth/callback)
   ↓ Extrai URL do state
5. Redirect → http://localhost:8080?token=...
```

### Fluxo GitHub Pages

```
1. Frontend (wsmontes.github.io)
   ↓ callback_url=https://wsmontes.github.io/Concierge-Collector
2. Backend (/auth/google?callback_url=...)
   ↓ Salva URL no state
3. Google OAuth
   ↓ Redireciona para backend
4. Backend (/auth/callback)
   ↓ Extrai URL do state
5. Redirect → https://wsmontes.github.io/Concierge-Collector?token=...
```

## 🔍 Debug

### Verificar Ambiente

Abra console (F12) e veja:

```javascript
AppConfig.environment
// {isProduction: false, isDev: true, hostname: "localhost", protocol: "http:"}
```

### Logs OAuth

No console, procure por:

```
[AuthService] Frontend URL: http://localhost:8080
[AuthService] Redirecting to: http://localhost:8000/api/v3/auth/google?callback_url=...
```

No backend (API logs):

```
[OAuth] Initiating flow
[OAuth] frontend_redirect_url: http://localhost:8080
[OAuth] ✓ Redirecting to frontend: http://localhost:8080
```

## ⚠️ Importante

### Google OAuth Console

Você **DEVE** adicionar **AMBAS** as URLs no Google OAuth Console:

**Authorized redirect URIs:**
- `http://localhost:8000/api/v3/auth/callback` (dev)
- `https://your-production-api.com/api/v3/auth/callback` (prod)

**Authorized JavaScript origins:**
- `http://localhost:8080` (dev)
- `https://wsmontes.github.io` (prod)

### Tokens OAuth

Os tokens OAuth salvos em `localStorage` são **específicos do domínio**:
- Tokens do localhost **NÃO funcionam** no GitHub Pages
- Você precisa fazer login separadamente em cada ambiente

## 🎯 Checklist Final

- [ ] Google OAuth Console configurado com ambas URLs
- [ ] `.env` do backend de produção atualizado
- [ ] `config.js` com URL da API de produção
- [ ] Backend deployado e acessível
- [ ] Frontend no GitHub Pages
- [ ] CORS configurado no backend
- [ ] Testado em localhost
- [ ] Testado no GitHub Pages

## 📝 Próximos Passos

1. **Agora:** Teste em localhost (já funciona)
2. **Depois:** Configure servidor de produção
3. **Por último:** Deploy no GitHub Pages

---

**Resumo:** O código já está pronto para ambos ambientes. Apenas configure as URLs de produção quando fizer o deploy!
