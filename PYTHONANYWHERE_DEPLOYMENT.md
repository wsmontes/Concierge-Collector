# 🚀 Deploy para PythonAnywhere - Guia Completo

## ✅ O Código Já Está Preparado!

O código detecta **automaticamente** se está rodando em:
- 🏠 Localhost (`localhost:8000`)
- 🌐 PythonAnywhere (`wsmontes.pythonanywhere.com`)
- 📄 GitHub Pages (`wsmontes.github.io`)

**Não precisa alterar código!** Apenas configure o Google OAuth Console.

---

## 📋 Pré-requisitos

1. ✅ Conta PythonAnywhere (já tem)
2. ✅ Código preparado (já está)
3. ⚠️ Google OAuth Console (precisa adicionar URLs)

---

## 🔧 Passo 1: Configure o Google OAuth Console

### 1.1. Acesse o Google Cloud Console

https://console.cloud.google.com/apis/credentials

### 1.2. Adicione URLs Autorizadas

**Authorized JavaScript origins:**
```
http://localhost:8080
https://wsmontes.github.io
https://wsmontes.pythonanywhere.com
```

**Authorized redirect URIs:**
```
http://localhost:8000/api/v3/auth/callback
https://wsmontes.pythonanywhere.com/api/v3/auth/callback
```

### 1.3. Salve as Alterações

⚠️ **IMPORTANTE:** Aguarde 5-10 minutos para o Google propagar as mudanças.

---

## 📦 Passo 2: Upload do Código

### 2.1. Via Git (Recomendado)

```bash
# No PythonAnywhere Bash Console
cd ~
git clone https://github.com/wsmontes/Concierge-Collector.git concierge-api
cd concierge-api/concierge-api-v3
```

### 2.2. Via Upload Manual

1. Comprima a pasta `concierge-api-v3`
2. Upload via Files → Upload
3. Descomprima no diretório `/home/wsmontes/concierge-api`

---

## 🔐 Passo 3: Configure as Variáveis de Ambiente

### 3.1. Copie o .env

```bash
cd /home/wsmontes/concierge-api
cp .env.example .env
nano .env
```

### 3.2. .env Completo

Use **EXATAMENTE** este conteúdo (substitua com suas próprias chaves):

```bash
# Environment
ENVIRONMENT=production

# MongoDB Configuration
MONGODB_URL=your-mongodb-connection-string
MONGODB_DB_NAME=concierge-collector

# API Configuration
API_V3_URL=https://wsmontes.pythonanywhere.com
API_HOST=0.0.0.0
API_PORT=8000
API_RELOAD=false

# CORS Configuration (inclui todos os ambientes)
CORS_ORIGINS=http://localhost:8080,https://wsmontes.github.io,https://wsmontes.pythonanywhere.com

# Google Places API
GOOGLE_PLACES_API_KEY=your-google-places-api-key

# OpenAI API
OPENAI_API_KEY=your-openai-api-key

# API Security
API_SECRET_KEY=your-secret-key-min-32-chars

# Google OAuth Configuration
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret

# Frontend URLs (auto-detectado pelo backend)
FRONTEND_URL=http://localhost:8080
FRONTEND_URL_PRODUCTION=https://wsmontes.github.io/Concierge-Collector

# JWT Token Settings
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=30
```

**SALVE:** Ctrl+O, Enter, Ctrl+X

---

## 🐍 Passo 4: Configure o Ambiente Virtual

```bash
cd /home/wsmontes/concierge-api
python3.13 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

---

## ⚙️ Passo 5: Configure o WSGI

### 5.1. Edite o WSGI File

No PythonAnywhere Web tab, clique em **WSGI configuration file**

### 5.2. Substitua TODO o conteúdo por:

```python
"""
WSGI configuration for Concierge Collector API V3
FastAPI + ASGI running on WSGI via Mangum adapter
"""

import sys
import os

# Add project directory to Python path
project_home = '/home/wsmontes/concierge-api'
if project_home not in sys.path:
    sys.path.insert(0, project_home)

# Load environment variables from .env
from dotenv import load_dotenv
env_path = os.path.join(project_home, '.env')
load_dotenv(env_path)

# Import FastAPI app
from concierge_api_v3.main import app

# Mangum adapter for ASGI → WSGI
from mangum import Mangum
handler = Mangum(app, lifespan="off")

# WSGI application
def application(environ, start_response):
    return handler(environ, start_response)
```

**SALVE** o arquivo.

---

## 🔄 Passo 6: Configure o Web App

### 6.1. Web Tab Settings

- **Source code:** `/home/wsmontes/concierge-api`
- **Working directory:** `/home/wsmontes/concierge-api`
- **Python version:** `3.13`
- **Virtualenv:** `/home/wsmontes/concierge-api/venv`

### 6.2. Force HTTPS

✅ Ative **Force HTTPS**

### 6.3. Reload

Click **Reload wsmontes.pythonanywhere.com**

---

## 🧪 Passo 7: Teste a API

### 7.1. Teste Health Check

```bash
curl https://wsmontes.pythonanywhere.com/api/v3/health
```

**Deve retornar:**
```json
{"status": "healthy", "version": "3.0"}
```

### 7.2. Teste Info

```bash
curl https://wsmontes.pythonanywhere.com/api/v3/info
```

### 7.3. Verifique Logs

**Error Log:** `/var/log/wsmontes.pythonanywhere.com.error.log`

```bash
tail -50 /var/log/wsmontes.pythonanywhere.com.error.log
```

---

## 🌐 Passo 8: Deploy Frontend no GitHub Pages

### 8.1. Commit e Push

```bash
cd /Users/wagnermontes/Documents/GitHub/Concierge-Collector
git add .
git commit -m "feat: OAuth multi-environment support (localhost + PythonAnywhere + GitHub Pages)"
git push origin Front-End-V3
```

### 8.2. Configure GitHub Pages

1. GitHub → Settings → Pages
2. Source: **Deploy from branch**
3. Branch: `Front-End-V3` → `/` (root)
4. Save

### 8.3. Aguarde Deploy

GitHub demora 1-3 minutos para publicar.

URL: https://wsmontes.github.io/Concierge-Collector

---

## ✅ Passo 9: Teste End-to-End

### 9.1. Teste Localhost

1. Abra: http://localhost:8080
2. Console deve mostrar:
   ```
   Environment: {isDev: true, isProduction: false}
   API: http://localhost:8000/api/v3
   ```
3. Click "Login with Google"
4. ✅ Deve fazer login

### 9.2. Teste GitHub Pages

1. Abra: https://wsmontes.github.io/Concierge-Collector
2. Console deve mostrar:
   ```
   Environment: {isDev: false, isProduction: true}
   API: https://wsmontes.pythonanywhere.com/api/v3
   ```
3. Click "Login with Google"
4. ✅ Deve fazer login

---

## 🐛 Troubleshooting

### Erro: "redirect_uri_mismatch"

**Causa:** Google OAuth não reconhece a URL

**Solução:**
1. Verifique Google OAuth Console
2. Certifique-se que adicionou:
   - `https://wsmontes.pythonanywhere.com/api/v3/auth/callback`
3. Aguarde 5-10 minutos

### Erro: CORS

**Causa:** Frontend não autorizado

**Solução:**
```bash
# .env no PythonAnywhere
CORS_ORIGINS=https://wsmontes.github.io,http://localhost:8080
```

### API não responde

**Verifique logs:**
```bash
tail -100 /var/log/wsmontes.pythonanywhere.com.error.log
```

**Verifique se virtualenv está ativo:**
```bash
which python
# Deve retornar: /home/wsmontes/concierge-api/venv/bin/python
```

### Erro: ModuleNotFoundError

```bash
source venv/bin/activate
pip install -r requirements.txt
```

---

## 📊 Arquitetura Final

```
┌─────────────────────────────────────────────┐
│           🏠 Localhost Development          │
│                                             │
│  Frontend: http://localhost:8080           │
│  Backend:  http://localhost:8000/api/v3    │
│  Database: MongoDB Atlas (cloud)            │
│  OAuth:    localhost callback               │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│           🌐 Production (GitHub Pages)      │
│                                             │
│  Frontend: wsmontes.github.io              │
│  Backend:  wsmontes.pythonanywhere.com     │
│  Database: MongoDB Atlas (cloud)            │
│  OAuth:    PythonAnywhere callback          │
└─────────────────────────────────────────────┘
```

---

## 🎯 Checklist Final

### Backend (PythonAnywhere)
- [ ] Código no `/home/wsmontes/concierge-api`
- [ ] `.env` configurado
- [ ] Virtualenv criado e requirements instalados
- [ ] WSGI file configurado
- [ ] Web app reloaded
- [ ] Health check funcionando

### Frontend (GitHub Pages)
- [ ] Código commitado e pushed
- [ ] GitHub Pages configurado
- [ ] Site acessível

### Google OAuth
- [ ] Localhost callback adicionado
- [ ] PythonAnywhere callback adicionado
- [ ] GitHub Pages origin adicionado
- [ ] Aguardou 5-10 minutos

### Testes
- [ ] Login funciona em localhost
- [ ] Login funciona no GitHub Pages
- [ ] Tokens persistem após reload
- [ ] Refresh token funciona

---

## 🚀 Pronto!

Sua aplicação agora funciona em **3 ambientes** com o **mesmo código**:

1. 🏠 **Localhost** - Desenvolvimento
2. 🌐 **GitHub Pages** - Frontend de produção
3. ☁️ **PythonAnywhere** - Backend de produção

**Tudo detectado automaticamente!** 🎉

---

## 📞 Suporte

- **PythonAnywhere Help:** https://help.pythonanywhere.com
- **Google OAuth Docs:** https://developers.google.com/identity/protocols/oauth2
- **FastAPI Docs:** https://fastapi.tiangolo.com

---

**Última atualização:** 19 de Novembro de 2025
