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

**Vetor de payload medido e descartado como causa** (2026-09-16): `_ADMIN_ROW_PROJECTION` inclui
`transcript`, e o único uso do campo na listagem é calcular `has_transcript` (um booleano) —
`catalog_service.py:62` e `:139`. Medido no acervo de produção: média de **4,3 KB por linha**, ou seja
**~2 MB por página de 500 linhas**, por request, de IO e alocação transitória. É desperdício real, mas
**não é o vetor do OOM**: 2 MB é ~0,4% de um container de 512 MB, contra os ~50-100 MB por página de SSR
do Next (que é o que domina, e é o que satura quando duas páginas do Admin carregam juntas). Fica como melhoria de IO/latência,
**não** como correção de memória — quem for fazer, meça a latência antes/depois, não a memória.

Duas armadilhas medidas para quem implementar (verificadas no código, 2026-09-16):

1. **`$strLenCP` estoura em documento sem transcrição** — a maioria do acervo é `null`/ausente, e a
   agregação inteira falha (500 na lista). Precisa de guarda de tipo:
   `{"has_transcript": {"$gt": [{"$strLenCP": {"$cond": [{"$isString": "$transcript"}, "$transcript", ""]}}, 0]}}`.
2. **O duble dos unitários não avalia expressão** — `InMemoryCollection._project` (conftest.py:155) trata
   QUALQUER valor truthy como "incluir esta chave", então uma projeção com expressão é lida como inclusão
   simples, o campo sai ausente e o `admin_curation_row` cai no fallback `False`: a suíte unitária passa
   verde com o comportamento errado. E o `aggregate` do fake só implementa `$match`/`$group`/`$count`/
   `$facet` — trocar `find` por agregação devolve página vazia e quebra tudo. A validação tem de ser
   contra Mongo real (`verify:full`: API integration + Mongo integration), não no unitário.

**Investigação com medição real (2026-09-16, API de métricas do Render).** As tentativas anteriores
liam eventos; agora há série de memória por minuto. Endpoint correto (o path leva o NOME da métrica, não o
id do serviço): `GET /v1/metrics/memory?resource=<serviceId>&startTime=&endTime=` — devolve
`{unit: bytes, values: [{timestamp, value}]}` (e a resposta pode vir como LISTA de séries, uma por
instância ✓). Mesma coisa para `cpu`.

14 horas de série, regime por hora (min/max, MB):

| hora (UTC) | 05 | 06 | 07 | 08 | 09 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **min** | 404 | 2 | 3 | 445 | 445 | 447 | 448 | 442 | 450 | 399 | 397 | 288 | 3 | 411 | 3 |
| **max** | 406 | 500 | 479 | 451 | 447 | 448 | 449 | 450 | 451 | 452 | 400 | 474 | 452 | 415 | 434 |

**Atenção à resolução (importante para não descartar o achado):** a série entrega **~1 amostra por
minuto** (60 pontos por hora ✓). O kernel mata pelo valor **instantâneo**, não pela média do minuto — então
o máximo por hora aparecer em 474 MB (< 512) nas horas de OOM é ESPERADO e não significa que o container
morreu abaixo do limite: o pico entre duas amostras é invisível aqui. Este endpoint serve para ver regime e
tendência (vazamento × orçamento), **não** para medir o pico real.

**Conclusão: não é vazamento.** Das 08h às 13h (sem tráfego, sem deploy) a memória ficou **plana** em
445-451 MB — não subiu. E a CPU está ociosa (pico 0.01-0.22 de 0.5 núcleo, e só nas horas de OOM). O
container simplesmente vive a **~88% de 512 MB** e tem **~61 MB de folga**: qualquer rajada maior que isso
mata. Os `min = 2-3 MB` são os minutos de reinício.

Carga controlada para separar "caminho específico" de "orçamento": UMA navegação completa da lista do
Collector (30 cards, ~30 requisições de imagem) levou o container de 397 → 397 MB, **sem OOM**. Ou seja,
o gatilho são rajadas pontuais — Next SSR de uma página do Admin, pipelines de imagem simultâneos, jobs
agendados — contra folga pequena.

Alavancas NOSSAS, aplicadas (medidas no código, não estimadas):

- `OG_BYTES_CACHE_MAX_ENTRIES` 300 → **100**: `_og_bytes_cache` guarda **bytes de JPEG** (50-200 KB cada),
  então 300 entradas podiam ser ~60 MB residentes (`og_image_service.py:159`). O navegador já persiste a
  imagem para sempre no Cache Storage, então o cache do servidor não precisa ser generoso.
- `COLLECTOR_MAX_CONCURRENCY` 4 → **2**: cada download concorrente segura o HTML da página (até
  `MAX_HTML_BYTES` = 400 KB) mais o custo do parse; o pico transitório é o que cruza a folga.

**Isto devolve parte da folga, não cria folga.** Com regime de ~450 MB, a correção robusta continua sendo
mais memória (`standard`, 2 GB) ou menos processos no mesmo container — decisão de custo do usuário.
Ordem de grandeza dos quatro processos: Next ~200 MB, runner de jobs ~150 MB, uvicorn ~100 MB, nginx ~10 MB.

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

- [x] ~~**`draftSelectedCount` não é mantido em operações `mode: 'explicit'`**~~ ✓ — **não se reproduz em produção**
  (2026-09-16, medido no banco, não na UI): um add `explicit` levou o campo de 0 para 2 num collection de
  validação (`draftRevision 0→1`, `draftState clean→dirty`), e o caminho de `selection` — pela UI real,
  "selecionar 1 → Apply to Collections… → confirmar" — commitou `{"mode":"selection","action":"add",
  "selectedCount":1,"status":"committed"}` e deixou `draftSelectedCount: 1`. O contador é mantido nos dois
  modos; se o sintoma reaparecer, é do *header* (refresh), não do delta.
- [ ] **Integração do admin com Mongo local: 4 falhas pré-existentes** (`publish-concurrency.int.test.ts` ×2, `selection-manifest.int.test.ts` ×2). Medido contra um worktree limpo em HEAD: falha igual, não é regressão do plano.
- [ ] **`verify:full` continua não rodado ponta a ponta** — e desde 2026-09-16 isso pesa mais: o trabalho de design mexeu em escala, raios, espaçamento e breakpoints, e só o Playwright olha essas mudanças num browser real. É o único gate que falta para qualificar o lote visual.
- [x] ~~Admin: mídia~~ — a fronteira existe: `/records/entities/:id/image` (byte proxy com a service key no servidor) e a galeria por rank. Desde 2026-09-16 a lista de Entities e o detalhe a consomem, com o `private, max-age` do FastAPI preservado e thumbnail que não resolve saindo do DOM.
- [x] ~~Admin: diretório de curadores~~ — `payload/endpoints/curators.ts` + `CuratorPickerField` entregues.
- [x] ~~Admin: coluna Collections + filtro sem Collections~~ — entregues (`collection-reads.ts`; verificados na tela).
- [ ] Admin: diff de versões no History precisa de snapshots — não existem para Curation; a tela diz isso. O lado de Collections tem versões e o draft diff já é humanizado.

## UX/UI do Collector — passe de 2026-09-16

**1. Razão de aspecto dos cards (corrigido, medido).** O sintoma (a mesma página com proporções
diferentes por linha) não era a imagem: o `<img>` já é `position:absolute` + `object-fit: cover`. Era a
CAIXA — `.collection-card__media` tinha `flex-basis` fixo com `align-self: stretch` e `min-height`, sem
`aspect-ratio`, então a altura vinha do conteúdo de cada card (medido com `getBoundingClientRect` em 30
cards: **150x190, 150x206 e 150x208** na mesma tela). Agora `align-self: flex-start` +
`aspect-ratio: 3/4`: medido depois, **150x200 em todas as linhas** (110x147 no mobile), nas duas abas
(Curations e Entities usam o mesmo componente). A imagem se enquadra na caixa, nunca o contrário.

**2. Imagem re-buscada a cada load (corrigido, medido).** Contador de requisições com cache limpo:
**18 na 1ª carga e 24/12 nos reloads seguintes** — cada uma refazendo no servidor o pipeline inteiro
(download da página + Places). Três causas, todas no `ogImageModule`:

- o caminho legado tratava o negativo no ramo `!response.ok`, que é **inalcançável** (`ApiService.request`
  lança em 4xx/5xx): um 404 do `og-image` nunca era persistido e era re-perguntado em todo load;
- falha transitória (rede/timeout/5xx) não era memorizada de propósito, o que significava repetir a busca
  em cima dos MESMOS cards a cada reload numa conexão ruim;
- negativo definitivo era **eterno** (sem validade), então um card sem imagem não se curava sozinho.

Agora: `catch` trata o status (definitivo → negativo), falha transitória memoriza **10 min e só online**
(offline não é "sem foto"), e o negativo definitivo tem **TTL de 7 dias** (mantém o ganho de não
re-perguntar e deixa o card se curar).
*NOTA (2026-09-16, retune posterior):* os dois valores acima foram encurtados — 7 dias de negativo
definitivo faziam uma resposta velha do servidor parecer "este restaurante não tem foto" por dias, e
10 min de transitório faziam um container reiniciando parecer a mesma coisa. Hoje: **30 min** para
404/400 e **60 s** para rede/timeout/5xx, cada um limitado pelo `max-age` que o servidor manda junto da
resposta (`max-age=60` no 404 de hero ainda resolvendo, `max-age=3600` quando a Entity não tem fonte —
não sobrescrever o menor com o maior). O positivo (imagem) segue sem TTL. Ver `ogImageModule.js`
(`_definitiveNoImageTtlMs`, `_transientNegativeTtlMs`, `_boundedNegativeTtlMs`).
O prefetch passou a usar o MESMO rank do card (antes aquecia
`rank:0` e o card com hero curado pagava a rede inteira — e a hero default era gravada sob a chave do
hero escolhido). O delete de entrada vencida usava a chave lógica, que não é `Request` válida para o
Cache API: falhava em silêncio. Medido depois: **4 requisições por reload** (contra 24/12) e o cache
estabiliza em 20 entradas em vez de crescer re-buscando.

Efeito colateral bem-vindo: cada re-fetch evitado é um pipeline `download + Places` que o servidor não
roda — o mesmo pipeline que aparece na conta de memória do container.

**Achados de captura de imagem (medidos, NÃO alterados — é decisão de produto):**

- A foto que o curador tira **nunca é enviada ao servidor**: o único request com imagem é
  `/ai/orchestrate` (análise). A Curation guarda só o marcador `sources.image=[{created_at}]`
  (`sourceUtils.js:156`), e o card SEMPRE mostra a hero da web — ou seja, a foto existe em um lugar só
  (o navegador de quem capturou) e o detalhe da Curation tenta renderizar `sources.image` que nunca vem
  preenchido (`uiManager.js:2687-2690`). Ou seja: capturar foto hoje é alimentar a IA e nada mais.
- A foto é guardada em **tamanho cheio** em base64 no draft (`draftRestaurants.metadata`, sem resize —
  `resizeImageForAPI` só existe para a chamada de IA). Medido: um JPEG de 40 KB virou ~54 KB de metadata,
  e a quota local era de 10 GB com 18,8 MB usados — **não é problema prático**, então não mexi (mudar
  isso descartaria o original, e ele é a única cópia).
- `cleanupOldDrafts(30 dias)` poda só drafts **vazios** (`draftRestaurantManager.js:243-253`): um draft
  com foto fica para sempre — correto enquanto a foto não subir (é a única cópia), mas significa que
  captura abandonada acumula. Decisão de produto, não bug.

## Lote de padronização e performance — 2026-09-16 (parte 2)

Tudo abaixo foi **medido**, não estimado; quando a medição não sustentou a hipótese, a hipótese saiu.

### O que entrou

|Mudança|Antes → depois (medido)|
|---|---|
|Cache da mídia no BFF (`private, no-store` forçado sobre o `private, max-age` do FastAPI)|cada visita re-baixava cada thumbnail e re-executava o pipeline de fetch+reencode no upstream → preservado|
|Prefetch do Collector cancela → **adia**|carga fria: 236 req/0 fotos → **108 req/39 fotos**; com o rearme, 122 req/40 fotos e a página 2 aquecida depois|
|Escala compartilhada em px no Admin (root do Payload é 13px, `rem` dava 19% menor)|`--cms-text-sm` 11.375px → **14px**; `xs` 9.75 → **12px**; `radius-lg` 6.5 → **8px**|
|Raios: 82 literais → escala|0 literais; 10px (4 painéis) → `xl`, 7px (2 blocos internos) → `lg`|
|Espaçamento: 15+ valores ad-hoc em 415 declarações → escala por proximidade de pixel renderizado|desvio ≤1px; Collections 64 → **63px**; cartão mobile 178 → 181px|
|Lista de Collections no mobile (tabela rolava 396px de lado, 1 de 5 colunas visível)|cartões com rótulos: **396 → 0px** de rolagem lateral|
|Thumbnail da Entity na lista (virtualizada: linha fora da tela não pede imagem)|3 linhas → 3 requisições; 404 local → 0 molduras quebradas|
|CSS morto do Explorer (`curation-explorer*`, `explorer-filter-form*`)|131 linhas removidas (0 referências em tsx/ts)|

### Exceção de cache do BFF: o limite é `private`, e nada além

O `withAdmin` preserva a frescura declarada pelo handler **somente** dentro de `private`, e agora rejeita
também valor contraditório: `public` ou `s-maxage` junto de `private` é sobrescrito. `s-maxage` existe só
para cache compartilhado e `public` contradiz `private` — nenhum dos dois pode pegar carona na exceção e
levar uma resposta autenticada para um cache de proxy. 9 casos no arquivo dedicado
(`with-admin-cache-policy.test.ts`); sem a checagem de `private` falham 7, sem o aperto novo falham 2.

O elo de cima da cadeia também já está pinado por teste existente: `concierge-api-v3/tests/test_catalog_media.py`
afirma o `private, max-age={ENTITY_IMAGE_CACHE_TTL_SECONDS}` que `catalog_media.py:150` emite. Ou seja:
upstream emite `private` + wrapper preserva `private` — não é preciso curl em produção para provar.

### Thumbnail na lista de Entities: o limite medido

O `EntityTable` é virtualizado com altura **fixa** (`estimateSize: () => rowHeight`, sem `measureElement`),
então um filho maior que a linha desalinha a lista. Medido: a identidade (nome + `entity_id`) ocupa **41px**
e o thumbnail **34px** — a imagem é o filho **menor**, com `width/height` fixos no CSS. A linha de 48px não
cresce e não há reflow ao carregar.

O fan-out é limitado por três coisas: linha fora da tela é desmontada (virtualização), `loading="lazy"`
segura as montadas mas fora da viewport (o overscan), e o TTL no browser evita repetir. Medido: 3 linhas →
3 requisições. Se a pressão no container fusionado aumentar, a alternativa é um campo de thumbnail na
resposta de lista (uma chamada em lote) em vez de uma por linha.

### Hipóteses que a medição derrubou (não viraram mudança)

- **"Cadeia serial de chamadas no BFF"** — medido: 3-4 chamadas `/api/admin` por página, TTFB 162-309ms no dev.
  Não há cadeia para paralelizar.
- **"Projeção pesada (`transcript`) no registro"** — a tentativa de medir bytes por `resp.body()` voltou 0
  (a API não expõe o tamanho pelo evento) e não localizei nenhuma projeção incluindo `transcript` nos
  caminhos que o Admin lê. Sem evidência, retirado.
- **Latência da página em `next dev`** não serve como número de produto (Turbopack compila por rota).

### TODO push em `main` reinicia o container fusionado — inclusive doc

Medido em 2026-09-16/17 pela lista de deploys do serviço (12 entradas, todas com `branch: main`): cada push
dispara deploy, sem filtro de caminho. As entradas `canceled`/`deactivated` são a prova de que o push
seguinte **reinicia** o anterior, e entre elas está:

|Commit|O que mudou|Deploy|
|---|---|---|
|`3dd5306d`|só o Collector (JS do site)|Admin redeployou|
|`02c8a05e`|só documentação|Admin redeployou (cancelado pelo próximo)|
|`82b378d0`|só documentação|Admin redeployou|

Causa-raiz, lida do campo real do serviço (topo do JSON, **não** em `serviceDetails` — procurar lá devolve
ausência e parece "desligado"): `autoDeploy = yes`, `autoDeployTrigger = commit`, `branch = main`, sem
`buildFilter`. Todo commit em `main` deploya.

O Admin e a API vivem no MESMO container (nginx → Next em 127.0.0.1:3000), com boot de ~90s em produção.
**Mas o 502 NÃO é garantido a cada deploy** — as duas medições divergem e é isso que vale registrar:

|Observação|Resultado|
|---|---|
|Deploy de 2026-09-16 (~23:04)|`/admin/login` em 502 por ~90s (3 probes), depois 200 sem intervenção|
|Deploy de 2026-09-17 03:40 (`15b1fac0`), medido DURANTE o `update_in_progress`|`/admin/login` **200**|

Ou seja: o rollout normalmente mantém a instância antiga servindo enquanto a nova sobe; a janela de 502
aparece quando isso não acontece (aqui, sem causa isolada). O que **está** provado é o gatilho: deploys
frequentes e ilimitados, inclusive para `.md`.

Consequência prática (regra): **agrupe edições de doc com o próximo commit funcional**. O static site
também rebuilda a cada push, mas é atômico.

Conserto durável: `buildFilter` com `ignoredPaths` (`docs/**`, `*.md`) — settável pela API/dashboard do
Render. **NÃO** usar `autoDeployTrigger: checksPass`: o CI do GitHub foi removido por billing, e esse
gatilho espera checks do GitHub — sem checks, a produção pode congelar no último commit para sempre. É
configuração de produção: decisão do usuário, não do agente.

### Flake conhecido (não investigado até o fim)

`tests/unit/payload/security-config.test.ts > allows CSRF and CORS only from the Admin and explicit Collector origins`.

Placar em 2026-09-16: **2 falhas, 12 aprovações**. Duas hipóteses foram testadas e **derrubadas**:

|Hipótese|Teste|Resultado|
|---|---|---|
|Depende do env do gate (`withAdminTestEnv`, release-gate.mjs:29)|suíte completa com o env exato do gate, 2×|2 aprovações|
|Depende de pipe na saída (`npm run verify \| grep …`)|2 execuções do gate canalizadas|2 aprovações|

Também passou isolado 6/6, na suíte completa 5/5 e no gate redirecionado 3/3. Não há gatilho
estabelecido: é um flake de baixa frequência e sem causa conhecida. O teste faz `await import()` de
`payload.config` dentro do caso, então o suspeito é timing de I/O naquele import — mas isso é suspeita,
não diagnóstico. **Trate um gate vermelho nesse arquivo como rerun-antes-de-investigar, não como falha de
release.**

## Regra de trabalho — sobrescrever arquivo existente

Em 2026-09-16 eu sobrescrevi `apps/admin/tests/unit/http/with-admin.test.ts` com `write`, apagando 16
casos de teste que já existiam (a suíte caiu de 621 para 611 e eu só percebi porque comparei as duas
contagens). Restaurado do git e fundido com o bloco novo (627 = 621 + 6). **Antes de `write` num arquivo,
`read` primeiro** — a checagem que eu fiz (`grep` por `withAdmin` em `--include=*.test.ts*`) listou o
arquivo, mas eu li só o começo da saída e assumi que não existia.

## Design/UX do Admin — 2026-09-16

Trabalho em lotes medidos, com o Collector como superfície de referência. Entregue até aqui: escala
compartilhada no pacote de tokens (tipo/espaço/raio/sombra/semânticas), `next/font` com as três famílias
da marca no Admin, cores semânticas alinhadas (a rampa INTEIRA do Payload, não só o degrau 500), tamanhos
de fonte na escala (116 literais → 0; renderizados por página de 7-10 → 6) e moldura de página única
(era declarada 7× com 5 valores).

**Divergência de marca exposta e não resolvida (decisão de produto):** o pacote declara
`--cms-olive-500: #596f42` e o Collector usa `--color-primary: #5c6b4a` — dois verdes de marca com valores
diferentes. O Admin usa a rampa oliva em superfícies/elevações e `--cms-primary` (o valor do Collector)
onde a cor de marca aparece de fato. Alinhar as duas rampas é uma decisão explícita de identidade, não um
detalhe para empurrar pelo pacote.

**Ordem imposta por medição (não inverter):** a lista de Entities não tem thumbnail, e o BFF de imagem já
existe — mas cada thumbnail é um pipeline server-side pesado (download da página + Places) num container
que vive a ~88% de memória. Sequência: (1) parar o `no-store` do `withAdmin` sobre a rota de mídia, que
hoje mata o `max-age=300` e força re-download a cada visita; (2) lazy-load só das linhas visíveis;
(3) só então as thumbnails.

**Latência só se mede onde ela existe:** `next dev` (Turbopack) compila por rota na primeira visita e não
tem o SSR de produção, então qualquer número de página medido ali é distorcido e não serve. Para latência,
medir as rotas do FastAPI (mesmo código nos dois ambientes) ou o serviço fundido (`next start`).

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
| Admin | lista de Curations, busca (`q=sushi`), filtro por status, **as 8 ordenações** do allowlist + teto `limit=500`, paginação, busca avançada (`?where=...`) | as 8 respondem 200 com 100 itens e a 1ª linha muda certo por ordenação (`name_asc` → "1900 Pizzeria", `sequence_asc` → seq 1); contagem bate com o banco (`status=linked` → 1 linha, que é o que existe) |
| Admin | **seleção → "Apply to Collections…"** (a interação central do workspace, pela UI) | "1 Curation selected" → `POST /selections → 202` → worker commitou `{"mode":"selection","action":"add","selectedCount":1,"status":"committed"}`; a Collection de andaime ficou `draftSelectedCount: 1` e foi apagada (`DELETE 204`, lista final 0) |
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
