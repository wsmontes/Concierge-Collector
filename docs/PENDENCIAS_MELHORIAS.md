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
- [ ] `dbg.tmp.mjs` na raiz (resto de debug do IndexedDB) — apagar
- [ ] Curadorias órfãs (53 no Mongo, ids `entity_curation_test_*`): review card sem véu — decidir: limpar lixo ou resolver por nome via EntityBrowser
- [ ] Degraded mode: tela de erro usa cinzas antigos; fluxo sem IndexedDB merece passe visual

### Backend API
- [x] ~~**Revisão sistemática dos endpoints**~~ — FEITA: docs/API_ENDPOINT_REVIEW.md (inventário + uso + remoções + consolidações)
- [x] ~~Routers `places.py` + `places_router.py` + `places_orchestrate.py`~~ — CONSOLIDADOS (rotas preservadas; healths duplicados sem consumidor removidos; rotas mortas usage-stats/health-original removidas — ver docs/API_ENDPOINT_REVIEW.md)
- [x] ~~Endpoints sem uso real~~ — mapeados no review (consumidores frontend/MCP/OpenAI identificados)

### Auth/Segurança
- [ ] OAuth: cookie HttpOnly para tokens (pendência da auditoria) — hoje o access token vive em localStorage
- [ ] Rotação do client id/secret OAuth vazados em docs (usuário adiou — cobrar de novo)

### Sync/Offline
- [ ] Pull de entities vinculadas depende de curations locais; aba server-driven resolvia por fora — monitorar consistência

### Dados
- [ ] Junk de teste no banco: `entity_curation_test_*` (entities + curations) — limpar via `scripts/python-tools/data_cleanup.py` (destrutivo: confirmar antes)

### Infra
- [ ] CI do GitHub Actions removido (billing) — decidir se reativa
- [ ] Auto-deploy do Render não confiável — sempre verificar após push

## Melhorias

### Feedmine (estudo: `docs/UI/FEEDMINE_DESIGN_STUDY.md`)
- [x] ~~**Prefetch da próxima página**~~ ✓ — peekPage() não-mutante nos browsers + pré-resolução 1,5s após a página enfileirar (dedupe por página); validação real sem corromper paginação
- [ ] Swipe actions mobile nos cards (gestureManager já existe em ui-core)
- [ ] Badges de tipo no fallback com mais distinção (novo/vídeo-equivalente)
- [ ] Avaliar OKLCH para novas escalas (só em componentes novos — tema atual é curado)

### og-image (véu)
- [x] ~~Negative cache com backoff~~ ✓ — miss re-tenta em 10min (hit 1h), teste de TTL com monotonic mockado
- [ ] Métricas de cobertura por fonte (og vs places vs corpo) — dashboard de "quantos cards têm véu"
- [ ] Cache Storage: eviction explícito por LRU (hoje o browser decide)

### API
- [ ] Endpoint agregado por entity (`/entities/{id}/image`) que encapsula og+places — hoje o frontend monta a consulta
- [ ] Docs OpenAPI com exemplos dos endpoints novos (og-image)

### UX
- [ ] Datas relativas nos demais lugares com timestamp (sync activity)
- [ ] Empty states tipados por seção (emptyStateManager com ícone por contexto — padrão feedmine)

## Cadência

- Commitar + pushar **de tempos em tempos** durante sessões longas (a cada ~30 min com mudanças não commitadas) — sessão atual usa lembrete recorrente
- Após cada push em `main`: verificar deploy dos 2 serviços do Render (auto-deploy existe mas não é confiável)
