# Revisão de Endpoints da API (2026-08-15)

Inventário das ~40 rotas em 14 routers (`concierge-api-v3/app/api/`), cruzado com o uso do frontend (`scripts/`, `capture/`) e consumidores externos (MCP `mcp-server.py`, clientes OpenAI-compat).

## Duplicações / pontos de atenção

| Item | Detalhe | Ação sugerida |
|---|---|---|
| `/health` × 5 | system.py, ai.py (`/health` + `/health/original`), places.py, places_orchestrate.py, llm_gateway.py | Manter `system/health` como canônico; remover `health/original` (0 usos); os demais viram alias ou somem |
| ~~`/orchestrate` × 2~~ | ai.py (/ai/orchestrate — extração audio+conceitos) e places.py (/places/orchestrate — busca Places) | ~~Consolidar~~ — são funcionalidades DISTINTAS; places_orchestrate.py movido pro places.py (ago/2026) |
| Routers Places duplicados | `places.py` (nearby/details) + `places_router.py` (photo, photos) | ~~Mesclar~~ — CONSOLIDADOS em ago/2026 (places_router.py removido; rotas preservadas) |
| `db.sync_queue` (typo) | databaseDiagnostics — corrigido em ago/2026 | ✓ |

## Rotas sem uso no frontend (consumidor externo ou morta?)

| Rota | Uso frontend | Consumidor provável |
|---|---|---|
| `POST /ai/usage-stats` | 0 | ~~morta~~ — REMOVIDA em ago/2026 (rota + service method + teste) |
| `GET /ai/health/original` | 0 | ~~legado~~ — REMOVIDA em ago/2026 |
| `POST /llm_gateway/search-restaurants`, `get-restaurant-snapshot`, `get-restaurant-availability` | 0 | MCP server (`mcp-server.py`) |
| `GET /llm_gateway/tools`, `tools-manifest` | 0 | MCP |
| `GET /openai_compat/v1/models`, `v1/functions` | 0 | clientes OpenAI-compat |
| `POST /openai_compat/v1/chat/completions` | 1 (teste) | clientes OpenAI-compat |
| `GET /places/photo` | 0 (URL dinâmica) | `<img>` sem auth (rate limit 60/min) — build_photo_url |
| `GET /places/{place_id}/photos` | 0 (URL dinâmica) | PlacesAutomation/orchestrator |

## Rotas com uso real

- `POST /ai/orchestrate`, `extract-restaurant-name` — fluxo de captura
- `GET /auth/google|c|verify`, `POST /auth/refresh|logout`, `GET /auth/dev-login` — OAuth local
- `POST /capture`, `POST /capture/{id}/confirm` — app capture
- `GET /concepts`, `/{entity_type}` — conceitos
- `GET /curations/search|cities|entities/{id}/curations`, `POST /curations/semantic-search|hybrid-search|bulk` — aba curations
- `GET|POST /entities`, `/{entity_id}`, `PATCH|DELETE /{entity_id}`, `POST /entities/bulk` — aba entities/sync
- `GET /curators` — perfil
- `GET /places/nearby`, `details/{place_id}` — busca Places
- `GET /og-image` — véu dos cards
- `GET /system/health|info` — health check do Render

## Pendências de ação (ver docs/PENDENCIAS_MELHORIAS.md)

- [x] ~~Confirmar `usage-stats` morta → remover~~ ✓
- [x] ~~Remover `health/original`~~ ✓
- [x] ~~Consolidar routers places + places_orchestrate~~ ✓
- [x] ~~Remover healths duplicados sem consumidor~~ ✓ (ai/health, places/health, places_orchestrate/health removidos; system/health canônico + llm_gateway/health mantidos)
