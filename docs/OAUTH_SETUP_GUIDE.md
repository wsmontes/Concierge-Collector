<!--
Purpose: Documentar configuração e operação do OAuth Google no fluxo atual da API V3.
Main responsibilities: Definir setup, endpoints válidos e regras de autenticação (Bearer e API key) sem drift com runtime.
Dependencies: concierge-api-v3/app/api/auth.py, concierge-api-v3/app/api/{entities.py,curations.py,ai.py}, concierge-api-v3/app/core/config.py.
-->

# Google OAuth Setup Guide

> **Status:** Ativo — alinhado ao runtime em 2026-02-18.

## Overview

OAuth é o mecanismo de autenticação de usuário da aplicação web. A API também aceita `X-API-Key` em endpoints protegidos para integrações/scripts.

Regra operacional atual:
- **Usuário web:** `Authorization: Bearer <jwt_token>`
- **Integração/sistema:** `X-API-Key: <api_secret_key>`

## Source of Truth

- Auth router: `concierge-api-v3/app/api/auth.py`
- Protected write routes: `concierge-api-v3/app/api/entities.py`, `concierge-api-v3/app/api/curations.py`, `concierge-api-v3/app/api/ai.py`

## Setup

### 1) Criar credenciais Google OAuth

1. Acesse [Google Cloud Console](https://console.cloud.google.com/)
2. Crie/selecione projeto
3. Vá em **APIs & Services > Credentials**
4. Crie **OAuth 2.0 Client ID** (Web application)
5. Configure redirect URI de backend:

```text
http://localhost:8000/api/v3/auth/callback
```

### 2) Configurar ambiente backend

No `concierge-api-v3/.env`:

```bash
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8000/api/v3/auth/callback
API_SECRET_KEY=your-generated-secret-key
```

Gerar `API_SECRET_KEY`:

```bash
python -c 'import secrets; print(secrets.token_urlsafe(32))'
```

### 3) Subir API

```bash
cd concierge-api-v3
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## Endpoints de autenticação (runtime atual)

```text
GET  /api/v3/auth/google      - Inicia OAuth
GET  /api/v3/auth/callback    - Callback OAuth
POST /api/v3/auth/refresh     - Renova access token
POST /api/v3/auth/logout      - Logout
```

Observação: o router atual **não expõe** `/api/v3/auth/verify`.

## Endpoints protegidos (relevantes)

Aceitam **Bearer JWT ou X-API-Key**:

```text
POST   /api/v3/entities
PATCH  /api/v3/entities/{id}
DELETE /api/v3/entities/{id}

POST   /api/v3/curations
PATCH  /api/v3/curations/{id}
DELETE /api/v3/curations/{id}

POST   /api/v3/ai/orchestrate
POST   /api/v3/ai/extract-restaurant-name
```

Públicos:

```text
GET /api/v3/ai/health
GET /api/v3/ai/usage-stats
GET /api/v3/entities* (leituras)
GET /api/v3/curations* (leituras/buscas)
```

## Fluxo OAuth (resumo)

1. Frontend chama `GET /api/v3/auth/google`
2. Usuário autentica no Google
3. Google redireciona para `GET /api/v3/auth/callback`
4. Backend cria/atualiza usuário e emite JWT
5. Frontend usa JWT em `Authorization: Bearer ...`

## Autorização de usuários

Usuários são persistidos em `users` no MongoDB.

- Domínio `@lotier.com` pode ser autorizado automaticamente (conforme lógica do backend)
- Demais usuários podem exigir autorização manual (`authorized: true`)

## Troubleshooting objetivo

### "OAuth not configured"
- Verifique `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`
- Reinicie backend após editar `.env`

### "User not authorized"
- Confirme documento em `users` com `authorized: true`

### "Invalid redirect URI"
- URI no Google Console deve ser idêntica ao `.env`

### 401 em endpoint protegido
- Verifique presença de `Authorization: Bearer ...` **ou** `X-API-Key`
- Em write endpoints, sem auth válido o retorno é 401

## Produção

Para produção:

1. Use redirect URI HTTPS do ambiente real
2. Configure CORS para domínios de frontend válidos
3. Rotacione `API_SECRET_KEY`
4. Garanta segredos apenas por variáveis de ambiente

## Teste rápido

```bash
# iniciar fluxo oauth (browser)
open "http://localhost:8000/api/v3/auth/google"

# health público AI
curl http://localhost:8000/api/v3/ai/health
```
