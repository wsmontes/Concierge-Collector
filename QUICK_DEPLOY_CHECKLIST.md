# 🚀 Quick Deploy Checklist - PythonAnywhere

## ✅ O que já está pronto

- ✅ Código detecta ambiente automaticamente
- ✅ `.env` configurado para múltiplos ambientes
- ✅ CORS configurado para localhost + GitHub Pages
- ✅ Frontend detecta PythonAnywhere automaticamente
- ✅ WSGI file criado (`concierge-api-v3/wsgi.py`)
- ✅ Requirements incluem mangum

## 📋 Checklist Rápido

### 1. Google OAuth Console (5 min)
```
https://console.cloud.google.com/apis/credentials
```

Adicione estas URLs:

**Authorized redirect URIs:**
- ✅ `http://localhost:8000/api/v3/auth/callback`
- 🔲 `https://wsmontes.pythonanywhere.com/api/v3/auth/callback` ← ADICIONE

**Authorized JavaScript origins:**
- ✅ `http://localhost:8080`
- 🔲 `https://wsmontes.github.io` ← ADICIONE
- 🔲 `https://wsmontes.pythonanywhere.com` ← ADICIONE

⏰ Aguarde 5-10 minutos após salvar

---

### 2. Upload Código (5 min)

**Opção A - Via Git (Recomendado):**
```bash
# No PythonAnywhere Bash Console
cd ~
git clone https://github.com/wsmontes/Concierge-Collector.git concierge-api
```

**Opção B - Upload Manual:**
1. Zip a pasta `concierge-api-v3`
2. Upload via Files
3. Descomprima em `/home/wsmontes/concierge-api`

---

### 3. Configure .env (2 min)

```bash
cd /home/wsmontes/concierge-api
nano .env
```

Copie e cole (substitua com suas chaves):
```bash
ENVIRONMENT=production
MONGODB_URL=your-mongodb-connection-string
MONGODB_DB_NAME=concierge-collector
API_RELOAD=false
CORS_ORIGINS=http://localhost:8080,https://wsmontes.github.io,https://wsmontes.pythonanywhere.com
GOOGLE_PLACES_API_KEY=your-google-places-api-key
OPENAI_API_KEY=your-openai-api-key
API_SECRET_KEY=your-secret-key-min-32-chars
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret
FRONTEND_URL=http://localhost:8080
FRONTEND_URL_PRODUCTION=https://wsmontes.github.io/Concierge-Collector
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=30
```

Salve: `Ctrl+O`, `Enter`, `Ctrl+X`

---

### 4. Instale Dependências (3 min)

```bash
cd /home/wsmontes/concierge-api
python3.13 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

---

### 5. Configure WSGI (2 min)

**Web tab → WSGI configuration file**

Substitua TODO conteúdo por:

```python
import sys
import os

project_home = '/home/wsmontes/concierge-api'
if project_home not in sys.path:
    sys.path.insert(0, project_home)

os.chdir(project_home)

from dotenv import load_dotenv
load_dotenv(os.path.join(project_home, '.env'))

from app.main import app
from mangum import Mangum

handler = Mangum(app, lifespan="off")

def application(environ, start_response):
    return handler(environ, start_response)
```

---

### 6. Configure Web App (2 min)

**Web tab:**
- Source code: `/home/wsmontes/concierge-api`
- Working directory: `/home/wsmontes/concierge-api`
- Python: `3.13`
- Virtualenv: `/home/wsmontes/concierge-api/venv`
- ✅ Force HTTPS: ON

**Reload** wsmontes.pythonanywhere.com

---

### 7. Teste API (1 min)

```bash
curl https://wsmontes.pythonanywhere.com/api/v3/health
```

Deve retornar: `{"status":"healthy"}`

---

### 8. Deploy GitHub Pages (3 min)

```bash
cd /Users/wagnermontes/Documents/GitHub/Concierge-Collector
git add .
git commit -m "feat: PythonAnywhere deployment support"
git push origin Front-End-V3
```

**GitHub → Settings → Pages:**
- Source: Deploy from branch
- Branch: `Front-End-V3` → `/` (root)
- Save

⏰ Aguarde 2-3 minutos para deploy

---

### 9. Teste Completo (2 min)

**Localhost:**
```
http://localhost:8080
Login with Google ✓
```

**GitHub Pages:**
```
https://wsmontes.github.io/Concierge-Collector
Login with Google ✓
```

---

## 🐛 Troubleshooting Rápido

### API não responde:
```bash
tail -50 /var/log/wsmontes.pythonanywhere.com.error.log
```

### Erro CORS:
Verifique `.env`:
```bash
CORS_ORIGINS=...,https://wsmontes.github.io,...
```

### redirect_uri_mismatch:
1. Google OAuth Console → Verifique URLs
2. Aguarde 5-10 minutos
3. Teste novamente

---

## ⏱️ Tempo Total: ~25 minutos

✅ **Tudo pronto!** Sua app funciona em 3 ambientes com o mesmo código.

---

**Próximo passo:** Siga o guia completo em `PYTHONANYWHERE_DEPLOYMENT.md` para detalhes.
