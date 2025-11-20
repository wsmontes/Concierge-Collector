# Google OAuth Configuration Checklist

## ✅ Checklist de Configuração

### 1. Google Cloud Console

#### Credenciais OAuth 2.0
- [ ] Tipo de aplicativo: **"Aplicativo da Web"**
- [ ] **URIs de redirecionamento autorizados** configurados:
  ```
  http://localhost:8000/api/v3/auth/callback
  ```
  ⚠️ **IMPORTANTE**: Tem que ser **EXATAMENTE** igual, incluindo:
  - `http` (não `https`)
  - `localhost` (não `127.0.0.1`)
  - porta `8000`
  - caminho `/api/v3/auth/callback`

#### Tela de Consentimento OAuth
- [ ] Status: **Testing** ou **Production**
- [ ] E-mail de suporte configurado
- [ ] Escopos configurados: `openid`, `email`, `profile`
- [ ] Se em modo **Testing**: Seus usuários de teste adicionados na lista

### 2. Arquivo .env

Verifique se seu arquivo `.env` tem:

```bash
# Google OAuth - OBRIGATÓRIO
GOOGLE_OAUTH_CLIENT_ID=seu-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=seu-client-secret
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8000/api/v3/auth/callback

# Frontend URL - Para onde redirecionar após login
FRONTEND_URL=http://127.0.0.1:5500

# JWT Token Settings
ACCESS_TOKEN_EXPIRE_MINUTES=60
```

**Verificar agora**:
```bash
cd concierge-api-v3
grep "GOOGLE_OAUTH" .env
```

### 3. Autorizar Usuário no MongoDB

Novos usuários são criados como `authorized: false` por segurança.

**Depois do primeiro login**, autorize seu usuário:
```bash
source concierge-api-v3/venv/bin/activate
python concierge-api-v3/scripts/authorize_user.py SEU_EMAIL@GMAIL.COM
```

---

## 🔍 Debugging: O que olhar

### Logs do Backend

Com as mudanças aplicadas, você verá logs como:

```
[OAuth] Initiating flow with redirect_uri: http://localhost:8000/api/v3/auth/callback
[OAuth] State generated: abc123...
[OAuth] Callback received - code: present, state: abc123..., error: None
[OAuth] Exchanging code for tokens...
[OAuth] Using redirect_uri: http://localhost:8000/api/v3/auth/callback
[OAuth] Tokens received successfully
[OAuth] User info retrieved: seu-email@gmail.com
[OAuth] User created/updated: seu-email@gmail.com, authorized=True
[OAuth] JWT token created for user seu-email@gmail.com
[OAuth] Redirecting to: http://127.0.0.1:5500/ (with tokens)
```

### Logs do Frontend (Console do Browser)

```
[AuthService] Initializing...
[AuthService] Found tokens in URL, storing...
[AuthService] URL cleaned
[AuthService] Valid session restored: seu-email@gmail.com
✅ Access granted - user authenticated: seu-email@gmail.com
```

### Debug Info na Tela de Login

Se voltar para a tela de login, veja:
- **Origin**: deve ser `http://127.0.0.1:5500`
- **Has Token**: se for "Yes" e ainda assim não funciona = problema de autorização
- **Last Error**: mensagem do erro

---

## 🚨 Erros Comuns e Soluções

### 1. `redirect_uri_mismatch`

**Erro no Google**:
```
Error 400: redirect_uri_mismatch
```

**Causa**: URL do código não bate com URL no Google Console.

**Solução**:
1. Veja o terminal do backend, procure por:
   ```
   [OAuth] Using redirect_uri: http://...
   ```
2. Copie essa URL **exata**
3. Cole no Google Console em "URIs de redirecionamento autorizados"
4. Salve e tente novamente

### 2. `invalid_client`

**Erro na troca de tokens**:
```
[OAuth] Token exchange failed: {'error': 'invalid_client'}
```

**Causas possíveis**:
- Client ID errado no `.env`
- Client Secret errado no `.env`
- Credenciais de um projeto diferente no Google Console

**Solução**:
1. Abra Google Cloud Console
2. Vá em "Credenciais"
3. Clique no seu OAuth 2.0 Client ID
4. Copie **Client ID** e **Client Secret**
5. Cole no `.env` (substitua os valores atuais)
6. Reinicie o backend

### 3. `access_denied`

**Usuário volta com erro**:
```
http://127.0.0.1:5500/?error=access_denied
```

**Causas possíveis**:
- Usuário clicou "Cancelar" no Google
- App está em modo Testing e usuário não está na lista de teste
- Escopos muito amplos/suspeitos

**Solução**:
- Se o app está em Testing: adicione o email do usuário na lista de "Test users"
- Se o usuário cancelou: tente novamente

### 4. "Authentication failed" mas tem token

**No Debug Info**:
```
Has Token: Yes
Last Error: User not authorized
```

**Causa**: Usuário existe no banco mas `authorized: false`

**Solução**:
```bash
source concierge-api-v3/venv/bin/activate
python concierge-api-v3/scripts/authorize_user.py SEU_EMAIL@GMAIL.COM
```

---

## 🔄 Próximos Passos

### 1. Teste Básico

```bash
# Terminal 1: Backend
./start-api.sh

# Terminal 2: Verifica se está rodando
curl http://localhost:8000/api/v3/health

# Browser: Frontend
# Abra http://127.0.0.1:5500
# Clique em "Sign in with Google"
```

### 2. Se der erro

1. **Backend**: Veja os logs no terminal (agora tem muito mais informação)
2. **Frontend**: Abra DevTools → Console → veja os logs
3. **Tela de Login**: Se voltar para login, veja "Debug Info"
4. **Me envie**:
   - Logs do backend (a parte do `[OAuth]`)
   - Logs do frontend (console)
   - Screenshot da tela de login (mostrando Debug Info)

### 3. Se funcionar

Após login bem-sucedido, verifique:
- [ ] App carregou normalmente
- [ ] Token está no localStorage (DevTools → Application → Local Storage → `oauth_access_token`)
- [ ] Requisições para API estão funcionando

---

## 📝 Comandos Úteis

```bash
# Ver configuração do OAuth no .env
grep "GOOGLE_OAUTH\|FRONTEND_URL" concierge-api-v3/.env

# Reiniciar backend
./stop-api.sh && ./start-api.sh

# Ver usuários no MongoDB
mongosh "mongodb+srv://..." --eval "use concierge-collector; db.users.find().pretty()"

# Autorizar usuário
source concierge-api-v3/venv/bin/activate
python concierge-api-v3/scripts/authorize_user.py email@example.com

# Limpar tokens do localStorage (no browser console)
localStorage.clear()
```

---

## ✨ Melhorias Aplicadas

1. **Logging detalhado**: Cada etapa do OAuth agora imprime logs claros
2. **Tratamento de erros**: Erros do Google são capturados e explicados
3. **Debug visual**: Tela de login mostra estado do token e erros
4. **Validação de state**: CSRF protection implementado corretamente
5. **Configuração centralizada**: Todas as URLs e timeouts no config
6. **Script de autorização**: Facilita autorizar novos usuários
