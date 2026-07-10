# Collector: filtro server-side paginado — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filtro do browse do Collector server-side e paginado (city, type, status, curator, texto), seguindo a regra visível+próxima-página; com `city`/`type` denormalizados na curadoria (API + backfill).

**Architecture:** Backend denormaliza `city`/`type` na curadoria no create/bulk/update (helper puro), e `/curations/search` ganha filtros `city`/`type`/`q`; um script faz o backfill das existentes; no frontend o `CurationBrowser`/`uiManager` passam a filtrar via `openScope` paginado.

**Tech Stack:** FastAPI + pymongo (backend, pytest + TestClient, `./concierge-api-v3/venv/bin/python`), Python (script de backfill), JS + Vitest (frontend).

## Global Constraints

- Backend testa com pytest via `./concierge-api-v3/venv/bin/python -m pytest concierge-api-v3/tests/<file> -v`. Fixtures em `concierge-api-v3/tests/conftest.py`: `client` (TestClient), `test_db` (Mongo real), `clean_test_entities`/`clean_test_curations` (limpam docs com id/entity_id `^test_`). Use SEMPRE ids com prefixo `test_`.
- Search (`GET /curations/search`) é público; create/bulk/update exigem `X-API-Key: <API_SECRET_KEY>`.
- Frontend testa com `npx vitest run tests/<file>`. Módulos novos usam `export` + carregados via ES module (já estabelecido).
- Denormalização: `city` = `entity["data"]["location"]["city"]`, `type` = `entity["type"]` (valores ausentes → omitidos). Campos aditivos ao doc (o modelo `Curation` ignora extras).
- `q` (texto) usa `re.escape(q)` e limita tamanho (ReDoS). Cursor `after_id` preservado.
- Regra de janela: filtro = `openScope(filtro)` → página visível + prefetch da próxima. Nunca varre o DB local inteiro.

---

### Task 1: Helper puro de denormalização

**Files:**
- Create: `concierge-api-v3/app/services/curation_denorm.py`
- Test: `concierge-api-v3/tests/test_curation_denorm.py`

**Interfaces:**
- Produces: `denormalize_curation_location(entity: dict) -> dict` — `{"city": ..., "type": ...}` só com os presentes/não-vazios.

- [ ] **Step 1: Escrever o teste que falha**

```python
# concierge-api-v3/tests/test_curation_denorm.py
from app.services.curation_denorm import denormalize_curation_location


def test_denorm_extracts_city_and_type():
    entity = {"type": "bar", "data": {"location": {"city": "São Paulo"}}}
    assert denormalize_curation_location(entity) == {"city": "São Paulo", "type": "bar"}


def test_denorm_omits_missing():
    assert denormalize_curation_location({"type": "restaurant", "data": {}}) == {"type": "restaurant"}
    assert denormalize_curation_location({"data": {"location": {"city": ""}}}) == {}
    assert denormalize_curation_location(None) == {}
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `./concierge-api-v3/venv/bin/python -m pytest concierge-api-v3/tests/test_curation_denorm.py -v` · Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

```python
# concierge-api-v3/app/services/curation_denorm.py
"""Denormaliza city/type da entity na curadoria para filtro/paginação server-side."""
from typing import Any, Dict


def denormalize_curation_location(entity: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(entity, dict):
        return {}
    out: Dict[str, Any] = {}
    etype = entity.get("type")
    if isinstance(etype, str) and etype.strip():
        out["type"] = etype.strip()
    city = ((entity.get("data") or {}).get("location") or {}).get("city")
    if isinstance(city, str) and city.strip():
        out["city"] = city.strip()
    return out
```

- [ ] **Step 4: Rodar e ver passar** — Run: mesmo comando · Expected: PASS (3).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(api): helper denormalize_curation_location"`

---

### Task 2: Denormalizar no create / bulk / update

**Files:**
- Modify: `concierge-api-v3/app/api/curations.py`
- Test: `concierge-api-v3/tests/test_curations.py`

**Interfaces:**
- Consumes: `denormalize_curation_location`.
- Produces: docs de curadoria gravados com `city`/`type` quando há `entity_id` (create, bulk, update).

- [ ] **Step 1: Escrever o teste que falha** (append em `test_curations.py`)

```python
import os

def _api_headers():
    return {"X-API-Key": os.environ["API_SECRET_KEY"]}

@pytest.mark.mongo
def test_create_curation_denormalizes_city_type(client, test_db, clean_test_entities, clean_test_curations):
    test_db.entities.insert_one({
        "_id": "test_ent_denorm", "entity_id": "test_ent_denorm", "name": "T", "type": "bar",
        "data": {"location": {"city": "São Paulo"}},
    })
    payload = {
        "curation_id": "test_cur_denorm", "entity_id": "test_ent_denorm",
        "curator_id": "test_curator", "categories": {"cuisine": ["bar"]},
        "status": "draft",
    }
    resp = client.post("/api/v3/curations", json=payload, headers=_api_headers())
    assert resp.status_code == 201, resp.text
    doc = test_db.curations.find_one({"_id": "test_cur_denorm"})
    assert doc["city"] == "São Paulo"
    assert doc["type"] == "bar"
    test_db.curations.delete_one({"_id": "test_cur_denorm"})
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `./concierge-api-v3/venv/bin/python -m pytest concierge-api-v3/tests/test_curations.py -k denormalizes -v` · Expected: FAIL (`KeyError: 'city'`).

- [ ] **Step 3: Implementar** — em `curations.py`, importar o helper e setar no create. Após o bloco que busca `entity` no `create_curation` e monta `doc = curation.model_dump()`, adicionar:

```python
from app.services.curation_denorm import denormalize_curation_location
# ... dentro de create_curation, após doc = curation.model_dump() e com `entity` já buscado:
    if curation.entity_id and entity:
        doc.update(denormalize_curation_location(entity))
```

No `bulk_upsert_curations` (iteração por curation), para cada item com `entity_id`, buscar a entity (`db.entities.find_one({"_id": eid})`) e `record.update(denormalize_curation_location(entity))` antes do upsert. No `update_curation`, se `updates` incluir `entity_id`, buscar a entity e incluir `city`/`type` no `$set`.

- [ ] **Step 4: Rodar e ver passar** — Run: mesmo `-k denormalizes` · Expected: PASS. Depois a suíte do arquivo: `./concierge-api-v3/venv/bin/python -m pytest concierge-api-v3/tests/test_curations.py -v` · Expected: verde.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(api): denormalizar city/type no create/bulk/update de curation"`

---

### Task 3: Filtros `city`/`type`/`q` em `/curations/search`

**Files:**
- Modify: `concierge-api-v3/app/api/curations.py`
- Test: `concierge-api-v3/tests/test_curations.py`

**Interfaces:**
- Produces: `GET /curations/search` aceita `city`, `type`, `q` (texto sobre `restaurant_name`, `re.escape`).

- [ ] **Step 1: Escrever o teste que falha**

```python
@pytest.mark.mongo
def test_search_filters_by_city_and_text(client, test_db, clean_test_curations):
    test_db.curations.insert_many([
        {"_id": "test_c_sp", "curation_id": "test_c_sp", "entity_id": "test_e1",
         "restaurant_name": "Pizzaria Napoli", "status": "draft", "city": "São Paulo", "type": "restaurant"},
        {"_id": "test_c_rio", "curation_id": "test_c_rio", "entity_id": "test_e2",
         "restaurant_name": "Bar do Rio", "status": "draft", "city": "Rio de Janeiro", "type": "bar"},
    ])
    r = client.get("/api/v3/curations/search?city=São Paulo&limit=100")
    ids = [i.get("curation_id") for i in r.json()["items"]]
    assert "test_c_sp" in ids and "test_c_rio" not in ids

    r2 = client.get("/api/v3/curations/search?q=napoli&limit=100")
    ids2 = [i.get("curation_id") for i in r2.json()["items"]]
    assert "test_c_sp" in ids2 and "test_c_rio" not in ids2
    test_db.curations.delete_many({"_id": {"$in": ["test_c_sp", "test_c_rio"]}})
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `./concierge-api-v3/venv/bin/python -m pytest concierge-api-v3/tests/test_curations.py -k filters_by_city -v` · Expected: FAIL (city ignorado → 'test_c_rio' aparece).

- [ ] **Step 3: Implementar** — em `search_curations`, adicionar os params e a query. Garantir `import re` no topo do arquivo.

```python
# na assinatura de search_curations(...):
    city: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    q: Optional[str] = Query(None, description="Busca por texto em restaurant_name"),
# na construção do query, junto dos demais filtros:
    if city:
        query["city"] = city
    if type:
        query["type"] = type
    if q:
        query["restaurant_name"] = {"$regex": re.escape(q.strip())[:200], "$options": "i"}
```

- [ ] **Step 4: Rodar e ver passar** — Run: mesmo `-k filters_by_city` · Expected: PASS. Suíte do arquivo verde.

- [ ] **Step 5: Índices Mongo** — adicionar (idempotente) na inicialização de índices do app (onde os outros índices de `curations` são criados; procurar `create_index` em `curations`): `db.curations.create_index("city")`, `db.curations.create_index("type")`. Se não houver ponto central, criar um comentário TODO no PR e um `ensure_index` no startup. (Sem índice o filtro funciona, só mais lento.)

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(api): filtros city/type/q em /curations/search"`

---

### Task 4: Backfill de `city`/`type` nas curadorias existentes

**Files:**
- Create: `scripts/python-tools/backfill_curation_location.py`
- Test: `scripts/python-tools/tests/test_backfill_curation_location.py`

**Interfaces:**
- Consumes: mesma lógica de denormalização (mapear entity → {city,type}).
- Produces: `plan_backfill(curations, entities_by_id) -> list[dict]` — `[{curation_id, set:{city,type}}]` só para as que faltam e têm entity; `main()` aplica via Mongo (dry-run por padrão, `--apply`).

- [ ] **Step 1: Escrever o teste que falha (função pura)**

```python
# scripts/python-tools/tests/test_backfill_curation_location.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backfill_curation_location import plan_backfill


def test_plan_backfill_only_missing_with_entity():
    curations = [
        {"curation_id": "a", "entity_id": "e1"},                 # falta -> plan
        {"curation_id": "b", "entity_id": "e2", "city": "X"},    # já tem city -> pula
        {"curation_id": "c", "entity_id": "e_missing"},          # sem entity -> pula
    ]
    entities = {
        "e1": {"type": "bar", "data": {"location": {"city": "São Paulo"}}},
        "e2": {"type": "restaurant", "data": {"location": {"city": "Rio"}}},
    }
    plan = plan_backfill(curations, entities)
    assert plan == [{"curation_id": "a", "set": {"type": "bar", "city": "São Paulo"}}]
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_backfill_curation_location.py -v` · Expected: FAIL.

- [ ] **Step 3: Implementar** (`plan_backfill` puro + `main()` que lê/escreve no Mongo, dry-run/apply)

```python
#!/usr/bin/env python3
"""Backfill de city/type nas curadorias existentes a partir da entity linkada."""
import argparse, os
from pathlib import Path
from typing import Any, Dict, List


def _denorm(entity: Dict[str, Any]) -> Dict[str, Any]:
    out = {}
    t = (entity or {}).get("type")
    if isinstance(t, str) and t.strip():
        out["type"] = t.strip()
    c = (((entity or {}).get("data") or {}).get("location") or {}).get("city")
    if isinstance(c, str) and c.strip():
        out["city"] = c.strip()
    return out


def plan_backfill(curations: List[Dict[str, Any]], entities_by_id: Dict[str, Dict]) -> List[Dict[str, Any]]:
    plan = []
    for c in curations:
        if (c.get("city") or c.get("type")):
            continue
        eid = c.get("entity_id")
        ent = entities_by_id.get(eid) if eid else None
        if not ent:
            continue
        s = _denorm(ent)
        if s:
            plan.append({"curation_id": c.get("curation_id") or c.get("_id"), "set": s})
    return plan


def main() -> int:
    from dotenv import load_dotenv
    from pymongo import MongoClient
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true")
    args = p.parse_args()
    load_dotenv(Path(__file__).resolve().parents[2] / "concierge-api-v3" / ".env")
    db = MongoClient(os.environ["MONGODB_URL"])[os.environ.get("MONGODB_DB_NAME", "concierge-collector")]
    curations = list(db.curations.find({}, {"curation_id": 1, "_id": 1, "entity_id": 1, "city": 1, "type": 1}))
    eids = [c["entity_id"] for c in curations if c.get("entity_id")]
    entities_by_id = {e["_id"]: e for e in db.entities.find({"_id": {"$in": eids}}, {"type": 1, "data.location.city": 1})}
    plan = plan_backfill(curations, entities_by_id)
    print(f"{len(plan)} curadorias a preencher (de {len(curations)})")
    if not args.apply:
        print("dry-run; use --apply"); return 0
    for item in plan:
        db.curations.update_one({"$or": [{"_id": item["curation_id"]}, {"curation_id": item["curation_id"]}]},
                                {"$set": item["set"]})
    print("aplicado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Rodar e ver passar** — Run: mesmo comando · Expected: PASS (1).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(tools): backfill_curation_location (city/type nas curadorias)"`

---

### Task 5: `CurationBrowser` passa city/type/q no escopo

**Files:**
- Modify: `scripts/services/curationBrowser.js`
- Test: `tests/test_curationBrowser.test.js`

**Interfaces:**
- Produces: `openScope({ curatorId, status, city, type, q })` e `_params()` incluem `city`, `type`, `q` quando presentes.

- [ ] **Step 1: Escrever o teste que falha** (append)

```javascript
test('openScope propaga city/type/q para a API', async () => {
  const api = { listCurations: vi.fn(async () => ({ items: [] })) };
  const br = new CurationBrowser({ apiService: api, cache: { putCurations: vi.fn() }, hydrator: { enqueue: vi.fn() }, pageSize: 25 });
  br.openScope({ city: 'São Paulo', type: 'bar', q: 'pizza', status: 'draft' });
  await br.nextPage();
  expect(api.listCurations).toHaveBeenCalledWith(expect.objectContaining({ city: 'São Paulo', type: 'bar', q: 'pizza', status: 'draft', limit: 25 }));
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `npx vitest run tests/test_curationBrowser.test.js` · Expected: FAIL.

- [ ] **Step 3: Implementar** — em `openScope`, guardar `city`/`type`/`q` no `this.scope`; em `_params`, adicioná-los quando truthy:

```javascript
  openScope({ curatorId = null, status = null, city = null, type = null, q = null } = {}) {
    this.scope = { curatorId, status, city, type, q };
    this.cursor = null; this.done = false; this._prefetched = null;
  }
  // em _params(afterId), após status:
    if (this.scope.city) p.city = this.scope.city;
    if (this.scope.type) p.type = this.scope.type;
    if (this.scope.q) p.q = this.scope.q;
```

- [ ] **Step 4: Rodar e ver passar** — Run: mesmo comando · Expected: PASS. Suíte inteira `npx vitest run` verde.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(collector): CurationBrowser propaga city/type/q"`

---

### Task 6: `uiManager` — filtro vira re-scope paginado

**Files:**
- Modify: `scripts/ui-core/uiManager.js`
- Verificação: manual no app (DOM-heavy, sem unit test)

**Interfaces:**
- Consumes: `CurationBrowser.openScope`.
- Produces: handlers de filtro (city/type/status/curator/texto) chamam `openScope(filtro)` + recarregam a 1ª página (substitui a lista); "Load more" pagina dentro do escopo filtrado; remove o filtro client-side sobre `curationsCache`.

- [ ] **Step 1: Reescrever os handlers de filtro** para montar um objeto `{ curatorId, status, city, type, q }` a partir dos controles da UI e chamar:
```javascript
window.CurationBrowser.openScope(filtro);
// limpar a lista e recarregar a primeira página:
this.curationsCache = [];
await this.loadCurations(/* já usa CurationBrowser.nextPage */);
```
Campo de texto com **debounce** (~300ms). No v1, `type` é um dropdown estático (restaurant/bar/cafe/…) e `city` é um input de texto (dropdown de facets = fast-follow). Remover o filtro client-side por city/type que dependia de `curationsEntitiesMap`.

- [ ] **Step 2: `node --check scripts/ui-core/uiManager.js`** (sem erro de sintaxe) e `npx vitest run` (suíte verde — o arquivo não tem unit test).

- [ ] **Step 3: Verificação manual (browser)** — filtrar por cidade/tipo/status/curador/texto dispara `/curations/search?...` paginado (Network), lista recarrega, "Load more" pagina dentro do filtro, e limpar o filtro volta ao escopo geral.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(collector): filtro do browse vira re-scope server-side paginado"`

---

## Self-Review

**1. Cobertura do spec:** denormalização city/type (T1 helper, T2 create/bulk/update), backfill existentes (T4), filtros city/type/q em search com re.escape (T3), CurationBrowser propaga filtros (T5), uiManager filtro = re-scope paginado (T6), índices Mongo (T3 step 5). Sync sem mudança (verificado no spec). ✔

**2. Placeholders:** todo passo de código tem o código; T6 é DOM-heavy com verificação manual explícita; T3 step 5 dá um fallback claro se não houver ponto central de índices. ✔

**3. Consistência de tipos:** `denormalize_curation_location(entity)->{city,type}` usado em T2/T4; `search` params `city/type/q`; `CurationBrowser.openScope({...,city,type,q})` consumido por `uiManager`; `plan_backfill(curations, entities_by_id)`. ✔

**Nota:** os testes de API tocam o Mongo real (test_db) com ids `test_*` e limpam via fixtures — seguir esse padrão à risca para não sujar dados de produção.
