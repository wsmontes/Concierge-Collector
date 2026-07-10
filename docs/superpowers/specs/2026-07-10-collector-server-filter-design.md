# Collector: filtro server-side paginado (city/type/status/curator/texto) — Design

**Data:** 2026-07-10
**Status:** aprovado (aguardando revisão da spec)
**Contexto:** continuação do Collector paginado (já em `main`). O browse já é server-backed paginado (visível + próxima página). Falta o **filtro** seguir a mesma regra — hoje é client-side e os filtros de `city`/`type` ficam vazios (regressão conhecida).

## Regra unificada (do usuário)

Tudo opera sobre uma **janela limitada = itens visíveis + próxima página (prefetch)**, igual ao cold start — browse, **filtro** e **sync**. Nunca o DB local inteiro.

- **Sync já respeita** (verificado): startup push-only em background; `pushEntities`/`pushCurations` consultam só pendentes via índice `sync.status`; os métodos que varriam o DB inteiro (`prune`/`collectLinked`) só rodavam no `pullLinkedEntities`, removido do startup. **Nenhuma mudança de sync neste plano.**
- **Filtro** passa a ser server-side paginado (este design).

## Decisões (do brainstorming)

- **Filtro = re-scope server-side paginado**: mudar filtro → `CurationBrowser.openScope({...})` → traz página visível + prefetch da próxima dos *resultados filtrados*. Substitui o filtro client-side.
- **Denormalizar `city`/`type` na curadoria na API (create/update) + backfill** das existentes. Fonte única: toda curadoria com `entity_id` ganha `city`/`type` da entity.
- **Campos de filtro (v1):** `city`, `type`, `status`, `curator`, e **texto** (`q` sobre `restaurant_name`).

## Achados que embasam o design

- `POST /curations` (`create_curation`) **já** faz `db.entities.find_one({"_id": curation.entity_id})` para validar a entity → a denormalização hooka ali sem custo extra. Também há o bulk (`POST /curations/bulk`) e o `PATCH /curations/{id}`.
- Entity tem `type` (top-level) e `data.location.city`. Curadorias hoje **não** têm `city`/`type` (0/1074).
- `GET /curations/search` monta um dict `query` do Mongo com `entity_id`/`curator.id`/`status`/`since`/`after_id`; adicionar `city`/`type`/`q` é aditivo. Cursor `after_id` preservado.

## Arquitetura / componentes

### 1. Backend — denormalização de `city`/`type` na curadoria
- Helper `denormalize_curation_location(entity: dict) -> dict` → `{"city": entity.data.location.city, "type": entity.type}` (valores ausentes → omitidos).
- **Create** (`create_curation`): a entity já é buscada; setar `doc["city"]`/`doc["type"]` a partir dela.
- **Bulk** (`bulk_upsert_curations`): para cada curation com `entity_id`, buscar a entity (ou reusar cache do batch) e setar city/type.
- **Update** (`update_curation`): se `entity_id` presente/mudou, re-derivar city/type.
- Campos são aditivos ao doc; o modelo `Curation` de resposta pode ignorá-los (não precisam ser retornados p/ o filtro funcionar).

### 2. Backend — filtros em `GET /curations/search`
- Novos params: `city: Optional[str]`, `type: Optional[str]`, `q: Optional[str]`.
- Query: `city` → match exato; `type` → match exato; `q` → `{"restaurant_name": {"$regex": re.escape(q), "$options": "i"}}` (escapar p/ evitar ReDoS; limitar tamanho). `status`/`curator_id` como hoje.
- Índices Mongo: `curation.city`, `curation.type` (e o já existente em `restaurant_name`, ou criar). Cursor `after_id` inalterado.

### 3. Data — backfill das curadorias existentes
- Script `scripts/python-tools/backfill_curation_location.py`: para cada curation com `entity_id` e sem `city`, buscar a entity, setar `city`/`type` via bulk update. Dry-run por padrão, `--apply`. Idempotente.

### 4. Frontend — `CurationBrowser` + UI de filtro
- `CurationBrowser.openScope({ curatorId, status, city, type, q })` e `_params()` passam `city`/`type`/`q` além de `curator_id`/`status`.
- `uiManager`: os handlers de filtro (city/type/status/curator/texto) passam a chamar `openScope(filtro)` + recarregar a **primeira página** (substitui a lista), em vez de filtrar client-side. "Load more" continua paginando **dentro do escopo filtrado**. Debounce no campo de texto.
- Remove o filtro client-side sobre `curationsCache` e o `populateCurationFilters` baseado em entity local; as opções de `city`/`type` podem vir de um endpoint de facets (fast-follow) ou de um conjunto fixo/derivado — no v1, um input de texto para city/type ou opções estáticas mínimas (ver Fora de escopo).

## Fluxos

- **Filtrar por cidade "São Paulo":** `openScope({city:"São Paulo"})` → `/curations/search?city=São Paulo&limit=25` (+ prefetch próxima) → renderiza. "Load more" → próxima página filtrada. Bounded, igual cold start.
- **Busca por texto "pizza":** `openScope({q:"pizza"})` → regex em `restaurant_name`.

## Fora de escopo (fast-follow)

- **Facets** (lista de cidades/tipos disponíveis para dropdown) — v1 pode usar input de texto para city ou opções mínimas; um endpoint de distinct/facets é fast-follow.
- Busca full-text avançada (índice de texto, fuzzy) — v1 usa regex simples.
- Filtro por valores de categoria.

## Compatibilidade / riscos

- Adicionar `city`/`type` ao doc é aditivo; consumidores atuais não quebram.
- `q` deve ser escapado (`re.escape`) e limitado em tamanho (ReDoS/performance).
- Backfill roda uma vez; novas curadorias já nascem com os campos via API.
- O `import_curations.py` cria via `POST /curations/bulk` → a denormalização no bulk cobre o pipeline de research automaticamente (sem mudar os scripts).
