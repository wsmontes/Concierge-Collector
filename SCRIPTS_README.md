# 🚀 Scripts de Gerenciamento

Scripts para iniciar, parar e gerenciar a aplicação Concierge Collector (frontend + backend).

## 📋 Scripts Disponíveis

### `./start.sh` - Iniciar Aplicação

Inicia ambos os serviços (frontend e backend) em modo desenvolvimento.

```bash
./start.sh
```

**O que faz:**
- ✅ Cria ambiente virtual Python (se não existir)
- ✅ Instala dependências Python (primeira vez)
- ✅ Inicia FastAPI em http://localhost:8000 (background)
- ✅ Instala dependências npm (primeira vez)
- ✅ Inicia SvelteKit em http://localhost:5174 (background)
- ✅ Salva PIDs dos processos em `pids/`
- ✅ Salva logs em `logs/`

**Saída esperada:**
```
🚀 Starting Concierge Collector...

📦 Starting Backend (FastAPI)...
✓ Backend started (PID: 12345)

🎨 Starting Frontend (SvelteKit)...
✓ Frontend started (PID: 12346)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ All services started successfully!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📱 Frontend:  http://localhost:5174
🔌 Backend:   http://localhost:8000
📚 API Docs:  http://localhost:8000/docs
```

---

### `./stop.sh` - Parar Aplicação

Para todos os serviços em execução.

```bash
./stop.sh
```

**O que faz:**
- ✅ Para o processo do backend (FastAPI)
- ✅ Para o processo do frontend (SvelteKit)
- ✅ Limpa processos nas portas 8000 e 5173
- ✅ Remove arquivos PID

**Saída esperada:**
```
🛑 Stopping Concierge Collector...

Stopping Backend (PID: 12345)...
✓ Backend stopped

Stopping Frontend (PID: 12346)...
✓ Frontend stopped

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ All services stopped
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### `./restart.sh` - Reiniciar Aplicação

Para e reinicia ambos os serviços.

```bash
./restart.sh
```

**Equivalente a:**
```bash
./stop.sh && sleep 2 && ./start.sh
```

---

### `./status.sh` - Verificar Status

Verifica se os serviços estão rodando.

```bash
./status.sh
```

**Saída esperada:**
```
📊 Concierge Collector Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Backend (FastAPI): ✓ Running (PID: 12345)
  └─ Port 8000: LISTENING

Frontend (SvelteKit): ✓ Running (PID: 12346)
  └─ Port 5174: LISTENING

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📱 URLs:
   Frontend:  http://localhost:5174
   Backend:   http://localhost:8000
   API Docs:  http://localhost:8000/docs
```

---

## 📁 Estrutura de Arquivos

```
Concierge-Collector/
├── start.sh              # Iniciar serviços
├── stop.sh               # Parar serviços
├── restart.sh            # Reiniciar serviços
├── status.sh             # Verificar status
├── pids/                 # PIDs dos processos (gerado)
│   ├── backend.pid
│   └── frontend.pid
├── logs/                 # Logs dos serviços (gerado)
│   ├── backend.log
│   └── frontend.log
├── concierge-api-v3/     # Backend FastAPI
└── concierge-v3/         # Frontend SvelteKit
```

---

## 🔍 Visualizar Logs

### Logs em Tempo Real

**Backend:**
```bash
tail -f logs/backend.log
```

**Frontend:**
```bash
tail -f logs/frontend.log
```

### Últimas 50 Linhas

**Backend:**
```bash
tail -n 50 logs/backend.log
```

**Frontend:**
```bash
tail -n 50 logs/frontend.log
```

---

## 🛠️ Solução de Problemas

### Porta já está em uso

Se você receber erro de porta ocupada:

```bash
# Verificar processo na porta 8000 (backend)
lsof -ti:8000

# Matar processo na porta 8000
kill -9 $(lsof -ti:8000)

# Verificar processo na porta 5174 (frontend)
lsof -ti:5174

# Matar processo na porta 5174
kill -9 $(lsof -ti:5174)
```

Ou simplesmente:
```bash
./stop.sh  # Já faz essa limpeza automaticamente
```

### Serviços não iniciam

1. **Backend não inicia:**
   ```bash
   cd concierge-api-v3
   source venv/bin/activate
   pip install -r requirements.txt
   uvicorn app.main:app --reload --port 8000
   ```

2. **Frontend não inicia:**
   ```bash
   cd concierge-v3
   npm install
   npm run dev
   ```

### Logs não aparecem

Verifique se os diretórios existem:
```bash
mkdir -p logs pids
```

---

## ⚙️ Requisitos

- **Python 3.10+** (para backend)
- **Node.js 18+** (para frontend)
- **npm** ou **pnpm** (gerenciador de pacotes)
- **bash** (shell - macOS/Linux)

---

## 🎯 Fluxo de Trabalho Típico

```bash
# Manhã - iniciar trabalho
./start.sh

# Desenvolver...

# Verificar se tudo está rodando
./status.sh

# Ver logs
tail -f logs/frontend.log

# Reiniciar após mudanças
./restart.sh

# Fim do dia - parar tudo
./stop.sh
```

---

## 📝 Notas

- Os scripts salvam PIDs em `pids/` para controle dos processos
- Logs são salvos em `logs/` (útil para debugging)
- Dependências são instaladas automaticamente na primeira vez
- Arquivo `.deps_installed` marca quando deps Python foram instaladas
- Use `./restart.sh` após mudanças em configuração

---

## 🚨 Importante

**Não commitar:**
- `pids/` - PIDs são temporários
- `logs/` - Logs locais
- `.deps_installed` - Marcador local

Esses arquivos já estão no `.gitignore`.
