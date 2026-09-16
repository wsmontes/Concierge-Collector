# Pendências & Melhorias do Concierge Collector

Lista viva de áreas, pendências e melhorias — atualizada em 2026-09-16.
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
- [x] ~~"curadorias órfãs" reaparecendo em todo boot (`27 issues found, 0 repaired`)~~ — RESOLVIDO em 2026-09-12, com DUAS causas encadeadas (a segunda só apareceu porque a primeira foi corrigida):
  1. **Pull puramente incremental.** `pullLinkedEntities` buscava todas as vinculadas com `?since` (filtro por `updatedAt`), então uma entidade nunca puxada e não modificada desde o watermark era excluída em TODO sync, para sempre. Corrigido com duas passadas: BACKFILL das ausentes no cache (sem `since`) + REFRESH das presentes (com `since`). O contador caiu de 27 para 13 — não zerou, e isso expôs a causa 2.
  2. **Ids com vírgula quebravam o `?ids=`** (o bug de verdade). O parâmetro era um CSV único e o servidor fazia `ids.split(",")`; os ids do pipeline `rest_<slug>_<lat>,<lng>` contêm a vírgula que separa lat/lng (**408 entidades**), então o split fragmentava o id em `rest_x_-23.5` + `_-46.6` — nenhum casava, a entidade nunca era devolvida e a curadoria ficava órfã INDEFINIDAMENTE (o backfill também não conseguia, porque ele usa o mesmo `?ids=`). Corrigido: `ids` agora é parâmetro REPETIDO (`?ids=a&ids=b`), cada item um id completo.
  - **Prova contra dados reais de produção**: com ids `rest_*` reais, o formato novo devolve **3 de 3**; o formato antigo devolvia **0 de 3**.
  - Integridade do servidor verificada antes de mexer e não era o problema: 1035 entity_ids referenciados, 1035 existem, 0 dangling — nada foi perdido, era só o cache local que nunca recebia essas entidades.
  - ⚠️ Consequência no cliente: o `?ids=` repetido NÃO passa pelo `RequestChunking.idsQuery` (esse caminho existe para os chamadores do Collector). O parâmetro é apenas ≤500 ids curtos.
- [ ] `cleanupBrowserData()` (main.js) **apaga a cada boot todo localStorage fora de `preserveKeys`**. O próprio comentário registra que isso já quebrou o onboarding ("a feature reaparecia em TODO reload"). Qualquer chave nova precisa ser adicionada lá ou some. É design deliberado, mas é armadilha: revisar se a limpeza deveria ser allowlist (só remove chaves conhecidas-obsoletas) em vez de denylist. Não alterado por ser comportamento intencional e sem teste.

### Dados
- [ ] Junk de teste no banco: `entity_curation_test_*` (entities + curations) — limpar via `scripts/python-tools/data_cleanup.py` (destrutivo: confirmar antes)

### ✅ RESOLVIDO: wrappers de durabilidade não instalavam (5 avisos em todo boot)

O boot emitia cinco avisos em cadeia — `durability wrappers not installed`,
`Ownership guard could not attach`, `Authoring controller could not attach`,
`Source identity bridge could not attach`, `Save coordinator could not attach`.

**Duas causas empilhadas. A primeira análise (commit `ff3e4a17`) pegou só a de
cima e a chamou de "causa única" — estava incompleta.** O registro completo:

#### Causa 1 (parcial) — install sem retry

`installSaveCompatibility` precisava de `conceptModule.saveRestaurant`, não
achava e **retornava sem re-tentar**, deixando
`__curationWorkspaceSaveCompatibilityInstalled` nunca setado. Corrigido em
`ff3e4a17` com retry (300 × 100ms).

**O retry sozinho não resolveu** — e isso está no log de produção do usuário:
`curationWorkspaceModule.js?v=9af479f2549c:681` re-tentando e mesmo assim
`conceptModule.saveRestaurant ausente` até desistir. O retry estava re-tentando
contra um objeto morto.

#### Causa 2 (a raiz real) — `window.uiManager` era substituído, e o workspace
#### guardava a instância órfã

O app construía **duas** instâncias de `UIManager`:

| # | onde | quando |
|---|---|---|
| **A** | `uiManager.js:~3680` `ModuleWrapper.createInstance` | no **parse** (index.html:1008) |
| **B** | `main.js:322` `new UIManager()` | após o await de auth |

`curationWorkspaceModule.js` (index.html:1025) registra o listener de
`DOMContentLoaded` **antes** do `main.js` (index.html:1065), então o
`bootstrap()` roda primeiro e **captura A** em `this.uiManager`. Aí o `main.js`
atribui B sobre `window.uiManager` e chama `B.init()` — e é o `init()` que cria
o `conceptModule`.

    grep: 2 atribuições a window.uiManager, 1 única chamada de init() (main.js:323, em B)

Logo `A.init()` nunca roda, `A.conceptModule` é `undefined` para sempre, e o
workspace — preso a A — nunca conseguia setar o flag.

Todos os **outros** módulos leem `global.uiManager` *lazy* dentro do poll: veem
B (viva) e apenas esperam um flag que o workspace nunca sobe. Por isso a cascata
inteira parecia "timeout de 30s" quando era um alias errado.

**Correção**: (1) `main.js` reusa a instância global em vez de criar a segunda;
(2) `CurationWorkspaceModule` resolve `window.uiManager` via getter, a mesma
convenção lazy de todos os outros módulos — era o único que capturava cedo, e
por isso o único que quebrava.

**Verificação em produção** (sem sessão; `49b240e4`):

| medição | resultado |
|---|---|
| `curationWorkspace.uiManager === window.uiManager` | **true** |
| executar a linha do `main.js` na instância reusada (`init()`) | **`UIManager initialized`**, `conceptModule` criado |
| compat instalou sozinho após o `init()` | **true** |
| substituir a instância global → instala na VIVA / órfã intocada | **true / true** |
| **flags da cascata instalados** (com avisos capturados) | **7 de 8, e ZERO avisos** (antes: 0 de 8 e 5 avisos) |

Flags confirmados: `__curationWorkspaceSaveCompatibilityInstalled`,
`__offlineDurabilityDraftAutosaveInstalled`, `__offlineDurabilitySaveInstalled`,
`__offlineDurabilityEditRestoreInstalled`, `__offlineOwnershipGuardInstalled`,
`__curationAuthoringControllerInstalled`, `__offlineSourceIdentityBridgeInstalled`.

- [ ] **O 8º (`__offlineSaveCoordinatorInstalled`) não fecha pré-login, e isso é
  esperado — não é alias quebrado.** Medido: `wrappersReady()` exige
  `__offlineKnownLinkageGuardInstalled`, e o `offlineKnownLinkageGuard.install()`
  exige `DataStore.db.curations.put`, que é **`null` antes do login** (tabela
  Dexie só existe após `DataStore.init()` no boot autenticado). Chamando
  `install()` direto: retorna `false` com `curations === null`. A cadeia é uma
  dependência legítima pós-auth.
  > Armadilha de diagnóstico: `typeof null === "object"`, então um probe ingênuo
  > reporta `curations: "object"` e esconde que é `null`. Foi o que me enganou
  > por duas rodadas — conferir `=== null`, não `typeof`.

- [ ] ⚠️ **NÃO verificado ponta a ponta**: o fluxo de autoração em si (abrir
  editor → editar → salvar → interromper). Esta correção não só silencia os
  avisos: **ativa** autosave durável de draft, restore de draft, guarda de
  ownership, ponte de identidade de fonte e coordenador de save, todos inertes
  até aqui. O restore de draft pode reescrever o conteúdo do editor — precisa de
  uma sessão real de curador para fechar.
- [ ] As janelas de retry são de 30s (300 × 100ms) em todos esses módulos. O auth
  leva ~9s, então há folga; um cold start além de 30s volta a não instalar. A
  correção robusta é retry lento e perpétuo — **não feito** (o `knownLinkageGuard`
  legitimamente espera o `DataStore`, e um retry perpétuo é o que o comporta).

### Memória do serviço único — número a vigiar
Plano `starter` = **512 MB / 0.5 CPU** ($7/mês). Medido no serviço fundido:
- regime: **370-378 MB (73-74%)**; pico **428 MB (84%)** às 18:20 (pode incluir as duas instâncias
  durante o blue/green de um deploy).
- CPU folgadíssima: pico 0.05 de 0.5 núcleo.

Os quatro processos (uvicorn + Next + jobs + nginx) dividem 512 MB. Se houver picos (muitas resoluções
de imagem simultâneas, chamadas de IA com imagem/áudio em base64), o risco é OOM → reinício do
container → **exatamente o sintoma de 502 sem CORS** já observado. Referência de custo: 3 serviços
`starter` custavam $21/mês; hoje é 1 por $7; se apertar, `standard` (1c-2g, $25) dá 2 GB.

**O risco se materializou em 2026-09-16** (medido, não inferido): 4 eventos `server_failed` com
`reason.oomKilled` em 4 dias — **todos no mesmo dia** (05:59, 06:36, 06:39, 06:46) e todos durante
navegação real — 13 de 20 probes de `/api/v3/health` responderam 502 enquanto o container reiniciava
(~30 s de indisponibilidade em TODAS as superfícies, porque API, Admin, runner e nginx são o mesmo
processo pai). O gatilho não é tráfego anômalo: abrir a lista do Collector dispara ~30 requisições de
imagem (cada uma faz o servidor buscar a página do site e/ou chamar o Places), e navegar no Admin
exercita SSR do Next; juntos estouram o teto. O primeiro (05:59) é anterior a qualquer mudança de
código desta sessão — não é vazamento introduzido, é ausência de folga.

Duas medidas, e o que cada uma resolve:

- **Aplicado**: teto de heap V8 nos dois processos Node (`NODE_OPTIONS=--max-old-space-size`, 200 MiB
  para o Next e 128 MiB para o runner, em `deploy/supervisord.conf`). O V8 dimensiona o heap pela RAM
  do HOST, não pelo limite do cgroup — sem teto, cada Node cresce sem motivo até o kernel matar o
  container inteiro. Com teto, no pior caso cai UM processo (o supervisord o reinicia) em vez de todos.
  Isto **não** foi suficiente sozinho: houve OOM com os tetos no ar, porque parte do consumo está fora
  do old space (Buffers, nativo, Python).
- **Pendente (decisão de custo do usuário)**: subir a instância para `standard` (2 GB, $25/mês). Com
  regime de 370-378 MB em 512 MB e picos acima disso, **não há folga para 4 processos** — a alternativa
  seria separar o runner de jobs em outro serviço, que custa mais que o upgrade.

### Imagens dos cards (400 vs 404) — NÃO é bug
Os erros de imagem no console têm dois significados distintos e ambos são o comportamento correto:
- **400** = domínio do site **não resolve** (link morto). O guard SSRF (`_is_blocked_host`) bloqueia host que não resolve ("não dá para validar → bloqueia") e a rota converte em 400. Confirmado: `ipponsushi.com.br` não tem registro A. **Isto é sinal de qualidade de dado do acervo** (websites mortos vindos do scraping OSM/Overture), não defeito.
- **404** = site vivo, sem `og:image` aproveitável. Confirmado: `mcdonalds.com.br` resolve e devolve 404.
- O cache negativo (Cache Storage `og-images-v2`) já persiste as duas respostas, e distingue definitivo (400/404) de erro de rede — então não há re-requisição infinita.
- [ ] **Follow-up medido (não alterado):** quando o endpoint por entity falha, `_resolveEntityImage` cai no caminho legado `og-image?url=…` **mesmo o servidor já tendo tentado a mesma URL internamente**, gerando 2 requisições e 2 buscas server-side (download da página + Places) por card. O fallback é legítimo quando a entidade ainda não existe no servidor com a URL atualizada do curador; o ganho está em não repetir quando as fontes são idênticas. Mexer nisso muda comportamento de render — medir hit-rate do fallback antes.

### Infra
- [ ] CI do GitHub Actions removido (billing) — decidir se reativa
- [ ] Auto-deploy do Render não confiável — sempre verificar após push
- [x] ~~API parada em commit antigo~~ — RESOLVIDO em 2026-09-12: o serviço `Concierge-Collector` (API) estava live em `077c1633` (01/09) enquanto `main` já tinha ~180 commits; o auto-deploy existe mas não pega. Deploy manual disparado via API do Render: `b545626a` subiu em 77s, `/api/v3/ready` com 31 índices e 0 falhas, zero 5xx. **Lição: `Concierge-Collector-Web` (static) estava atualizado e a API não — verificar os DOIS depois de cada push, eles divergem.**
- [x] ~~Admin/Worker em serviços separados~~ — **DESMONTADOS em 2026-09-12, por decisão de custo.** Criados como 2 serviços pagos (`Concierge-Collector-Admin` + `-Admin-Worker`) e no mesmo dia fundidos no serviço da API: 3 instâncias pagas para um sistema sem clientes não se justificava. Agora o web service da API roda **três processos em um container** (nginx roteia a porta única):
  ```
  /api/v3, /capture, /            -> uvicorn (FastAPI)
  /admin, /_next, /api/<não-v3>   -> next    (Payload)
  jobs:run (sem porta)            -> payload jobs: filas + agendamentos
  ```
  `Dockerfile` na raiz + `deploy/{nginx.conf.template,supervisord.conf,entrypoint.sh}`. `Dockerfile.admin` foi removido. Os dois serviços antigos e o domínio `admin.*` foram deletados do Render; **resta 1 web service pago** (`starter`) + o static site (free).
  - Ganho colateral: **o DNS deixou de ser bloqueio** — não existe mais `admin.concierge-collector.com`, o Collector fala com `https://api.concierge-collector.com/api/admin/v1/...` (host que já tinha TLS e CORS).
  - Verificado após a fusão: `/api/v3/health`, `/api/v3/ready`, `/api/v3/docs`, `/capture/`, `/admin`, `/health`, `/ready` todos 200; `/api/admin/v1/collections` → 401 `authentication_required` (gate ativo, não 503); smoke da API **zero 5xx**; heartbeat do runner a cada 1min e jobs novos (`reconcile-leases`, `sync-consumer-usage`) sem erro dentro do container.
  - ⚠️ **Duas opções do nginx existem para não perder/corromper dado:** `proxy_buffering off` em `/api/v3` (a API faz streaming — NDJSON de export e proxy de fotos; bufferizar transforma stream em memória) e `client_max_body_size 100m` (IA recebe áudio/imagem em base64; o default de 1m recusaria).
  - ⚠️ O runner de jobs é processo próprio, **não** `jobs.autoRun`: `jobs:run --handle-schedules` também CRIA os agendados (heartbeat, reconciliação, retenção); `autoRun` só drena filas, então trocar pararia os agendados em silêncio.
  - ⚠️ Com 1 instância o runner não duplica; se o serviço escalar para N instâncias, os jobs passam a rodar N vezes (as leases do Payload protegem a correção, mas o custo de execução multiplica). Revisitar antes de escalar horizontalmente.
- [x] ~~Migrations do Payload pendentes~~ — 11/11 APLICADAS em 2026-09-12 (banco novo). Três bloqueios reais apareceram e foram corrigidos:
  1. `Module not found: '@concierge/fastapi-client'` — o `dist` do client é gerado e cai no `.dockerignore`; a imagem nunca o gerava. Corrigido com `npm run generate && npm run build` do workspace `fastapi-client` antes do build do admin.
  2. `next start --hostname 0.0.0.0 10000` → `Invalid project directory` — `npm run start:admin -- --port N` não repassa a flag (o script interno é outro `npm run`, sem `--`). Agora `next` lê `PORT` do ambiente.
  3. `Index already exists with a different name: slug_1` — o `autoIndex` do Mongoose (default true) criava os nomes padrão (`slug_1`), enquanto as migrations usam nomes explícitos (`collections_slug_unique`). Corrigido com `connectOptions.autoIndex: false` — migrations passam a ser donas exclusivas dos índices. **Atenção: `collectionsSchemaOptions` NÃO serve para isso (é indexado por slug de coleção).**
- [x] ~~`admin.concierge-collector.com` sem DNS~~ — **deixou de existir**: com o Admin dentro do serviço da API, não há subdomínio a criar. Nenhuma ação de DNS pendente.
- [ ] **Privacidade de env vars na API do Render**: `GET /services/{id}/env-vars` **pagina em 20 por padrão**. Ler sem `?limit=100` trunca e um merge read-modify-write do conjunto inteiro apagaria as demais — foi o que quase me fez concluir (errado) que 7 variáveis de produção haviam sumido. Escrever sempre por chave (`PUT /env-vars/{key}`), que é aditivo.
- [x] ~~7 feature flags `default: false` em production~~ — TODAS LIGADAS em 2026-09-12, na ordem do runbook, com verificação a cada passo. Cada uma foi confirmada abrindo o gate (503 `feature_disabled` → 401/404 real):
  - API: `CMS_AUTH_ENABLED`, `CATALOG_SCAN_ENABLED`, `COLLECTOR_ASSOCIATION_READ_ENABLED`, `COLLECTIONS_DISTRIBUTION_ENABLED`
  - Mesmo serviço, lidas pelo processo Next: `COLLECTIONS_ADMIN_ENABLED`, `COLLECTOR_DRAFT_MUTATION_ENABLED`, `CONSUMER_CREDENTIALS_ENABLED`
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

## Admin editorial — plano de 2026-09-14

Status completo, verificação executada e defeitos encontrados: `docs/reviews/2026-09-14-editorial-admin-universal-record-access.md`.
Entregue: Fase 0 (field registry/inspector/editors), Fase 1 (`/admin/curations` + `/admin/curations/<id>`), Fase 2 (`/admin/entities` + detalhe), Fase 3 (paleta ⌘K + busca avançada por campo/operador/valor), Fase 4 (members e draft diff humanizados, preview a partir da Collection, card de relationships), Fase 9 (Content Health no `/admin`) e a fronteira `records/*` (18 paths no contrato). `/admin/explorer` virou redirect de compatibilidade.

- [ ] **`draftSelectedCount` não é mantido em operações `mode: 'explicit'`** — `src/operations/apply-draft-operation.ts` incrementa o contador só no caminho `selection`; um "add" explícito commita a mudança (item `applied`, `draftRevision` sobe) mas o header continua dizendo "0 selected". Medido nos dois modos no stack local: a operação `selection` mostrou "1 selected", a `explicit` não. Fix correto precisa do delta de mudanças (re-add de membro existente não incrementa). Descoberto ao rodar o E2E `collections/admin-ui.spec.ts` (falha na linha 111); caminho não tocado pelo plano editorial.
- [ ] **Integração do admin com Mongo local: 4 falhas pré-existentes** (`publish-concurrency.int.test.ts` ×2, `selection-manifest.int.test.ts` ×2). Medido contra um worktree limpo em HEAD: falha igual, não é regressão do plano.
- [ ] **`verify:full` não foi rodado ponta a ponta** neste trabalho; os specs relevantes rodaram isolados (`curations/keyboard.spec.ts` ✓ antes da onda 3; `collections/admin-ui.spec.ts` ✗ pelo item acima).
- [ ] Admin: mídia — thumbnails/originais precisam de uma fronteira que sirva mídia; hoje a seção Media & sources mostra só o que está armazenado (não inventa URL).
- [ ] Admin: reatribuição de curador precisa de um endpoint de diretório de usuários; hoje `curator_id` é read-only com essa razão explícita.
- [ ] Admin: coluna "Collections" na lista de Entities e o filtro "sem Collections" na lista de Curations precisam do join de membership do CMS exposto como consulta de lista (o contador do dashboard já existe via `POST /catalog/content-health`).
- [ ] Admin: diff de versões no History precisa de snapshots — não existem para Curation; a tela diz isso. O lado de Collections tem versões e o draft diff já é humanizado.

## Qualificação em produção — 2026-09-16

Sessão de validação com o **modo de acesso de operação** (sem Google), criado para isto: o Collector e
o Admin só aceitavam sessão nascida do OAuth, o que tornava impossível qualificar jornada em produção
sem uma conta Google humana no browser. `POST /api/v3/auth/ops-login` substitui a PROVA de identidade e
nunca a autorização (o sujeito precisa já existir `authorized` + `role: admin`); variáveis, properties
de fail-closed e as duas formas de consumo (fragmento para o Collector, cookies para o handoff do
Admin) estão no `CLAUDE.md`. Nada no cliente mudou para isso funcionar.

**Jornadas exercitadas em produção (com o observável):**

| Superfície | Jornada | Evidência |
|---|---|---|
| Admin | handoff completo (sem Google) → dashboard | `cms_session` no browser, `/admin` 200, **zero erro de console e zero resposta ≥400** |
| Admin | lista de Curations, busca (`q=sushi`), filtro por status, ordenação (6 modos + teto `limit=500`), paginação | contagem e nomes conferem com o banco (`status=linked` → 1 linha, que é o que existe) |
| Admin | detalhe de Curation e de Entity, paleta ⌘K (busca → clique → navega) | h1 correto, 10 resultados para "Adega", navegação para `/admin/entities/<id>` |
| Admin | Collections: criar → metadados → operações de draft (add/remove) → preview → delete | `POST 201`, worker commitou (`draftSelectedCount 0→2`, `draftState clean→dirty`), `PATCH 200` (revisão 1→2), `DELETE 204`, CMS de volta a **0 collections** |
| Admin | guards de publish/archive **sem** mudar estado | 400 sem idempotência, 412 sem `If-Match`, 400 com confirmação inválida, archive de draft → 409 (regra: só de `published`) |
| Admin | Content Health, Operations, Applications, Consumer Credentials, Cms Users | 200, sem erro; contadores batem com o banco (1.053 = 1.052 drafts + 1 linked, excluindo 4 deletadas) |
| Collector | sessão, shell, lista (1–30 de 1.053, 36 páginas), busca (persiste entre reloads), filtros+chips, sheet de filtros, entidades (632), detalhe com hero/mapa/contato, modal de Collections | contadores e conteúdo corretos; swipe-to-dismiss funciona (gesto no `.bottom-sheet-handle`) |
| Collector | criar Curation (Manual Entry) → aparece no Admin → editar no Admin → apagar no Collector | `POST /curations/bulk 200`, visível no Admin, `PATCH` do BFF 200 (versão 1→2), soft-delete propagado (`PATCH` 06:51:50) |
| Collector | shell offline (service worker), Places (`/places/nearby 200`), app de captura | SW controlando, navegação offline renderiza o shell |

**Defeitos de produção corrigidos nesta sessão** (cada um com causa medida, não suposta):
`CATALOG_CURSOR_SECRET` ausente → 503 na lista do Admin; 1.057 curadorias sem `catalog_sequence` →
lista vazia em qualquer filtro (backfill + guard nos dois caminhos + testes); **sort do Admin ordenando
em memória** → `OperationFailure: Sort exceeded memory limit` → 503 + lista vazia (índices que casam o
desempate real + `allowDiskUse` + teste de contrato); **"Browse" do app de captura** apontando para
`/app/` → 404 nas duas origens; **OOM do container** (ver a seção de memória acima).

- [ ] **Ciclo de vida de credencial de consumidor não foi validado em produção** (issue/rotate/revoke).
  Motivo: não existe DELETE de Application, então validar aqui deixa um aplicativo órfão no workspace do
  usuário. Coberto no gate local (`credentials/lifecycle.spec.ts`, roda no `verify:full`). As superfícies
  de leitura foram validadas (0 aplicações, 0 credenciais, empty state correto).
- [ ] **Publish de Collection não foi exercitado em produção** — é porta de mão única: `DELETE` só
  existe para nunca-publicada, então o teste deixaria uma coleção arquivada permanente no workspace que
  hoje tem ZERO coleções. Os *guards* foram validados em produção (400/412/409, sem mudança de estado) e
  o caminho feliz roda no gate local (`publish.spec.ts`). Quem quiser fechar isso: publicar uma coleção
  descartável ciente do resíduo, ou aceitar a cobertura local.
- [ ] **Jornadas que exigem hardware/pago não são exercitáveis headless**: gravação por microfone,
  transcrição (Whisper) e extração de conceitos (IA), upload do app de captura. O que dá para validar sem
  elas foi validado (painel de credencial, fila, botões, estado da sessão). O caminho de escrita da IA é
  o único trecho do fluxo de captura sem prova em produção.
- [ ] **"Export All Data" do Collector** não produz download observável em browser headless — é caminho
  client-side (dump do IndexedDB), não uma jornada de servidor; não foi possível confirmar por observável.
- [ ] **`draftSelectedCount` em operação `mode: 'explicit'`**: o item abaixo (contador só incrementava no
  caminho `selection`) **não se reproduz no banco** — medido em produção em 2026-09-16, um add explícito
  levou o campo de 0 para 2. Falta reconferir o *header* da UI, que é o sintoma que o item descreve.
- [x] ~~Teste vermelho escondido em `test_ai_orchestrate.py`~~ ✓ — corrigido. A causa não era ordem
  entre arquivos: `async_client` só troca o **banco**, então os testes async desse arquivo resolviam o
  orquestrador REAL e o resultado dependia do ambiente (chave/quota/rede) — daí passar isolado e devolver
  500 na suíte. Um fixture autouse no arquivo instala o mesmo stub que o fixture `client` do conftest já
  usava; o que os testes medem passa a ser o endpoint (async/await, auth, validação). Suíte completa:
  **675 passed, 0 failed** (era 674 + 1 falha).

## Cadência

- Commitar + pushar **de tempos em tempos** durante sessões longas (a cada ~30 min com mudanças não commitadas) — sessão atual usa lembrete recorrente
- Após cada push em `main`: verificar deploy dos 2 serviços do Render (auto-deploy existe mas não é confiável)
