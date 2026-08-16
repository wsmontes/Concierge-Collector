# Pendências & Melhorias do Concierge Collector

Lista viva de áreas, pendências e melhorias — atualizada em 2026-08-15.
Fonte: memórias do projeto, auditoria de segurança, sessões de trabalho e estudo do feedmine.

## Áreas

1. **Frontend/UI** — Collector (raiz, tema concierge) + capture app (identidade-fonte)
2. **Backend API** — 13+ routers FastAPI em `app/api/` (revisão de endpoints pendente)
3. **Auth/Segurança** — JWT, OAuth Google, RBAC, SSRF, rate limits
4. **Sync/Offline** — sync bidirecional, IndexedDB, fila client-side
5. **Places/Google** — Places API (New), fotos, autocomplete
6. **Pipeline Python** — OSM/Overture/Michelin → merge → rich → import → curations draft
7. **Infra/Deploy** — Render (2 serviços), Atlas, deploy manual quando auto falha
8. **Testes/Qualidade** — vitest (569/10), pytest (205 unit), lint local (CI removido)

## Pendências

### Frontend/UI
- [x] ~~Cards "somem e voltam" a cada refresh do sync~~ — RESOLVIDO: renderCurationsPage fazia innerHTML='' ANTES da resolução async das entities (janela em branco no data-changed/sync-success); agora monta em fragment e troca atomicamente (replaceChildren) — lista antiga visível até a nova pronta. Validado com resolução atrasada 600ms: container nunca esvazia.
- [x] ~~Ruído de log: `Unhandled rejection: NotFoundError: objectStore not found`~~ — RESOLVIDO: hooks do DataStore disparavam `concierge:data-changed` SINCRONAMENTE dentro da transação (escopo travado); listeners liam outras tabelas → NotFoundError. Evento agora é deferido (setTimeout 0).
- [x] ~~Click no card de curadoria linkada não abria detalhes~~ — RESOLVIDO: regressão do renderCurationsPage (createCurationCard sem onClick — o default é console.log); agora abre handleViewReviewDetails como o review card.
- [x] ~~`dbg.tmp.mjs` na raiz (resto de debug do IndexedDB)~~ — RESOLVIDO: arquivo não existe mais no repo
- [ ] Curadorias órfãs (53 no Mongo, ids `entity_curation_test_*`): review card sem véu — decidir: limpar lixo ou resolver por nome via EntityBrowser
- [x] ~~Degraded mode: passe visual~~ ✓ — DOM audit no modo degradado (IndexedDB quebrado) mostra 100% do tema (limestone/oliva/tints remapeados); resquícios reais corrigidos: toast fatal usava #ef4444 → var(--color-error), e --color-danger não existia (7 usos caíam no vermelho velho) → alias criado. (O pixel-scan antigo dava falso positivo: tolerância ±10 confunde #fbf9f5 quente com #f9fafb frio.)

### Backend API
- [x] ~~**Revisão sistemática dos endpoints**~~ — FEITA: docs/API_ENDPOINT_REVIEW.md (inventário + uso + remoções + consolidações)
- [x] ~~Routers `places.py` + `places_router.py` + `places_orchestrate.py`~~ — CONSOLIDADOS (rotas preservadas; healths duplicados sem consumidor removidos; rotas mortas usage-stats/health-original removidas — ver docs/API_ENDPOINT_REVIEW.md)
- [x] ~~Endpoints sem uso real~~ — mapeados no review (consumidores frontend/MCP/OpenAI identificados)

### IA — CONCLUÍDO (ver docs/AI_MODERNIZATION_PLAN.md — 5 fases: modelos gpt-5.6, prompts com vocabulário forçado, validação+re-prompt, retries, pipeline DeepSeek)

### Auth/Segurança
- [x] ~~OAuth: cookie HttpOnly~~ ✓ (ADITIVO — o Bearer continua o caminho principal): access_token também flui via cookie HttpOnly (SameSite=lax, Secure em prod) definido no callback/refresh/dev-login e limpo no logout; verify_auth aceita o cookie como fallback; apiService manda credentials:include. Remover o localStorage fica pra próxima fase (quando a superfície 100% cookie for validada).
- [ ] Rotação do client id/secret OAuth vazados em docs (usuário adiou — cobrar de novo)

### Sync/Offline
- [x] ~~Pull de entities vinculadas / consistência~~ ✓ — aba server-driven resolve entities por fora (local chunked + API ids + persistência) desde o fix do renderCurationsPage

### Dados
- [ ] Junk de teste no banco: `entity_curation_test_*` (entities + curations) — limpar via `scripts/python-tools/data_cleanup.py` (destrutivo: confirmar antes)

### Infra
- [ ] CI do GitHub Actions removido (billing) — decidir se reativa
- [ ] Auto-deploy do Render não confiável — sempre verificar após push

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
- [ ] Endpoint agregado por entity (`/entities/{id}/image`) que encapsula og+places — hoje o frontend monta a consulta
- [ ] Docs OpenAPI com exemplos dos endpoints novos (og-image)

### UX
- [x] ~~Datas relativas nos demais lugares com timestamp (sync activity)~~ ✓ — formatter canônico em `uiUtils.formatRelativeDate` (Intl.RelativeTimeFormat cacheado, ~30 dias → absoluto); sync status mostra "Last sync: 2 hours ago" com absoluto no title; ConflictResolutionModal delega para a mesma implementação
- [x] ~~Empty states tipados por seção~~ ✓ — templates no-curations (rate_review), no-entities (storefront), no-curator (person_off) no emptyStateManager; 4 blocos inline do uiManager trocados pelos presets

## Cadência

- Commitar + pushar **de tempos em tempos** durante sessões longas (a cada ~30 min com mudanças não commitadas) — sessão atual usa lembrete recorrente
- Após cada push em `main`: verificar deploy dos 2 serviços do Render (auto-deploy existe mas não é confiável)
