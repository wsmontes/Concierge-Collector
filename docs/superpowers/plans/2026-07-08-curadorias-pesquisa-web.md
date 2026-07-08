# Curadorias por Pesquisa Web (piloto) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um script local `research_curations.py` que, para cada entidade do Mongo, pesquisa na web, extrai texto, manda pro LLM DeepSeek e gera curadorias `draft` grounded para revisão humana.

**Architecture:** Pipeline de 5 estágios puros e testáveis (queries → busca DDG → scrape → LLM → montar curation), cada um uma função isolada. O script orquestra por entidade, com cache em disco por entidade (pula o que já tem JSON). Saída = um JSON revisável, importado depois pelo `import_curations.py` já existente com `--keep-entity-id`.

**Tech Stack:** Python 3 (venv da API `concierge-api-v3/venv`), `ddgs` (busca), `trafilatura` (extração de texto), `openai` (cliente apontado pra DeepSeek), `pymongo` + `python-dotenv` (já usados nos outros scripts).

## Global Constraints

- Roda com o interpretador `./concierge-api-v3/venv/bin/python` (mesmo dos outros scripts em `scripts/python-tools/`).
- Script utilitário, não código de aplicação. Simplicidade > rigor. Sem confidence score, sem tratamento de robots, sem checkpoint complexo.
- Dry-run é o comportamento padrão de scripts do repo; este script **sempre** só escreve JSON local (nunca chama a API de curations — o import é passo separado).
- LLM **grounded only**: extrair conceito só com suporte no texto; sem evidência = vazio; nunca inventar.
- Categorias-alvo: `cuisine`, `mood`, `setting`, `food_style`, `menu`, `price_range`, `drinks`, `special_features`, `crowd`, `suitable_for`.
- Segredos em `concierge-api-v3/.env`: `DEEPSEEK_API_KEY` (obrigatório p/ estágio LLM), opcionais `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com`), `DEEPSEEK_MODEL` (default `deepseek-chat`).
- Curadorias de saída: `status: "draft"`, `entity_id` preenchido, `sources: {"web_research": [urls]}`, `curator` = curador de automação, `curation_id` estável.
- Piloto: rodar ~30 entidades do Rio, revisar, depois escalar.

---

### Task 1: Estrutura do script, settings e queries

**Files:**
- Create: `scripts/python-tools/research_curations.py`
- Test: `scripts/python-tools/tests/test_research_curations.py`

**Interfaces:**
- Produces:
  - `build_queries(entity: dict) -> list[str]` — 2 queries a partir de `name` e `data.location` (bairro/cidade).
  - `load_settings() -> dict` — lê `.env`, devolve `{mongodb_url, mongodb_db_name, deepseek_api_key, deepseek_base_url, deepseek_model}`.

- [ ] **Step 1: Escrever o teste que falha**

```python
# scripts/python-tools/tests/test_research_curations.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from research_curations import build_queries


def test_build_queries_uses_name_and_location():
    entity = {
        "name": "Aconchego Carioca",
        "data": {"location": {"city": "Rio de Janeiro", "address": "R. Barão de Iguatemi, 379"}},
    }
    queries = build_queries(entity)
    assert len(queries) == 2
    assert all("Aconchego Carioca" in q for q in queries)
    assert any("Rio de Janeiro" in q for q in queries)
    assert any("restaurante" in q.lower() for q in queries)


def test_build_queries_without_location():
    entity = {"name": "Bar do Zé", "data": {}}
    queries = build_queries(entity)
    assert len(queries) == 2
    assert all("Bar do Zé" in q for q in queries)
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -v`
Expected: FAIL — `ModuleNotFoundError` / `ImportError: cannot import name 'build_queries'`

- [ ] **Step 3: Implementar o cabeçalho do script + `build_queries` + `load_settings`**

```python
#!/usr/bin/env python3
"""
File: research_curations.py
Purpose: Para cada entidade do Mongo, pesquisar na web (DuckDuckGo), extrair
         texto das páginas, mandar pro LLM DeepSeek e gerar curadorias `draft`
         grounded (só com evidência) para revisão humana.
Dependencies: ddgs, trafilatura, openai, pymongo, python-dotenv

Uso:
    # Piloto: 30 entidades do Rio, gera data/rio_curations_research.json
    ./concierge-api-v3/venv/bin/python scripts/python-tools/research_curations.py \
        --city Rio --limit 30 --output data/rio_curations_research.json
"""

import argparse
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Dict, List

TARGET_CATEGORIES = [
    "cuisine", "mood", "setting", "food_style", "menu",
    "price_range", "drinks", "special_features", "crowd", "suitable_for",
]


def _find_env_file() -> Path:
    here = Path(__file__).resolve()
    for candidate in [
        here.parents[2] / "concierge-api-v3" / ".env",
        here.parents[2] / ".env",
        Path.cwd() / ".env",
    ]:
        if candidate.exists():
            return candidate
    return here.parents[2] / "concierge-api-v3" / ".env"


def load_settings() -> Dict[str, str]:
    from dotenv import load_dotenv
    load_dotenv(_find_env_file())
    return {
        "mongodb_url": os.environ.get("MONGODB_URL", ""),
        "mongodb_db_name": os.environ.get("MONGODB_DB_NAME", "concierge-collector"),
        "deepseek_api_key": os.environ.get("DEEPSEEK_API_KEY", ""),
        "deepseek_base_url": os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        "deepseek_model": os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"),
    }


def build_queries(entity: Dict[str, Any]) -> List[str]:
    name = (entity.get("name") or "").strip()
    loc = (entity.get("data") or {}).get("location") or {}
    city = (loc.get("city") or "").strip()
    place = " ".join(p for p in [city] if p).strip()
    q1 = f'"{name}" {place}'.strip() if place else f'"{name}"'
    q2 = f'"{name}" restaurante {city}'.strip() if city else f'"{name}" restaurante'
    return [q1, q2]
```

- [ ] **Step 4: Rodar e ver passar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add scripts/python-tools/research_curations.py scripts/python-tools/tests/test_research_curations.py
git commit -m "feat(research): esqueleto do script + build_queries + settings"
```

---

### Task 2: Montar o bloco de texto pesquisado

**Files:**
- Modify: `scripts/python-tools/research_curations.py`
- Test: `scripts/python-tools/tests/test_research_curations.py`

**Interfaces:**
- Produces: `build_research_block(pages: list[dict], max_chars: int = 12000) -> str` — recebe `[{"url": str, "text": str}]`, devolve um bloco único com cada trecho precedido de `--- FONTE: {url} ---`, cortado a `max_chars`.

- [ ] **Step 1: Escrever o teste que falha**

```python
from research_curations import build_research_block


def test_build_research_block_labels_sources_and_truncates():
    pages = [
        {"url": "https://a.com", "text": "Comida italiana, ambiente romântico."},
        {"url": "https://b.com", "text": "x" * 20000},
    ]
    block = build_research_block(pages, max_chars=1000)
    assert "--- FONTE: https://a.com ---" in block
    assert "italiana" in block
    assert len(block) <= 1000


def test_build_research_block_empty():
    assert build_research_block([]) == ""
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k build_research_block -v`
Expected: FAIL — `cannot import name 'build_research_block'`

- [ ] **Step 3: Implementar**

```python
def build_research_block(pages: List[Dict[str, str]], max_chars: int = 12000) -> str:
    parts: List[str] = []
    for p in pages:
        url = (p.get("url") or "").strip()
        text = (p.get("text") or "").strip()
        if not text:
            continue
        parts.append(f"--- FONTE: {url} ---\n{text}")
    block = "\n\n".join(parts)
    return block[:max_chars]
```

- [ ] **Step 4: Rodar e ver passar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k build_research_block -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(research): build_research_block com rótulo de fonte e corte"
```

---

### Task 3: Montar a curation draft a partir da saída do LLM

**Files:**
- Modify: `scripts/python-tools/research_curations.py`
- Test: `scripts/python-tools/tests/test_research_curations.py`

**Interfaces:**
- Consumes: `TARGET_CATEGORIES` (Task 1).
- Produces:
  - `clean_llm_categories(raw: dict) -> dict` — mantém só chaves em `TARGET_CATEGORIES` com listas de strings não-vazias.
  - `build_curation(entity: dict, categories: dict, urls: list[str], research_block: str, curator_id: str, curator_name: str) -> dict` — monta o doc `draft` compatível com `import_curations.py --keep-entity-id`.

- [ ] **Step 1: Escrever o teste que falha**

```python
from research_curations import clean_llm_categories, build_curation


def test_clean_llm_categories_filters_unknown_and_empties():
    raw = {
        "cuisine": ["Italiana", ""],
        "mood": [],
        "lixo_inventado": ["x"],
        "price_range": ["$$"],
    }
    out = clean_llm_categories(raw)
    assert out == {"cuisine": ["Italiana"], "price_range": ["$$"]}


def test_build_curation_shape():
    entity = {"_id": "overture_abc", "entity_id": "overture_abc", "name": "Cantina X"}
    cur = build_curation(
        entity=entity,
        categories={"cuisine": ["Italiana"]},
        urls=["https://a.com"],
        research_block="texto pesquisado",
        curator_id="curator-ai-research",
        curator_name="AI Web Research",
    )
    assert cur["entity_id"] == "overture_abc"
    assert cur["status"] == "draft"
    assert cur["restaurant_name"] == "Cantina X"
    assert cur["categories"] == {"cuisine": ["Italiana"]}
    assert cur["sources"] == {"web_research": ["https://a.com"]}
    assert cur["curator"]["id"] == "curator-ai-research"
    assert cur["curation_id"].startswith("curation-research-")
    assert cur["transcript"] == "texto pesquisado"
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k "clean_llm_categories or build_curation" -v`
Expected: FAIL — `cannot import name 'clean_llm_categories'`

- [ ] **Step 3: Implementar**

```python
import hashlib


def clean_llm_categories(raw: Dict[str, Any]) -> Dict[str, List[str]]:
    if not isinstance(raw, dict):
        return {}
    cleaned: Dict[str, List[str]] = {}
    for key in TARGET_CATEGORIES:
        values = raw.get(key)
        if not isinstance(values, list):
            continue
        vals = [v.strip() for v in values if isinstance(v, str) and v.strip()]
        if vals:
            cleaned[key] = vals
    return cleaned


def build_curation(
    entity: Dict[str, Any],
    categories: Dict[str, List[str]],
    urls: List[str],
    research_block: str,
    curator_id: str,
    curator_name: str,
) -> Dict[str, Any]:
    entity_id = entity.get("entity_id") or entity.get("_id")
    digest = hashlib.md5(f"research::{entity_id}".encode("utf-8")).hexdigest()[:12]
    return {
        "curation_id": f"curation-research-{digest}",
        "entity_id": entity_id,
        "restaurant_name": entity.get("name"),
        "status": "draft",
        "curator_id": curator_id,
        "curator": {"id": curator_id, "name": curator_name},
        "categories": categories,
        "sources": {"web_research": urls},
        "transcript": research_block,
        "notes": {"private": "Gerada por pesquisa web + LLM (grounded). Revisar."},
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k "clean_llm_categories or build_curation" -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(research): clean_llm_categories + build_curation draft"
```

---

### Task 4: Estágio LLM (DeepSeek) grounded

**Files:**
- Modify: `scripts/python-tools/research_curations.py`
- Test: `scripts/python-tools/tests/test_research_curations.py`

**Interfaces:**
- Consumes: `TARGET_CATEGORIES`, `clean_llm_categories`.
- Produces: `extract_concepts_llm(research_block: str, entity_name: str, client, model: str) -> dict` — monta prompt grounded, chama `client.chat.completions.create`, faz parse do JSON e retorna categorias limpas. `client` é injetável (um dublê no teste).

- [ ] **Step 1: Escrever o teste que falha (com cliente dublê)**

```python
import json as _json
from research_curations import extract_concepts_llm


class _FakeResp:
    def __init__(self, content):
        self.choices = [type("C", (), {"message": type("M", (), {"content": content})})]


class _FakeClient:
    def __init__(self, content):
        self._content = content
        self.chat = type("Chat", (), {"completions": self})

    def create(self, **kwargs):  # mimics client.chat.completions.create
        self.last_kwargs = kwargs
        return _FakeResp(self._content)


def test_extract_concepts_llm_parses_and_cleans():
    payload = _json.dumps({"cuisine": ["Japonesa"], "lixo": ["x"], "mood": []})
    client = _FakeClient(payload)
    out = extract_concepts_llm("--- FONTE: a ---\nsushi", "Sushi X", client, "deepseek-chat")
    assert out == {"cuisine": ["Japonesa"]}
    # prompt precisa conter instrução grounded e o nome da entidade
    sent = client.last_kwargs["messages"][-1]["content"]
    assert "Sushi X" in sent


def test_extract_concepts_llm_handles_bad_json():
    client = _FakeClient("desculpa, não achei nada")
    out = extract_concepts_llm("texto", "X", client, "deepseek-chat")
    assert out == {}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k extract_concepts_llm -v`
Expected: FAIL — `cannot import name 'extract_concepts_llm'`

- [ ] **Step 3: Implementar**

```python
def _parse_json_object(text: str) -> Dict[str, Any]:
    """Extrai o primeiro objeto JSON de uma resposta de LLM; {} se falhar."""
    if not text:
        return {}
    try:
        return json.loads(text)
    except Exception:
        pass
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except Exception:
            return {}
    return {}


def extract_concepts_llm(research_block: str, entity_name: str, client, model: str) -> Dict[str, List[str]]:
    cats = ", ".join(TARGET_CATEGORIES)
    system = (
        "Você extrai conceitos estruturados sobre restaurantes a partir de texto "
        "pesquisado na web. Regras: use SOMENTE informação presente no texto. "
        "Se não houver evidência para uma categoria, omita-a. NUNCA invente. "
        "Responda apenas com um objeto JSON."
    )
    user = (
        f"Restaurante alvo: {entity_name}\n"
        f"Categorias possíveis: {cats}\n\n"
        "Parte do texto pode ser sobre OUTRO estabelecimento — ignore o que não "
        "for claramente sobre o restaurante alvo.\n"
        "Retorne JSON no formato {\"categoria\": [\"valor\", ...]} apenas com "
        "categorias que tenham suporte explícito no texto.\n\n"
        f"TEXTO PESQUISADO:\n{research_block}"
    )
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0,
    )
    content = resp.choices[0].message.content
    return clean_llm_categories(_parse_json_object(content))
```

- [ ] **Step 4: Rodar e ver passar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k extract_concepts_llm -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(research): extract_concepts_llm grounded via DeepSeek"
```

---

### Task 5: Busca + scrape (com dublês) e checagem de deps

**Files:**
- Modify: `scripts/python-tools/research_curations.py`
- Test: `scripts/python-tools/tests/test_research_curations.py`

**Interfaces:**
- Produces:
  - `search_web(query: str, max_results: int = 5, searcher=None) -> list[str]` — retorna URLs; `searcher` injetável (default usa `ddgs`).
  - `scrape_url(url: str, fetcher=None) -> str` — texto limpo; `fetcher` injetável (default baixa e passa por `trafilatura`).

- [ ] **Step 1: Instalar dependências no venv**

Run:
```bash
./concierge-api-v3/venv/bin/pip install ddgs trafilatura
```
Expected: `Successfully installed ddgs-... trafilatura-... lxml-...`

- [ ] **Step 2: Escrever o teste que falha (dublês, sem rede)**

```python
from research_curations import search_web, scrape_url


def test_search_web_uses_injected_searcher():
    def fake_searcher(query, max_results):
        return [{"href": "https://a.com"}, {"href": "https://b.com"}]
    urls = search_web("qualquer", max_results=2, searcher=fake_searcher)
    assert urls == ["https://a.com", "https://b.com"]


def test_scrape_url_uses_injected_fetcher():
    def fake_fetcher(url):
        return "Texto limpo da página."
    assert scrape_url("https://a.com", fetcher=fake_fetcher) == "Texto limpo da página."


def test_scrape_url_returns_empty_on_failure():
    def boom(url):
        raise RuntimeError("timeout")
    assert scrape_url("https://a.com", fetcher=boom) == ""
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k "search_web or scrape_url" -v`
Expected: FAIL — `cannot import name 'search_web'`

- [ ] **Step 4: Implementar**

```python
def search_web(query: str, max_results: int = 5, searcher=None) -> List[str]:
    if searcher is None:
        def searcher(q, n):
            from ddgs import DDGS
            with DDGS() as ddgs:
                return list(ddgs.text(q, max_results=n))
    try:
        results = searcher(query, max_results)
    except Exception:
        return []
    urls: List[str] = []
    for r in results:
        href = r.get("href") or r.get("url") if isinstance(r, dict) else None
        if href:
            urls.append(href)
    return urls


def scrape_url(url: str, fetcher=None) -> str:
    if fetcher is None:
        def fetcher(u):
            import trafilatura
            downloaded = trafilatura.fetch_url(u)
            if not downloaded:
                return ""
            return trafilatura.extract(downloaded) or ""
    try:
        return (fetcher(url) or "").strip()
    except Exception:
        return ""
```

- [ ] **Step 5: Rodar e ver passar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k "search_web or scrape_url" -v`
Expected: PASS (3 passed)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(research): search_web + scrape_url com dublês injetáveis"
```

---

### Task 6: Orquestração por entidade + CLI + main

**Files:**
- Modify: `scripts/python-tools/research_curations.py`
- Test: `scripts/python-tools/tests/test_research_curations.py`

**Interfaces:**
- Consumes: todas as funções anteriores.
- Produces:
  - `research_entity(entity: dict, client, model: str, per_query_results: int = 5) -> dict | None` — roda queries→busca→scrape→LLM→build_curation; devolve a curation ou `None` se não houver conceitos.
  - `main() -> int` — CLI: `--city`, `--limit`, `--output`, `--per-query-results`, `--sleep`; lê entidades do Mongo, pula as que já estão no output (cache), grava JSON. Nunca chama a API de curations.

- [ ] **Step 1: Escrever o teste que falha (research_entity com dublês)**

```python
from research_curations import research_entity


def test_research_entity_end_to_end_with_fakes():
    entity = {"_id": "overture_x", "entity_id": "overture_x", "name": "Trattoria Y",
              "data": {"location": {"city": "Rio de Janeiro"}}}

    payload = _json.dumps({"cuisine": ["Italiana"], "price_range": ["$$"]})
    client = _FakeClient(payload)

    # monkeypatch dos estágios de rede via parâmetros injetáveis
    def fake_search(query, max_results, searcher=None):
        return ["https://a.com"]
    def fake_scrape(url, fetcher=None):
        return "Comida italiana, ambiente aconchegante."

    import research_curations as rc
    rc.search_web = fake_search
    rc.scrape_url = fake_scrape

    cur = research_entity(entity, client, "deepseek-chat")
    assert cur["entity_id"] == "overture_x"
    assert cur["categories"] == {"cuisine": ["Italiana"], "price_range": ["$$"]}
    assert cur["sources"]["web_research"] == ["https://a.com"]


def test_research_entity_returns_none_without_concepts():
    entity = {"_id": "z", "entity_id": "z", "name": "Nada", "data": {}}
    client = _FakeClient("{}")
    import research_curations as rc
    rc.search_web = lambda q, max_results, searcher=None: ["https://a.com"]
    rc.scrape_url = lambda url, fetcher=None: "texto"
    assert research_entity(entity, client, "deepseek-chat") is None
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k research_entity -v`
Expected: FAIL — `cannot import name 'research_entity'`

- [ ] **Step 3: Implementar `research_entity`, `main` e o guard `__main__`**

```python
CURATOR_ID = "curator-ai-research"
CURATOR_NAME = "AI Web Research"


def research_entity(entity: Dict[str, Any], client, model: str, per_query_results: int = 5) -> Dict[str, Any] | None:
    urls: List[str] = []
    for q in build_queries(entity):
        for u in search_web(q, max_results=per_query_results):
            if u not in urls:
                urls.append(u)
    pages = [{"url": u, "text": scrape_url(u)} for u in urls]
    pages = [p for p in pages if p["text"]]
    block = build_research_block(pages)
    if not block:
        return None
    categories = extract_concepts_llm(block, entity.get("name") or "", client, model)
    if not categories:
        return None
    return build_curation(
        entity=entity,
        categories=categories,
        urls=[p["url"] for p in pages],
        research_block=block,
        curator_id=CURATOR_ID,
        curator_name=CURATOR_NAME,
    )


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Gera curadorias draft via pesquisa web + LLM")
    p.add_argument("--city", default="Rio", help="Filtro de cidade (regex em data.location.city)")
    p.add_argument("--limit", type=int, default=30, help="Máx. de entidades (0 = todas)")
    p.add_argument("--output", default="data/rio_curations_research.json")
    p.add_argument("--per-query-results", type=int, default=5, dest="per_query_results")
    p.add_argument("--sleep", type=float, default=1.0, help="Pausa entre entidades (s)")
    return p.parse_args()


def main() -> int:
    from pymongo import MongoClient
    from openai import OpenAI

    args = parse_args()
    s = load_settings()
    if not s["deepseek_api_key"]:
        print("ERRO: DEEPSEEK_API_KEY não definida em concierge-api-v3/.env")
        return 1

    client = OpenAI(api_key=s["deepseek_api_key"], base_url=s["deepseek_base_url"])
    model = s["deepseek_model"]

    db = MongoClient(s["mongodb_url"])[s["mongodb_db_name"]]
    query = {"type": {"$in": ["restaurant", "bar", "cafe"]}}
    if args.city:
        query["data.location.city"] = {"$regex": args.city, "$options": "i"}
    cursor = db.entities.find(query)
    if args.limit:
        cursor = cursor.limit(args.limit)
    entities = list(cursor)
    print(f"{len(entities)} entidades candidatas")

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    existing = []
    done_ids = set()
    if out_path.exists():
        existing = json.loads(out_path.read_text(encoding="utf-8"))
        done_ids = {c.get("entity_id") for c in existing}

    results = list(existing)
    for i, e in enumerate(entities, 1):
        eid = e.get("entity_id") or e.get("_id")
        if eid in done_ids:
            print(f"[{i}/{len(entities)}] {e.get('name')} — já feito, pulando")
            continue
        print(f"[{i}/{len(entities)}] {e.get('name')} …", end="", flush=True)
        try:
            cur = research_entity(e, client, model, args.per_query_results)
        except Exception as exc:
            print(f" ERRO: {exc}")
            cur = None
        if cur:
            results.append(cur)
            print(f" ok ({len(cur['categories'])} categorias)")
        else:
            print(" sem conceitos")
        out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        time.sleep(args.sleep)

    print(f"\nSalvo: {out_path}  ({len(results)} curadorias)")
    print("Revisar e depois importar com:")
    print(f"  ./concierge-api-v3/venv/bin/python scripts/python-tools/import_curations.py "
          f"--input {out_path} --keep-entity-id --apply")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Rodar e ver passar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k research_entity -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Rodar a suíte inteira**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -v`
Expected: PASS (todos)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(research): orquestração por entidade + CLI main"
```

---

### Task 7: Smoke test real do piloto (rede + DeepSeek)

**Files:**
- Nenhum arquivo novo. Requer `DEEPSEEK_API_KEY` no `.env`.

- [ ] **Step 1: Rodar em 3 entidades reais**

Run:
```bash
./concierge-api-v3/venv/bin/python scripts/python-tools/research_curations.py \
    --city Rio --limit 3 --output data/rio_curations_research.json
```
Expected: imprime 3 entidades processadas; cria `data/rio_curations_research.json`.

- [ ] **Step 2: Inspecionar a saída**

Run: `./concierge-api-v3/venv/bin/python -c "import json; d=json.load(open('data/rio_curations_research.json')); print(len(d)); print(json.dumps(d[0], ensure_ascii=False, indent=2)[:1200])"`
Expected: JSON com `status=draft`, `entity_id`, `categories` com valores plausíveis e aterrados no `transcript`.

- [ ] **Step 3: Revisão humana (checkpoint)**

Parar aqui. Revisar qualidade juntos: os conceitos batem com a realidade? Há invenção? Ajustar prompt (Task 4) ou queries (Task 1) se necessário e re-rodar. Só escalar (`--limit 30` → depois maior) após aprovação.

---

## Self-Review

**1. Cobertura do spec:** queries (T1), busca DDG (T5), scrape/trafilatura (T5), bloco rotulado por fonte (T2), LLM grounded DeepSeek (T4), curation draft com entity_id/sources/curator (T3), cache/resume por entidade (T6), piloto ~30 + checkpoint (T6/T7), deps instaladas (T5), import via script existente (T6 imprime o comando). ✔ Coberto.

**2. Placeholders:** nenhum "TBD/TODO"; todo passo de código mostra o código. ✔

**3. Consistência de tipos:** `build_queries`, `build_research_block`, `clean_llm_categories`, `build_curation`, `extract_concepts_llm`, `search_web`, `scrape_url`, `research_entity` usadas com as mesmas assinaturas nos testes e na orquestração. `TARGET_CATEGORIES` e `CURATOR_ID` definidos uma vez. ✔

**Nota de dependência:** o import final usa `import_curations.py --keep-entity-id` (flag confirmada existir). Embeddings via `generate_embeddings.py` (passo separado pós-import, fora do escopo do piloto).
