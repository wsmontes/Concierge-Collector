# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é este projeto

Ferramenta de **curadoria de restaurantes para concierges de hotéis**. O concierge captura recomendações por voz/foto/texto (inclusive offline, em campo); IA (Whisper + GPT-4 Vision) transcreve e extrai conceitos estruturados (cuisine, food_style, setting, price_range). O resultado vira **entidades** (restaurantes) e **curadorias** (avaliações por categoria/conceito) no MongoDB, com busca semântica por embeddings. Há também um pipeline de **coleta em massa** (OSM, Overture Maps, Michelin) que gera curadorias `draft` para revisão humana.

## Arquitetura (visão geral)

Repositório único, sem workspaces. Três partes principais + suporte:

- **Raiz = frontend vanilla** (sem framework, sem bundler): `index.html` + `scripts/`. Tailwind via CDN, Dexie.js/IndexedDB para offline-first, sync bidirecional otimista com o servidor (header `If-Match`, UI de conflitos, sync a cada 60s). Detecção de ambiente por hostname em `scripts/core/config.js`.
- **`capture/` = app de captura offline** (fila client-side FIFO com retries e heartbeat; upload quando volta a conexão).
- **`concierge-api-v3/` = API FastAPI** (Python 3.12, Uvicorn, Pydantic v2): 13 routers em `app/api/`, lógica em `app/services/` (`ai_orchestrator.py`, `llm_place_service.py`, `openai_service.py`), config/DB/segurança em `app/core/`. O backend também serve estáticos: `/` redireciona para `/capture/`, e monta `/capture` e `/app` (legado).
- **`scripts/python-tools/` = pipeline de dados** que roda **localmente** (não no Render): extrai de OSM/Overture/Michelin → merge (`merge_restaurant_datasets.py`) → filtro "rich" (`filter_rich_entities.py`) → import em bulk via API (`import_entities.py`) → curadorias draft via web search + DeepSeek (`research_curations.py`).
- **`docs/README.md`** é o índice mestre de documentação. Regra do repo: **código prevalece sobre docs** (docs podem estar desatualizados).

Banco: **MongoDB Atlas** (externo; coleções `entities`, `curations`, `embeddings`, `embedding_links`, `ai_concepts`, `curators`, `users`, etc.). **Não há fila server-side** (sem Redis/Celery) — offline-first é todo client-side. IA: OpenAI (Whisper, GPT-4, Vision, text-embedding-3-small), Google Places, OAuth Google. DeepSeek é usado só pelo script local de curadorias draft.

## Convenções de código (obrigatórias — de `.github/copilot-instructions.md`)

Estas regras se aplicam ao frontend (`scripts/`, `capture/`):

- **Padrão ModuleWrapper** para criar/estender módulos. **Proibido** ES6 imports/exports ou `require()` — scripts entram via tags `<script>`, e a ordem de carregamento não deve ser alterada.
- Configuração, chaves e constantes **somente** em `scripts/core/config.js`. Proibidos globais — todo estado/método pertence a classe ou namespace, com `this.` para dados e funções.
- Inicialização centralizada em `scripts/core/main.js` (entry point): módulos se registram, mas não auto-inicializam.
- Todo arquivo começa com header comentando propósito, responsabilidades e dependências. Código e comentários devem ser compreensíveis por IA/dev sem contexto do projeto; não assumir nada.
- Nada de mock/fake/sample data. Não criar arquivos novos de diagnóstico — analisar e corrigir o código existente. Nunca quebrar código que funciona; preferir refatorar.
- Em caso de ambiguidade, perguntar ao usuário antes de decidir. Não criar documentação sem pedido explícito.
- ⚠️ Exceção documentada: `capture/` usa ES modules (`import`/`export`, `<script type="module">`, app.js auto-inicializável) — estrutura load-bearing para os testes vitest; NÃO converter para ModuleWrapper/script-tags sem converter os testes junto (ver `.github/copilot-instructions.md`).

## Hospedagem e deploy (Render)

Produção tem **2 serviços no Render**, configurados **manualmente no dashboard** — não há `render.yaml`/Dockerfile/Procfile (infra não é versionada; a referência é `docs/DEPLOYMENT.md`):

| Serviço | Detalhe |
|---|---|
| **API** — web service "Concierge-Collector" (`srv-d4fngpjuibrs73bo70vg`) | root `concierge-api-v3`, build `pip install -r requirements.txt`, start `uvicorn main:app --host 0.0.0.0 --port $PORT`, URL `https://concierge-collector.onrender.com` (API em `/api/v3`), health check `GET /api/v3/health` (ping no Mongo) |
| **Web** — static site "Concierge-Collector-Web" (`srv-d4fnrlje5dus7397lii0`) | root `/`, sem build, publish `.`, URL `https://concierge-collector-web.onrender.com` |

- ⚠️ **Ambos os serviços auto-deployam da branch `main`** (verificado contra a API do Render em 2026-08-14). O auto-deploy **existe mas não é confiável** — após push em `main`, verificar o deploy de cada serviço e disparar manualmente se necessário (via dashboard ou `scripts/python-tools/render_deployment_manager.py`). Deploy leva ~2-3 min.
- Sem preDeployCommand/migrações/seeds. Única migração: índice TTL de `capture_sessions` (48h) criado no startup (`concierge-api-v3/app/core/lifespan.py`).
- Env vars vivem no dashboard do Render (só nomes): `MONGODB_URL`, `MONGODB_DB_NAME`, `API_SECRET_KEY`, `OPENAI_API_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `CORS_ORIGINS` (**precisa incluir o domínio do static site**), `ENVIRONMENT`, `LOG_LEVEL`, `TRUSTED_CALLBACK_ORIGINS`. Render injeta `PORT` e `RENDER_SERVICE_NAME` (usadas para detecção de prod em `app/core/config.py`). `MONGODB_CURATIONS_VECTOR_INDEX` (lido em `app/api/curations.py`) deve normalmente ficar **unset** — quando setado, tenta `$vectorSearch`; sem ele, roda a varredura fallback, que é o caminho que realmente executa (o índice vector consome cota do Atlas).
- Gotcha: `runtime.txt` (Python 3.13.4) fica na **raiz**, mas o root do web service é `concierge-api-v3` — a versão efetiva do Python pode vir do dashboard.
- GitHub Actions roda **apenas testes** (não faz deploy): backend unit tests + flake8/black; frontend vitest.
- Legado: GitHub Pages (`wsmontes.github.io/Concierge-Collector`) + PythonAnywhere ainda aparecem como fallback em `config.js`/`config.py`.

## Acesso a serviços externos (verificado 2026-08-12)

- ⚠️ **Gotcha crítico local:** o perfil do shell (zsh) exporta `OPENAI_BASE_URL=http://localhost:1234/v1` (LM Studio), `OPENAI_API_KEY=lm-studio` e `OPENAI_MODEL` — qualquer script Python que herde o ambiente e use o SDK da OpenAI passa a falar com o LM Studio local e falha com `"No models loaded ... 'lms load'"`. Para usar a API real da OpenAI: `env -u OPENAI_BASE_URL -u OPENAI_API_KEY -u OPENAI_MODEL python ...`, ou passe `base_url='https://api.openai.com/v1'` e leia a chave direto do `.env` (a chave local `sk-proj-...` é válida). O `scripts/python-tools/backfill_embeddings.py` já trata isso.
- Credenciais locais em **`concierge-api-v3/.env`** (git-ignored; valores de produção ficam no dashboard do Render). **Nunca** commitar valores secretos — usar apenas nomes de variáveis.
- `RENDER_API_KEY` do `.env` **funciona**: workspace "My Workspace", ownerId **`tea-d09cc5je5dus73bbc5m0`** (o ownerId de `render_deployment.log` está desatualizado — o log lista 7 serviços do workspace, incluindo projetos alheios).
- `MONGODB_URL` do `.env` **conecta direto do IP local** ao Atlas (cluster `concierge-collector.7bwiisy.mongodb.net`, banco `concierge-collector`). Contagens de referência (ago/2026): entities ~21,6k, curations ~1.078, embeddings ~1.198, embedding_links ~7.942.
- **Cota de storage do Atlas**: incidente de 2026-08-12 (512MB estourados, escritas bloqueadas) RESOLVIDO via backup BSON + wipe + restore com embeddings compactados (Binary float32, ~6KB/vetor — `app/core/vector_packing.py`); índice vector `curations_embeddings_vector` removido pelo usuário na UI do Atlas (não funciona com o formato Binary de qualquer forma — o fallback scan é o que roda). Manter `MONGODB_CURATIONS_VECTOR_INDEX` **unset** no dashboard; novos embeddings devem SEMPRE ser gravados float32 (backfill já faz). Backup em `data/backups/full-dump-2026-08-12/` (gitignored).
- Gotcha de shell: `set -a; . .env` **não exporta** as variáveis neste ambiente — carregar linha a linha com `export "$key=$val"` (ver memória `render-mongo-access`).
- Gerenciamento do Render via script: `scripts/python-tools/render_deployment_manager.py` (usa `RENDER_API_KEY`).

## Comandos úteis

**Frontend** (raiz do repo, Node ≥18):
- `npm test` (vitest run), `npm run test:watch`, `npm run test:coverage` (thresholds 70/60/70/70)
- Teste único: `npx vitest run tests/<arquivo>.test.js -t "nome do teste"`
- Ambiente jsdom + fake-indexeddb + globals; setup em `tests/conftest.js`

**Backend** (`concierge-api-v3/`, venv em `venv/`):
- Subir local: `./run_local.sh` (cria venv, instala deps, sobe uvicorn em background; logs em `uvicorn.log`) ou `venv/bin/python -m uvicorn main:app --reload` — API em `http://localhost:8000/api/v3`, docs em `/api/v3/docs`
- Testes: `venv/bin/pytest` — unit apenas: `venv/bin/pytest -m "not integration and not external_api and not mongo and not openai"` (comando exato do CI); teste único: `venv/bin/pytest tests/test_x.py::test_y`
- Marcadores pytest: `integration`, `external_api`, `mongo`, `openai`, `slow` (`pytest.ini` usa `--timeout=60`; `pytest-timeout` já está no venv)
- Lint: `flake8` + `black` (como no CI; `pyproject.toml` define line-length 120 para o black, igual ao flake8)

**Auth local (dev):** `/auth/dev-login` gera JWT válido; o frontend auto-loga em localhost. Frontend local: servir a raiz em `127.0.0.1` (ex.: Live Server porta 5500) — o `config.js` detecta o ambiente pelo hostname e aponta para a API local.

**Saúde de produção:** `curl https://concierge-collector.onrender.com/api/v3/health` → esperado `{"status":"healthy","database":"connected"}`.

**Smoke test de produção (read-only):** `concierge-api-v3/venv/bin/python scripts/python-tools/prod_smoke.py` — varre todas as rotas GET via OpenAPI com ids reais do Mongo e retry. Baseline 2026-08-14: 18 rotas OK, 6 4xx esperados (auth/validação), 0 erros 5xx, 3 skip. ⚠️ Gotcha: os paths do `openapi.json` **já incluem** o prefixo `/api/v3` — nunca prefixar de novo ao montar URLs (causa 404 total e falso diagnóstico de incidente).

**CI:** REMOVIDO em 2026-08-14 (a pedido do usuário) — workflows de GitHub Actions deletados e Actions desabilitadas no repo (conta travada por billing do usuário; todo run falhava em 3s). Testes rodam LOCALMENTE e são a barra de qualidade: frontend `npm test` (533 passed/10 skipped, thresholds 70/60/70/70 no `test:coverage`), backend `venv/bin/pytest -m "not integration and not external_api and not mongo and not openai"` (143 passed), pipeline `venv/bin/python -m pytest scripts/python-tools/tests/` (128 passed). Lint local: `flake8 app/ tests/ --max-line-length=120 --ignore=E203,W503` + `black --check app/ tests/` (line-length 120 via `pyproject.toml`).
