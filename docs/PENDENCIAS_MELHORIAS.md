# Pendências & Melhorias do Concierge Collector

Lista viva de áreas, pendências e melhorias — atualizada em 2026-09-12.
Fonte: memórias do projeto, auditoria de segurança, sessões de trabalho e estudo do feedmine.

## Áreas

1. **Frontend/UI** — Collector (raiz, tema concierge) + capture app (identidade-fonte)
2. **Backend API** — 13+ routers FastAPI em `app/api/` (revisão de endpoints pendente)
3. **Auth/Segurança** — JWT, OAuth Google, RBAC, SSRF, rate limits
4. **Sync/Offline** — sync bidirecional, IndexedDB, fila client-side
5. **Places/Google** — Places API (New), fotos, autocomplete
6. **Pipeline Python** — OSM/Overture/Michelin → merge → rich → import → curations draft
7. **Infra/Deploy** — Render (2 serviços), Atlas, deploy manual quando auto falha
8. **Testes/Qualidade** — vitest (1064 passed/70 skipped, 113 arquivos), pytest (478 unit), lint local (CI removido)

## Pendências

### Frontend/UI
- [x] ~~Cards "somem e voltam" a cada refresh do sync~~ — RESOLVIDO: renderCurationsPage fazia innerHTML='' ANTES da resolução async das entities (janela em branco no data-changed/sync-success); agora monta em fragment e troca atomicamente (replaceChildren) — lista antiga visível até a nova pronta. Validado com resolução atrasada 600ms: container nunca esvazia.
- [x] ~~Ruído de log: `Unhandled rejection: NotFoundError: objectStore not found`~~ — RESOLVIDO: hooks do DataStore disparavam `concierge:data-changed` SINCRONAMENTE dentro da transação (escopo travado); listeners liam outras tabelas → NotFoundError. Evento agora é deferido (setTimeout 0).
- [x] ~~Click no card de curadoria linkada não abria detalhes~~ — RESOLVIDO: regressão do renderCurationsPage (createCurationCard sem onClick — o default é console.log); agora abre handleViewReviewDetails como o review card.
- [x] ~~`dbg.tmp.mjs` na raiz (resto de debug do IndexedDB)~~ — RESOLVIDO: arquivo não existe mais no repo
- [ ] Curadorias órfãs (53 no Mongo, ids `entity_curation_test_*`): review card sem véu — decidir: limpar lixo ou resolver por nome via EntityBrowser (a saved view "Unlinked" agora as expõe na UI — facilita a decisão)
- [x] ~~Degraded mode: passe visual~~ ✓ — DOM audit no modo degradado (IndexedDB quebrado) mostra 100% do tema (limestone/oliva/tints remapeados); resquícios reais corrigidos: toast fatal usava #ef4444 → var(--color-error), e --color-danger não existia (7 usos caíam no vermelho velho) → alias criado. (O pixel-scan antigo dava falso positivo: tolerância ±10 confunde #fbf9f5 quente com #f9fafb frio.)

### Backend API
- [x] ~~**Revisão sistemática dos endpoints**~~ — FEITA: docs/API_ENDPOINT_REVIEW.md (inventário + uso + remoções + consolidações)
- [x] ~~Routers `places.py` + `places_router.py` + `places_orchestrate.py`~~ — CONSOLIDADOS (rotas preservadas; healths duplicados sem consumidor removidos; rotas mortas usage-stats/health-original removidas — ver docs/API_ENDPOINT_REVIEW.md)
- [x] ~~Endpoints sem uso real~~ — mapeados no review (consumidores frontend/MCP/OpenAI identificados)

### IA — CONCLUÍDO (ver docs/AI_MODERNIZATION_PLAN.md — 5 fases: modelos gpt-5.6, prompts com vocabulário forçado, validação+re-prompt, retries, pipeline DeepSeek)

### Auth/Segurança
- [x] ~~OAuth: cookie HttpOnly~~ ✓ (ADITIVO — o Bearer continua o caminho principal): access_token também flui via cookie HttpOnly (SameSite=lax, Secure em prod) definido no callback/refresh/dev-login e limpo no logout; verify_auth aceita o cookie como fallback; apiService manda credentials:include. ⚠️ 2026-08-16: Safari descarta Set-Cookie de redirect cross-site (Google → API) — o login por cookie-sozinho quebrou no iPhone; o callback same-site agora também entrega os tokens no FRAGMENT (`?session=1#token=...`), que é o caminho confiável. Remover o localStorage NUNCA será viável para o login no Safari — o fragment+localStorage é load-bearing.
- [ ] Rotação do client id/secret OAuth vazados em docs (usuário adiou — cobrar de novo)

### Sync/Offline
- [x] ~~Pull de entities vinculadas / consistência~~ ✓ — aba server-driven resolve entities por fora (local chunked + API ids + persistência) desde o fix do renderCurationsPage

### Dados
- [ ] Junk de teste no banco: `entity_curation_test_*` (entities + curations) — limpar via `scripts/python-tools/data_cleanup.py` (destrutivo: confirmar antes)

### Infra
- [ ] CI do GitHub Actions removido (billing) — decidir se reativa
- [ ] Auto-deploy do Render não confiável — sempre verificar após push
- [x] ~~API parada em commit antigo~~ — RESOLVIDO em 2026-09-12: o serviço `Concierge-Collector` (API) estava live em `077c1633` (01/09) enquanto `main` já tinha ~180 commits; o auto-deploy existe mas não pega. Deploy manual disparado via API do Render: `b545626a` subiu em 77s, `/api/v3/ready` com 31 índices e 0 falhas, zero 5xx. **Lição: `Concierge-Collector-Web` (static) estava atualizado e a API não — verificar os DOIS depois de cada push, eles divergem.**
- [x] ~~Admin/Worker não existiam~~ — CRIADOS em 2026-09-12 (4 serviços no total agora):
  - `Concierge-Collector-Admin` (web_service, Docker, `Dockerfile.admin`) — `srv-daigcl7qj5pc73a0jd70`
  - `Concierge-Collector-Admin-Worker` (background_worker, `npm run start:admin-worker`) — `srv-daigclh594qs738lbp4g`
  - Ambos região `oregon`, plano `starter`, autoDeploy de `main`. Worker grava heartbeat 1/min e roda as filas (verificado: `worker_heartbeats` + `payload-jobs` com 4 tasks).
  - Banco `concierge-cms` no MESMO cluster Atlas, lógico e separado.
- [x] ~~Migrations do Payload pendentes~~ — 11/11 APLICADAS em 2026-09-12 (banco novo). Dois bloqueios reais apareceram e foram corrigidos:
  1. `Module not found: '@concierge/fastapi-client'` — o `dist` do client é gerado e cai no `.dockerignore`; o `Dockerfile.admin` nunca o gerava. Corrigido com `npm run generate && npm run build` do workspace `fastapi-client` antes do build do admin.
  2. `next start --hostname 0.0.0.0 10000` → `Invalid project directory` — `npm run start:admin -- --port N` não repassa a flag (o script interno é outro `npm run`, sem `--`). Agora `next` lê `PORT` do ambiente.
  3. `Index already exists with a different name: slug_1` — o `autoIndex` do Mongoose (default true) criava os nomes padrão (`slug_1`), enquanto as migrations usam nomes explícitos (`collections_slug_unique`). Corrigido com `connectOptions.autoIndex: false` — migrations passam a ser donas exclusivas dos índices. **Atenção: `collectionsSchemaOptions` NÃO serve para isso (é indexado por slug de coleção).**
- [ ] **`admin.concierge-collector.com` ainda NÃO resolve em DNS** — ÚNICO bloqueio restante da funcionalidade. O domínio já está anexado ao serviço Admin no Render (`cdm-daiggo15efls73deb3eg`, status `unverified`) esperando o registro; não há mais nada a fazer do lado do Render.
  - **Provedor de DNS: Namecheap** (nameservers `dns1/dns2.registrar-servers.com`). Não existe credencial de API de DNS no ambiente, então este passo é manual.
  - Caminho no painel: Namecheap → Domain List → `concierge-collector.com` → **Advanced DNS** → Add New Record:
    ```
    Type: CNAME Record
    Host: admin                                        (só "admin", não o FQDN)
    Value/Target: concierge-collector-admin.onrender.com
    TTL: Automatic
    ```
  - Mesmo padrão dos já verificados: `api.*` e `capture.*` → `concierge-collector.onrender.com`; `www.*` → `concierge-collector-web.onrender.com`.
  - Depois de salvar, o Render detecta sozinho e emite o TLS (alguns minutos). Verificação: `dig +short CNAME admin.concierge-collector.com` deve devolver o alvo, e `curl -sI https://admin.concierge-collector.com/health` deve dar 200.
  - Enquanto isso, o **modal de Collections do Collector falha com `network_error`** (degrada tipado, não quebra a app) porque `scripts/core/config.js` aponta `cms.adminBaseUrl` para esse host.
  - **Não** aponte o Collector para o host `*.onrender.com` como paliativo: `CMS_ADMIN_ORIGIN`, `CMS_ADMIN_CALLBACK_URL`, `CMS_PUBLIC_SERVER_URL` e a allowlist de CORS/CSRF são todos o origin canônico — trocar o host quebraria o modelo de sessão em vez de contorná-lo.
- [x] ~~7 feature flags `default: false` em production~~ — TODAS LIGADAS em 2026-09-12, na ordem do runbook, com verificação a cada passo. Cada uma foi confirmada abrindo o gate (503 `feature_disabled` → 401/404 real):
  - API: `CMS_AUTH_ENABLED`, `CATALOG_SCAN_ENABLED`, `COLLECTOR_ASSOCIATION_READ_ENABLED`, `COLLECTIONS_DISTRIBUTION_ENABLED`
  - Admin: `COLLECTIONS_ADMIN_ENABLED`, `COLLECTOR_DRAFT_MUTATION_ENABLED`, `CONSUMER_CREDENTIALS_ENABLED`
  - Prova da credencial compartilhada: com `X-CMS-Service-Key` correta o `/catalog/curations` passa de "Invalid CMS service credential" para "CMS actor is required" (ou seja, autenticou); com chave errada continua 401.
  - Smoke final: **zero 5xx**, distribution devolve `401 Consumer credential required` (fail-closed para anônimo).
  - **Prova server-to-server (a mais forte obtida sem credencial de usuário):** o Worker chama a API em `/api/v3/internal/consumer-usage` com `X-CMS-Service-Key`. Antes de a `CMS_SERVICE_KEY` existir na API, o job `sync-consumer-usage` falhava a cada ciclo com `service_unavailable` (4 erros: 08:17/08:24/08:29/08:34). Depois da chave configurada + deploy, o job de 08:46 rodou **sem erro** e os 3 jobs dos 10 min seguintes (incl. `reconcile-leases` e `record-worker-heartbeat`) também. Ou seja: a credencial compartilhada Admin↔API está validada por tráfego real, não só por abertura de gate.
  - `worker_heartbeats` constantes a 1/min, sem lacunas; nenhum dado de domínio apagado pelas tasks de manutenção (`collections`, `collection_versions`, `collection_memberships`, `consumer_credentials`, `audit_events` todos em 0 — nada a perder, mas também nada removido).
  - ⚠️ Os CANÁRIOS de verdade (login de admin, publicar uma Collection, emitir credencial) **não foram executados** — exigem uma pessoa com conta Google autorizada. Foram verificados os gates e o caminho server-to-server, não os fluxos de UI.
- [ ] **Privilégio amplo a estreitar**: o Admin/Worker usam a MESMA credencial Atlas da API (que tem readWrite em `concierge-collector`), e `CMS_MONGODB_READ_URL` da API usa a mesma credencial. O desenho pedia usuários separados (o comentário em `config.py` é explícito: "a API nunca é dona de mutations nem de índices desse namespace"). Criar usuários scoped no Atlas quando houver acesso à API do Atlas.
- [ ] `frame-ancestors` (anti-clickjacking) não pode ser definido por `<meta>` (ignorado por spec) — precisa de header HTTP. No static site do Render, configurar em Headers customizados do dashboard. O resto da CSP já está no shell (script-src estrito).

### Segurança (auditoria 2026-09-12)
- [x] ~~`href` do site da entity sem escape no card (injeção de atributo)~~ — CORRIGIDO. Dado de produção verificado: 21.604 entities, **0 com aspa/`<`/`>`** em website — superfície de código real, sem payload armazenado (não era incidente em curso).
- [x] ~~9 helpers de escape não escapavam aspas~~ (quebra de atributo em `aria-label`/`data-*`/`src`/`alt`) — CORRIGIDO e normalizado no mesmo contrato do `cardFactory`.
- [x] ~~`uiUtils.confirmDialog`/`showLoading` e `updateProcessingStatus` interpolavam texto externo cru~~ (nome de curador do servidor virava markup no dialog de ownership) — CORRIGIDO.
- [x] ~~CDNs sem SRI e `toastify-js` sem versão (resolvia "latest" a cada request)~~ — CORRIGIDO (sha384 + versão pinada; hash adulterado é bloqueado, verificado em browser).
- [x] ~~Sem CSP~~ — CORRIGIDO: `script-src 'self' https://cdn.jsdelivr.net` estrito (inline injection e host arbitrário bloqueados em browser). `style-src` mantém `'unsafe-inline'` por causa dos `style=""` estáticos do markup — não governa execução.
- [x] ~~Refresh token no `localStorage` no caminho cookie-first~~ — CORRIGIDO: `storeTokens({persistRefreshToken:false})` quando o cookie HttpOnly responde.
- [ ] Remover o `localStorage` no Safari: **impossível** — o fragment+localStorage do login cross-site é load-bearing (ver nota em Auth/Segurança). O alvo realista é manter o access token fora do storage e o refresh só no cookie onde ele funciona.

## Melhorias

### Feedmine (estudo: `docs/UI/FEEDMINE_DESIGN_STUDY.md`)
- [x] ~~**Prefetch da próxima página**~~ ✓ — peekPage() não-mutante nos browsers + pré-resolução 1,5s após a página enfileirar (dedupe por página); validação real sem corromper paginação
- [x] ~~Estabilizar visualização mobile (pré-requisito dos swipe actions)~~ ✓ — #app forçava padding:0 matando o px-4 do Tailwind (overflow 16px + pan horizontal); overscroll-behavior-x:none no body; cards com touch-action:pan-y. Validado: scrollWidth == viewport em 390px e 1280px, zero offenders.
- [x] ~~Swipe actions mobile nos cards~~ ✓ — swipe esquerda = editar, direita = detalhes (design conservador, não-destrutivo); click pós-gesto suprimido via flag swipeActive; feedback visual via classe .swiping (tint oliva); validado com touch emulado (edit/details/click pós-swipe)
- [x] ~~Badges de tipo no fallback~~ ✓ — badge "novo" (createdAt ≤ 24h) sob o badge do tipo, tom aço (padrão newBadge do feedmine)
- [ ] Avaliar OKLCH para novas escalas (só em componentes novos — tema atual é curado)

### og-image (véu)
- [x] ~~Negative cache com backoff~~ ✓ — miss re-tenta em 10min (hit 1h), teste de TTL com monotonic mockado
- [x] ~~Métricas de cobertura por fonte~~ ✓ — contadores em memória (requests, cache_hits_bytes, source_og, source_places, no_image) + GET /api/v3/og-image/stats (auth curator); testes cobrem shape e auth
- [x] ~~Cache Storage: eviction LRU~~ ✓ — cap de ~200 entradas no _writeCache (remove as mais antigas por ordem de inserção)

### API
- [x] ~~Endpoint agregado por entity (`/entities/{id}/image`) que encapsula og+places~~ ✓ — GET /api/v3/entities/{entity_id}/image resolve website/place_id da própria entity (mesma cadeia tolerante dos cards, `_extract_image_sources`) e devolve o JPEG via og_image_service; 404 sem entity/fonte, 400 URL rejeitada; 6 unit tests sem mongo
- [x] ~~`semantic_search_curations` montava payload de resposta para todo candidato e descartava no slice final~~ ✓ — pontuação agora fica em tuplas leves e o payload só é montado para o top-k (payload builder é puro; ordenação estável preservada). Sem mudança de contrato.
- [ ] **Alavanca de crescimento do fallback semântico**: o scan exaustivo (`_vector_search_or_fallback`) materializa TODOS os candidatos elegíveis de propósito — é contrato testado (`test_semantic_fallback_recall.py` falha se truncar ou ordenar por recência, porque o ponto é não esconder uma Curation antiga e boa). Com ~1k curations são poucos MB; quando a coleção crescer muito, o caminho é (a) voltar a indexar o vetor no Atlas (o índice não funciona com o formato Binary float32 — ver `app/core/vector_packing.py`), ou (b) denormalizar um vetor float de busca separado. NÃO truncar o scan.
- [ ] `_filter_by_entity_types` faz um único `$in` com um id por curation (~1k valores hoje) — cresce junto com a coleção; batchar quando passar de alguns milhares.
- [x] ~~Docs OpenAPI com exemplos dos endpoints novos (og-image)~~ ✓ — examples em url/place_id do /og-image + docstring com o contrato de resposta

### UX
- [x] ~~Datas relativas nos demais lugares com timestamp (sync activity)~~ ✓ — formatter canônico em `uiUtils.formatRelativeDate` (Intl.RelativeTimeFormat cacheado, ~30 dias → absoluto); sync status mostra "Last sync: 2 hours ago" com absoluto no title; ConflictResolutionModal delega para a mesma implementação
- [x] ~~Saved views (auditoria, ponto 20)~~ ✓ — chips "My drafts" (status=draft + curator atual), "Unlinked" (param novo `unlinked` no /curations/search) e "Recently added" (param `created_after`, janela 24h = badge "novo") na view de curations; toggle liga/desliga, My drafts deriva dos selects (mudança manual desliga o chip); fallback local também filtra. ⚠️ "Sync issues" (4º exemplo da auditoria) fica pendente — exige juntar estado local de fila/conflitos à listagem
- [x] ~~Empty states tipados por seção~~ ✓ — templates no-curations (rate_review), no-entities (storefront), no-curator (person_off) no emptyStateManager; 4 blocos inline do uiManager trocados pelos presets

## Cadência

- Commitar + pushar **de tempos em tempos** durante sessões longas (a cada ~30 min com mudanças não commitadas) — sessão atual usa lembrete recorrente
- Após cada push em `main`: verificar deploy dos 2 serviços do Render (auto-deploy existe mas não é confiável)
