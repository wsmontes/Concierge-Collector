# 🤖 Git Automation Scripts

Scripts automatizados para facilitar operações Git no workspace.

## 📦 Scripts Disponíveis

### 1. `git-auto.sh` - Automação Completa
Adiciona, commita e faz push de todas as mudanças.

**Uso:**
```bash
# Com mensagem customizada
./git-auto.sh "feat: add new feature"

# Sem mensagem (será solicitada)
./git-auto.sh

# Mensagem será auto-gerada se não informada
./git-auto.sh
```

**O que faz:**
- ✅ Verifica se está em um repositório Git
- ✅ Mostra branch atual
- ✅ Lista mudanças detectadas
- ✅ Adiciona todas as mudanças (`git add -A`)
- ✅ Commita com a mensagem fornecida
- ✅ Faz push para a branch atual
- ✅ Mostra resumo do último commit

**Output:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Git Automation Script
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 Current branch: Front-End-V3

📋 Changes detected:
 M concierge-api-v3/tests/test_entities.py
 A concierge-api-v3/TESTING_SUMMARY.md

📝 Commit message: test: add automated test suite

➕ Adding changes...
💾 Committing...
🚀 Pushing to Front-End-V3...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Successfully pushed to Front-End-V3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Last commit:
abc1234 (HEAD -> Front-End-V3) test: add automated test suite
```

---

### 2. `git-quick.sh` - Commit Rápido
Commit e push automático com mensagem gerada baseada nos arquivos alterados.

**Uso:**
```bash
./git-quick.sh
```

**O que faz:**
- ✅ Detecta tipo de mudança automaticamente:
  - `test:` se mudou arquivos de teste
  - `docs:` se mudou arquivos `.md`
  - `feat:` se mudou arquivos `.py`
  - `ui:` se mudou `.js`, `.html`, `.css`
  - `chore:` para outras mudanças
- ✅ Gera mensagem automática
- ✅ Adiciona, commita e faz push

**Output:**
```
📝 test: update 8 files
✓ Done!
```

---

### 3. `git-status.sh` - Status Melhorado
Visualização aprimorada do status do repositório.

**Uso:**
```bash
./git-status.sh
```

**O que mostra:**
- ✅ Branch atual
- ✅ URL do remote
- ✅ Último commit
- ✅ Status das mudanças
- ✅ Sugestões de comandos

**Output:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Git Repository Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 Branch: Front-End-V3
🌐 Remote: https://github.com/wsmontes/Concierge-Collector.git

📊 Last commit:
abc1234 (HEAD -> Front-End-V3) test: add automated test suite

📋 Status:
## Front-End-V3...origin/Front-End-V3
 M concierge-api-v3/app/api/entities.py
 A git-auto.sh

⚠️  You have uncommitted changes
Run: ./git-auto.sh "your commit message"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 🚀 Workflow Recomendado

### Desenvolvimento Normal
```bash
# 1. Verifique o status
./git-status.sh

# 2. Faça suas mudanças no código

# 3. Commit e push com mensagem específica
./git-auto.sh "feat: implement user authentication"
```

### Commit Rápido
```bash
# Para mudanças pequenas, use o quick
./git-quick.sh
```

### Verificar Status Frequentemente
```bash
# Adicione alias no seu .zshrc
alias gs='./git-status.sh'
alias ga='./git-auto.sh'
alias gq='./git-quick.sh'
```

---

## 📝 Convenções de Commit

Use prefixos semânticos nas mensagens:

- `feat:` - Nova funcionalidade
- `fix:` - Correção de bug
- `test:` - Adicionar ou modificar testes
- `docs:` - Mudanças na documentação
- `refactor:` - Refatoração de código
- `style:` - Formatação, espaços em branco
- `chore:` - Tarefas de manutenção
- `perf:` - Melhorias de performance

**Exemplos:**
```bash
./git-auto.sh "feat: add JWT authentication"
./git-auto.sh "fix: resolve MongoDB connection timeout"
./git-auto.sh "test: add 61 automated tests with 100% pass rate"
./git-auto.sh "docs: update API documentation"
```

---

## 🔧 Troubleshooting

### Script não executa
```bash
# Dar permissão de execução
chmod +x git-*.sh
```

### Push falha
```bash
# Verificar remote
git remote -v

# Configurar upstream
git push -u origin Front-End-V3
```

### Conflitos de merge
```bash
# Scripts não resolvem conflitos automaticamente
# Resolva manualmente e depois use o script
git pull origin Front-End-V3
# Resolver conflitos
./git-auto.sh "merge: resolve conflicts"
```

---

## 🎯 Benefícios

- ⚡ **Velocidade**: 3 comandos em 1
- 🛡️ **Segurança**: Verifica estado antes de executar
- 📊 **Visibilidade**: Output colorido e informativo
- 🤖 **Automação**: Menos comandos manuais
- ✅ **Confiável**: Detecta e reporta erros

---

## 📍 Localização

Scripts estão na raiz do projeto:
```
Concierge-Collector/
├── git-auto.sh       # Automação completa
├── git-quick.sh      # Commit rápido
├── git-status.sh     # Status melhorado
└── GIT_AUTOMATION.md # Esta documentação
```

---

**Última atualização:** 21 de novembro de 2025  
**Branch:** Front-End-V3
