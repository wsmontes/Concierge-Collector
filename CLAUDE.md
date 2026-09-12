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

Produção tem **2 serviços no Render** (1 web service + 1 static site), configurados **manualmente no dashboard** — a infra segue não versionada, mas o **imagem Docker do web service agora É versionada** (`Dockerfile` na raiz):

| Serviço | Detalhe |
|---|---|
| **App** — web service "Concierge-Collector" (`srv-d4fngpjuibrs73bo70vg`) | runtime **Docker**, `Dockerfile` na raiz (contexto = repo inteiro, `rootDir` vazio), URL `https://api.concierge-collector.com`, health check `GET /api/v3/health` |
| **Web** — static site "Concierge-Collector-Web" (`srv-d4fnrlje5dus7397lii0`) | root `/`, sem build, publish `.`, URL `https://concierge-collector-web.onrender.com` |

### O web service roda TRÊS processos no mesmo container (nginx roteia uma porta só)

Desde 2026-09-12 o Admin (Payload) e o runner de jobs vivem **dentro** do serviço da API — antes eram 3 serviços pagos separados, o que não se justificava sem clientes. Roteamento (`deploy/nginx.conf.template`):

```
/api/v3, /capture, /            -> uvicorn  (FastAPI, 127.0.0.1:8000)
/admin, /_next, /api/<não-v3>   -> next     (Payload, 127.0.0.1:3000)
jobs:run (sem porta)            -> payload jobs: filas + agendamentos
```

- Processos sob `supervisor` (`deploy/supervisord.conf`); entrypoint em `deploy/entrypoint.sh` gera a config do nginx com o `$PORT` do Render.
- **Consequência de arquitetura:** o Admin mora no MESMO host da API. O Collector fala com `https://api.concierge-collector.com/api/admin/v1/...` (`scripts/core/config.js` → `cms.adminBaseUrl`). **Não existe** `admin.concierge-collector.com`.
- ⚠️ **Dois detalhes do nginx que existem para não perder dado:** `proxy_buffering off` em `/api/v3` (a API faz streaming — NDJSON de export e proxy de fotos; bufferizar transforma stream em memória) e `client_max_body_size 100m` (a IA recebe áudio e imagens em base64; o default de 1m recusaria).
- O runner de jobs é processo próprio, **não** `jobs.autoRun` do Payload: o `jobs:run --handle-schedules` também CRIA os jobs agendados (heartbeat, reconciliação, retenção). `autoRun` só drena filas — trocar por ele pararia os agendados em silêncio.
- Os bancos continuam separados: `concierge-collector` (API) e `concierge-cms` (Payload), ambos no mesmo cluster Atlas (`CMS_MONGODB_DB_NAME=concierge-cms`).
- Migrações do Payload **não** rodam no boot (nem web nem jobs): são passo explícito de release, hoje via `npm run migrate:cms:locked` de uma máquina local com `apps/admin/.env` apontando para produção.

- ⚠️ **Ambos os serviços auto-deployam da branch `main`**. O auto-deploy **existe mas não é confiável** — verificado em 2026-09-12 que o static site estava atualizado enquanto a API ficou ~180 commits atrás; **conferir os dois** após cada push e disparar manualmente se necessário (via dashboard ou `scripts/python-tools/render_deployment_manager.py`). Deploy do serviço fundido leva ~3,5 min (build Node + Next + Python).
- Sem preDeployCommand/seeds. O boot cria apenas o índice TTL de `capture_sessions` (48h, em `concierge-api-v3/app/core/lifespan.py`); as migrações do Payload são passo explícito (ver acima).
- Env vars vivem no dashboard do Render (só nomes). **Atenção ao ler via API:** `GET /services/{id}/env-vars` **pagina em 20 por padrão** — sem `?limit=100` a leitura trunca e um merge read-modify-write apagaria o resto. Escrever sempre por chave (`PUT /env-vars/{key}`), que é aditivo (verificado).
  - API/captura: `MONGODB_URL`, `MONGODB_DB_NAME`, `API_SECRET_KEY`, `ADMIN_API_KEYS`, `ADMIN_EMAILS`, `JWT_SIGNING_SECRET`, `OPENAI_API_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `CORS_ORIGINS`, `TRUSTED_CALLBACK_ORIGINS`, `ENVIRONMENT`, `LOG_LEVEL`, `FRONTEND_URL(_PRODUCTION)`.
  - CMS/Payload (mesmo serviço): `CMS_MONGODB_URL`, `CMS_MONGODB_DB_NAME`, `CMS_MONGODB_READ_URL`, `PAYLOAD_SECRET`, `CMS_SERVICE_KEY`, `METRICS_KEY`, `CMS_PUBLIC_SERVER_URL`, `CMS_COLLECTOR_ORIGINS`, `FASTAPI_BASE_URL`, `CMS_ADMIN_ORIGIN`, `CMS_ADMIN_CALLBACK_URL`, `CMS_JOB_*`, `CMS_ORPHAN_STAGING_*`, `CMS_USED_SELECTION_RETENTION_DAYS`.
  - Feature flags (ver `config/collections-feature-flags.json`): API lê `CMS_AUTH_ENABLED`, `CATALOG_SCAN_ENABLED`, `COLLECTOR_ASSOCIATION_READ_ENABLED`, `COLLECTIONS_DISTRIBUTION_ENABLED`; o Admin lê `COLLECTIONS_ADMIN_ENABLED`, `COLLECTOR_DRAFT_MUTATION_ENABLED`, `CONSUMER_CREDENTIALS_ENABLED`. Todas fail-closed em produção se ausentes.
- O Python da imagem é **3.12** (pinado no `Dockerfile`, que usa `python:3.12-slim-bookworm` + binários do Node 22 copiados da imagem oficial). O `runtime.txt` da raiz **não se aplica mais** ao serviço.
- GitHub Actions roda **apenas testes** (não faz deploy): backend unit tests + flake8/black; frontend vitest.
- Legado: GitHub Pages (`wsmontes.github.io/Concierge-Collector`) + PythonAnywhere ainda aparecem como fallback em `config.js`/`config.py`.

## Acesso a serviços externos (verificado 2026-08-12)

- ⚠️ **Gotcha crítico local:** o perfil do shell (zsh) exporta `OPENAI_BASE_URL=http://localhost:1234/v1` (LM Studio), `OPENAI_API_KEY=lm-studio` e `OPENAI_MODEL` — qualquer script Python que herde o ambiente e use o SDK da OpenAI passa a falar com o LM Studio local e falha com `"No models loaded ... 'lms load'"`. Para usar a API real da OpenAI: `env -u OPENAI_BASE_URL -u OPENAI_API_KEY -u OPENAI_MODEL python ...`, ou passe `base_url='https://api.openai.com/v1'` e leia a chave direto do `.env` (a chave local `sk-proj-...` é válida). O `scripts/python-tools/backfill_embeddings.py` já trata isso.
- Credenciais locais em **`concierge-api-v3/.env`** (git-ignored; valores de produção ficam no dashboard do Render). **Nunca** commitar valores secretos — usar apenas nomes de variáveis.
- `RENDER_API_KEY` do `.env` **funciona**: workspace "My Workspace", ownerId **`tea-d09cc5je5dus73bbc5m0`** (o ownerId de `render_deployment.log` está desatualizado — o log lista 7 serviços do workspace, incluindo projetos alheios).
- `MONGODB_URL` do `.env` **conecta direto do IP local** ao Atlas (cluster `concierge-collector.7bwiisy.mongodb.net`, banco `concierge-collector`). Contagens de referência (18/ago/2026, pós-limpeza): entities ~21,6k, curations ~1.057. As coleções `embeddings`/`embedding_links` **não existem mais** — embeddings são inline em `curations.embeddings` (float32 Binary, ~6KB/vetor). Banco de teste: `concierge-collector-test` (usado por pytest e pela integração do frontend).
- **Cota de storage do Atlas**: incidente de 2026-08-12 (512MB estourados, escritas bloqueadas) RESOLVIDO via backup BSON + wipe + restore com embeddings compactados (Binary float32, ~6KB/vetor — `app/core/vector_packing.py`); índice vector `curations_embeddings_vector` removido pelo usuário na UI do Atlas (não funciona com o formato Binary de qualquer forma — o fallback scan é o que roda). Manter `MONGODB_CURATIONS_VECTOR_INDEX` **unset** no dashboard; novos embeddings devem SEMPRE ser gravados float32 (backfill já faz). Backup em `data/backups/full-dump-2026-08-12/` (gitignored).
- Gotcha de shell: `set -a; . .env` **não exporta** as variáveis neste ambiente — carregar linha a linha com `export "$key=$val"` (ver memória `render-mongo-access`).
- Gerenciamento do Render via script: `scripts/python-tools/render_deployment_manager.py` (usa `RENDER_API_KEY`).

## Comandos úteis

**Frontend** (raiz do repo, Node ≥18):
- `npm test` (vitest run), `npm run test:watch`, `npm run test:coverage` (thresholds 70/60/70/70)
- Teste único: `npx vitest run tests/<arquivo>.test.js -t "nome do teste"`
- Ambiente jsdom + fake-indexeddb + globals; setup em `tests/conftest.js`
- ⚠️ Integração (3 arquivos `test_api*`/`test_integration`) SÓ roda contra banco `-test`: o guard de `tests/helpers.js` consulta o `/info` da API e pula com `t.skip(motivo)` quando o banco é produção. Para liberar: `cd concierge-api-v3 && ./run_local.sh --test-db` (+ `API_V3_BASE_URL` se a API estiver em outra porta). Teardown por REGISTRO de ids (nunca varrer listas).

**Backend** (`concierge-api-v3/`, venv em `venv/`):
- Subir local: `./run_local.sh` (cria venv, instala deps, sobe uvicorn em background; logs em `uvicorn.log`) ou `venv/bin/python -m uvicorn main:app --reload` — API em `http://localhost:8000/api/v3`, docs em `/api/v3/docs`
- Testes: `venv/bin/pytest` — unit apenas: `venv/bin/pytest -m "not integration and not external_api and not mongo and not openai"` (comando exato do CI); teste único: `venv/bin/pytest tests/test_x.py::test_y`
- Marcadores pytest: `integration`, `external_api`, `mongo`, `openai`, `slow` (`pytest.ini` usa `--timeout=60`; `pytest-timeout` já está no venv)
- Lint: `flake8` + `black` (como no CI; `pyproject.toml` define line-length 120 para o black, igual ao flake8)

**Auth local (dev):** `/auth/dev-login` gera JWT válido; o frontend auto-loga em localhost. Frontend local: servir a raiz em `127.0.0.1` (ex.: Live Server porta 5500) — o `config.js` detecta o ambiente pelo hostname e aponta para a API local.

**Saúde de produção:** `curl https://concierge-collector.onrender.com/api/v3/health` → esperado `{"status":"healthy","database":"connected"}`.

**Smoke test de produção (read-only):** `concierge-api-v3/venv/bin/python scripts/python-tools/prod_smoke.py` — varre todas as rotas GET via OpenAPI com ids reais do Mongo e retry. Baseline 2026-08-14: 18 rotas OK, 6 4xx esperados (auth/validação), 0 erros 5xx, 3 skip. ⚠️ Gotcha: os paths do `openapi.json` **já incluem** o prefixo `/api/v3` — nunca prefixar de novo ao montar URLs (causa 404 total e falso diagnóstico de incidente).

**CI:** REMOVIDO em 2026-08-14 (a pedido do usuário) — workflows de GitHub Actions deletados e Actions desabilitadas no repo (conta travada por billing do usuário; todo run falhava em 3s). Testes rodam LOCALMENTE e são a barra de qualidade: frontend `npm test` (865 passed/70 skipped em 18/ago — skipped = integração com API de produção; com `run_local.sh --test-db` a integração roda), thresholds 70/60/70/70 no `test:coverage` (84,3% stmts), backend `venv/bin/pytest -m "not integration and not external_api and not mongo and not openai"` (289 passed), pipeline `venv/bin/python -m pytest scripts/python-tools/tests/` (151 passed). Lint local: `flake8 app/ tests/ --max-line-length=120 --ignore=E203,W503` + `black --check app/ tests/` (line-length 120 via `pyproject.toml`).
