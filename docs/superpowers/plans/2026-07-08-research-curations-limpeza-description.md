# Limpeza de conteúdo + Description no `research_curations` — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estender `research_curations.py` para (1) limpar heuristicamente o texto raspado, (2) usar esse texto limpo como `transcript`, e (3) gerar uma `description` em PT numa única chamada de LLM (junto das categorias), gravada em `entity.data.description` via patch de entidade.

**Architecture:** Pipeline atual (queries → busca → scrape → LLM → curation) ganha um estágio puro de limpeza antes do bloco de pesquisa; o estágio LLM passa a retornar `{categories, description}` numa só chamada; a orquestração emite dois artefatos locais (curations JSON + entity-descriptions JSON), importados por scripts existentes.

**Tech Stack:** Python 3 (venv `concierge-api-v3/venv`), `pytest`, mesmas deps do script (ddgs, trafilatura, openai, pymongo, python-dotenv).

## Global Constraints

- Interpretador: `./concierge-api-v3/venv/bin/python` (mesmo dos outros scripts).
- Script utilitário: simplicidade > rigor. Sem confidence score, robots.txt, checkpoint complexo.
- **Só escreve JSON local** (nunca chama a API de curations/entities — import é passo separado).
- **Grounded only**: nada inventado; sem evidência ⇒ vazio.
- `categories` em **inglês minúsculo** (vocab controlado, `price_range` ∈ {unexpensive, mid-range, expensive}); `description` em **português** (1-3 frases factuais).
- `description` vai para `entity.data.description` via patch `{entity_id, name, type, data:{description}}` (o `POST /entities/bulk` faz deep-merge, sem clobber).
- Uma única chamada de LLM por entidade, retornando `{categories, description}`.
- Todos os testes usam dublês injetáveis (sem rede/LLM real).

---

### Task 1: Limpeza heurística do texto raspado

**Files:**
- Modify: `scripts/python-tools/research_curations.py`
- Test: `scripts/python-tools/tests/test_research_curations.py`

**Interfaces:**
- Produces: `clean_scraped_text(text: str) -> str` — remove navegação/boilerplate/andaimes de rating, deduplica linhas idênticas, preserva conteúdo real (nomes de prato, frases). Conservador.

- [ ] **Step 1: Escrever o teste que falha**

```python
# adicionar em test_research_curations.py; importar clean_scraped_text no bloco de import
def test_clean_scraped_text_removes_nav_boilerplate_and_dedups():
    raw = "\n".join([
        "Home",
        "Último update: 17.01.2026",
        "★ 2.3 / 5",
        "(6 Avaliação)",
        "Comida italiana, ambiente romântico.",
        "Comida italiana, ambiente romântico.",          # duplicada
        "pizza",                                          # conteúdo curto real -> preservar
        "Aceitamos cookies para melhorar sua experiência.",
    ])
    out = clean_scraped_text(raw)
    linhas = out.split("\n")
    assert "Home" not in linhas
    assert "Último update" not in out
    assert "★" not in out
    assert "Avaliação" not in out
    assert "cookie" not in out.lower()
    assert "pizza" in linhas                              # preservado
    assert out.count("Comida italiana, ambiente romântico.") == 1   # dedup


def test_clean_scraped_text_empty():
    assert clean_scraped_text("") == ""
    assert clean_scraped_text("\n\n   \n") == ""
```

Adicionar `clean_scraped_text` ao `from research_curations import (...)`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k clean_scraped_text -v`
Expected: FAIL — `cannot import name 'clean_scraped_text'`

- [ ] **Step 3: Implementar** (adicionar após `build_research_block`)

```python
_NAV_TOKENS = {
    "home", "menu", "login", "logout", "sign in", "sign up", "assine",
    "buscar", "search", "compartilhar", "share", "contato", "sobre",
    "reservar", "fechar", "close", "faq", "imagens", "avaliações",
}
_BOILERPLATE_PATTERNS = [
    re.compile(r"cookie", re.I),
    re.compile(r"newsletter|assine|subscribe", re.I),
    re.compile(r"último update", re.I),
    re.compile(r"^\s*★?\s*\d+([.,]\d+)?\s*/\s*5", re.I),   # ★ 2.3 / 5
    re.compile(r"\(\s*\d+\s+avalia", re.I),                # (6 Avaliação)
    re.compile(r"^avalia(ç|c)", re.I),                     # Avaliações
    re.compile(r"compartilh|facebook|whatsapp|twitter", re.I),
]


def clean_scraped_text(text: str) -> str:
    if not text:
        return ""
    seen = set()
    out: List[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        low = line.lower()
        if low in _NAV_TOKENS:
            continue
        if any(p.search(line) for p in _BOILERPLATE_PATTERNS):
            continue
        if low in seen:
            continue
        seen.add(low)
        out.append(line)
    return "\n".join(out)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k clean_scraped_text -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(research): clean_scraped_text (limpeza heurística conservadora)"
```

---

### Task 2: Estágio LLM retorna `{categories, description}` numa chamada

**Files:**
- Modify: `scripts/python-tools/research_curations.py`
- Test: `scripts/python-tools/tests/test_research_curations.py`

**Interfaces:**
- Consumes: `clean_llm_categories`, `_parse_json_object`, `_format_vocab_block`, `TARGET_CATEGORIES`, `PRICE_RANGE_SCALE`.
- Produces: `extract_concepts_llm(research_block: str, entity_name: str, client, model: str, vocabulary: dict | None = None) -> dict` — retorna `{"categories": {...}, "description": str}`. `description` em PT, aterrada, `""` se sem evidência, cortada a `DESCRIPTION_MAX_CHARS`.

- [ ] **Step 1: Substituir os testes antigos de `extract_concepts_llm`**

Remover `test_extract_concepts_llm_parses_and_cleans`, `test_extract_concepts_llm_handles_bad_json`, `test_extract_concepts_llm_injects_vocabulary_and_price_scale` e colocar:

```python
def test_extract_llm_returns_categories_and_description():
    payload = _json.dumps({
        "categories": {"cuisine": ["Italian"], "price_range": ["Mid-Range"]},
        "description": "Cantina italiana aconchegante, com massas e pizzas.",
    })
    client = _FakeClient(payload)
    out = extract_concepts_llm("--- FONTE: a ---\ntexto", "Cantina X", client, "deepseek-chat")
    assert out["categories"] == {"cuisine": ["italian"], "price_range": ["mid-range"]}
    assert out["description"].startswith("Cantina italiana")
    sent = client.last_kwargs["messages"][-1]["content"]
    assert "Cantina X" in sent
    assert "descri" in sent.lower()          # prompt pede description


def test_extract_llm_empty_description_when_absent():
    payload = _json.dumps({"categories": {"cuisine": ["bar"]}})
    out = extract_concepts_llm("t", "X", _FakeClient(payload), "deepseek-chat")
    assert out["categories"] == {"cuisine": ["bar"]}
    assert out["description"] == ""


def test_extract_llm_handles_bad_json():
    out = extract_concepts_llm("t", "X", _FakeClient("desculpa"), "deepseek-chat")
    assert out == {"categories": {}, "description": ""}


def test_extract_llm_injects_vocabulary_and_price_scale():
    client = _FakeClient(_json.dumps({"categories": {"cuisine": ["italian"]}, "description": ""}))
    vocab = {"cuisine": ["italian", "japanese"], "mood": ["cozy"]}
    extract_concepts_llm("texto", "X", client, "deepseek-chat", vocabulary=vocab)
    sent = client.last_kwargs["messages"][-1]["content"]
    assert "italian" in sent and "japanese" in sent and "cozy" in sent
    assert "unexpensive" in sent and "mid-range" in sent and "expensive" in sent
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k extract_llm -v`
Expected: FAIL — `KeyError: 'categories'` / assert (a função ainda retorna só categorias)

- [ ] **Step 3: Implementar** (substituir a função `extract_concepts_llm` inteira)

```python
DESCRIPTION_MAX_CHARS = 400


def extract_concepts_llm(
    research_block: str,
    entity_name: str,
    client,
    model: str,
    vocabulary: Dict[str, List[str]] | None = None,
) -> Dict[str, Any]:
    cats = ", ".join(TARGET_CATEGORIES)
    price_scale = " | ".join(PRICE_RANGE_SCALE)
    system = (
        "You extract structured data about a restaurant from web-researched text. "
        "Rules: use ONLY information explicitly supported by the text; if something "
        "has no evidence, omit it; NEVER invent. Reply with a single JSON object only."
    )
    semantics = (
        "Category meanings (tag values in ENGLISH, lowercase, 1-3 words):\n"
        "- cuisine: kind of cuisine (italian, japanese, brazilian, wine bar) — NOT an "
        "aggregator's navigation label.\n"
        "- menu: specific dishes/items served (pasta, oysters, feijoada).\n"
        "- food_style: preparation/style (slow food, casual food, gourmet, traditional).\n"
        "- drinks: beverages offered (wine list, craft beers, signature cocktails).\n"
        "- setting: physical space/decor (terrace, open kitchen, upscale, rustic).\n"
        "- mood: the vibe/atmosphere (lively, cozy, romantic, formal).\n"
        "- crowd: WHO goes there (tourists, locals, families, executives, young).\n"
        "- suitable_for: occasions (dating, business lunches, celebrations, quick bite).\n"
        "- special_features: services/amenities (delivery, valet parking, reservations recommended).\n"
        f"- price_range: choose EXACTLY ONE from this closed scale: {price_scale}.\n"
    )
    vocab_block = _format_vocab_block(vocabulary or {})
    vocab_section = ""
    if vocab_block:
        vocab_section = (
            "\nPREFERRED VOCABULARY (reuse these exact tags whenever they fit the "
            "evidence; add a new lowercase english tag only if clearly supported and none "
            "of these fit):\n" + vocab_block + "\n"
        )
    user = (
        f"Target restaurant: {entity_name}\n"
        f"Possible categories: {cats}\n"
        f"{semantics}"
        f"{vocab_section}\n"
        "Part of the text may be about ANOTHER establishment — ignore anything not "
        "clearly about the target restaurant.\n"
        "Also write a `description`: 1-3 factual sentences IN PORTUGUESE describing this "
        "restaurant, grounded strictly in the text (no marketing fluff, no invention). "
        "If the text does not support a description, use an empty string.\n\n"
        'Return JSON exactly as {"categories": {"category": ["tag", ...], ...}, '
        '"description": "..."} with only categories that have explicit support.\n\n'
        f"RESEARCHED TEXT:\n{research_block}"
    )
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0,
    )
    content = resp.choices[0].message.content
    data = _parse_json_object(content)
    categories = clean_llm_categories(data.get("categories") if isinstance(data, dict) else {})
    raw_desc = data.get("description") if isinstance(data, dict) else ""
    description = (raw_desc or "").strip()[:DESCRIPTION_MAX_CHARS] if isinstance(raw_desc, str) else ""
    return {"categories": categories, "description": description}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k extract_llm -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(research): extract_concepts_llm retorna {categories, description} em 1 chamada"
```

---

### Task 3: Patch de entidade para `data.description`

**Files:**
- Modify: `scripts/python-tools/research_curations.py`
- Test: `scripts/python-tools/tests/test_research_curations.py`

**Interfaces:**
- Produces: `build_entity_patch(entity: dict, description: str) -> dict` — `{entity_id, name, type, data:{description}}`, compatível com `import_entities.py` (deep-merge no servidor).

- [ ] **Step 1: Escrever o teste que falha**

```python
def test_build_entity_patch_shape():
    entity = {"_id": "osm_1", "entity_id": "osm_1", "name": "Bar X", "type": "bar",
              "data": {"location": {"city": "Rio"}}}
    patch = build_entity_patch(entity, "Bar aconchegante no centro.")
    assert patch == {
        "entity_id": "osm_1",
        "name": "Bar X",
        "type": "bar",
        "data": {"description": "Bar aconchegante no centro."},
    }
```

Adicionar `build_entity_patch` ao import.

- [ ] **Step 2: Rodar e ver falhar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k build_entity_patch -v`
Expected: FAIL — `cannot import name 'build_entity_patch'`

- [ ] **Step 3: Implementar** (adicionar após `build_curation`)

```python
def build_entity_patch(entity: Dict[str, Any], description: str) -> Dict[str, Any]:
    return {
        "entity_id": entity.get("entity_id") or entity.get("_id"),
        "name": entity.get("name"),
        "type": entity.get("type"),
        "data": {"description": description},
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k build_entity_patch -v`
Expected: PASS (1 passed)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(research): build_entity_patch para data.description"
```

---

### Task 4: `research_entity` limpa páginas e devolve `(curation, entity_patch)`

**Files:**
- Modify: `scripts/python-tools/research_curations.py`
- Test: `scripts/python-tools/tests/test_research_curations.py`

**Interfaces:**
- Consumes: `clean_scraped_text`, `build_research_block`, `extract_concepts_llm` (dict), `build_curation`, `build_entity_patch`.
- Produces: `research_entity(entity, client, model, per_query_results=5, vocabulary=None) -> tuple[dict | None, dict | None]` — `(curation, entity_patch)`. `curation` só se houver categorias; `entity_patch` só se houver description. `transcript` da curation = texto limpo.

- [ ] **Step 1: Substituir os testes de `research_entity`**

Remover `test_research_entity_end_to_end_with_fakes`, `test_research_entity_returns_none_without_concepts`, `test_research_entity_forwards_vocabulary` e colocar:

```python
def test_research_entity_returns_curation_and_patch():
    entity = {"_id": "x", "entity_id": "x", "name": "Trattoria", "type": "restaurant",
              "data": {"location": {"city": "Rio de Janeiro"}}}
    payload = _json.dumps({"categories": {"cuisine": ["Italian"]},
                           "description": "Trattoria italiana simpática."})
    client = _FakeClient(payload)
    import research_curations as rc
    rc.search_web = lambda q, max_results, searcher=None: ["https://a.com"]
    rc.scrape_url = lambda url, fetcher=None: "Home\nComida italiana boa.\nComida italiana boa."
    curation, patch = rc.research_entity(entity, client, "deepseek-chat")
    assert curation["categories"] == {"cuisine": ["italian"]}
    assert "Home" not in curation["transcript"]                       # nav removida
    assert curation["transcript"].count("Comida italiana boa.") == 1  # dedup
    assert patch == {"entity_id": "x", "name": "Trattoria", "type": "restaurant",
                     "data": {"description": "Trattoria italiana simpática."}}


def test_research_entity_no_description_no_patch():
    entity = {"_id": "z", "entity_id": "z", "name": "Z", "type": "bar", "data": {}}
    client = _FakeClient(_json.dumps({"categories": {"cuisine": ["bar"]}}))  # sem description
    import research_curations as rc
    rc.search_web = lambda q, max_results, searcher=None: ["https://a.com"]
    rc.scrape_url = lambda url, fetcher=None: "texto valido aqui."
    curation, patch = rc.research_entity(entity, client, "deepseek-chat")
    assert curation is not None
    assert patch is None


def test_research_entity_none_none_without_content():
    entity = {"_id": "z", "entity_id": "z", "name": "Z", "type": "bar", "data": {}}
    import research_curations as rc
    rc.search_web = lambda q, max_results, searcher=None: []
    rc.scrape_url = lambda url, fetcher=None: ""
    assert rc.research_entity(entity, _FakeClient("{}"), "deepseek-chat") == (None, None)


def test_research_entity_forwards_vocabulary(monkeypatch):
    import research_curations as rc
    monkeypatch.setattr(rc, "search_web", lambda q, max_results, searcher=None: ["https://a.com"])
    monkeypatch.setattr(rc, "scrape_url", lambda url, fetcher=None: "texto valido.")
    captured = {}

    def fake_extract(block, name, client, model, vocabulary=None):
        captured["vocab"] = vocabulary
        return {"categories": {"cuisine": ["bar"]}, "description": ""}

    monkeypatch.setattr(rc, "extract_concepts_llm", fake_extract)
    entity = {"_id": "x", "entity_id": "x", "name": "X", "type": "bar", "data": {}}
    vocab = {"cuisine": ["bar"]}
    rc.research_entity(entity, client=None, model="m", vocabulary=vocab)
    assert captured["vocab"] == vocab
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k research_entity -v`
Expected: FAIL — `TypeError: cannot unpack non-iterable` / `KeyError` (research_entity ainda devolve só a curation)

- [ ] **Step 3: Implementar** (substituir a função `research_entity` inteira)

```python
def research_entity(
    entity: Dict[str, Any],
    client,
    model: str,
    per_query_results: int = 5,
    vocabulary: Dict[str, List[str]] | None = None,
) -> "tuple[Dict[str, Any] | None, Dict[str, Any] | None]":
    urls: List[str] = []
    for q in build_queries(entity):
        for u in search_web(q, max_results=per_query_results):
            if u not in urls:
                urls.append(u)
    pages = [{"url": u, "text": clean_scraped_text(scrape_url(u))} for u in urls]
    pages = [p for p in pages if p["text"]]
    block = build_research_block(pages)
    if not block:
        return None, None
    result = extract_concepts_llm(block, entity.get("name") or "", client, model, vocabulary=vocabulary)
    categories = result.get("categories") or {}
    description = (result.get("description") or "").strip()
    curation = None
    if categories:
        curation = build_curation(
            entity=entity,
            categories=categories,
            urls=[p["url"] for p in pages],
            research_block=block,
            curator_id=CURATOR_ID,
            curator_name=CURATOR_NAME,
        )
    patch = build_entity_patch(entity, description) if description else None
    return curation, patch
```

- [ ] **Step 4: Rodar e ver passar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k research_entity -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Rodar a suíte inteira**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -q`
Expected: PASS (todos)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(research): research_entity limpa páginas e devolve (curation, entity_patch)"
```

---

### Task 5: CLI + `main()` com dois artefatos de saída

**Files:**
- Modify: `scripts/python-tools/research_curations.py`
- Test: `scripts/python-tools/tests/test_research_curations.py`

**Interfaces:**
- Consumes: `research_entity` (tupla), `load_vocabulary_from_db`.
- Produces: `parse_args()` com `--descriptions-output` (default `data/rio_entity_descriptions.json`); `main()` grava curations e entity-descriptions incrementalmente, com cache por `entity_id` combinado.

- [ ] **Step 1: Teste do novo argumento**

```python
def test_parse_args_descriptions_output_default(monkeypatch):
    import research_curations as rc
    monkeypatch.setattr("sys.argv", ["prog"])
    args = rc.parse_args()
    assert args.descriptions_output == "data/rio_entity_descriptions.json"
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k descriptions_output_default -v`
Expected: FAIL — `AttributeError: 'Namespace' object has no attribute 'descriptions_output'`

- [ ] **Step 3: Adicionar o argumento** (em `parse_args`, após `--output`)

```python
    p.add_argument("--descriptions-output", default="data/rio_entity_descriptions.json",
                   dest="descriptions_output")
```

- [ ] **Step 4: Rodar e ver passar**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -k descriptions_output_default -v`
Expected: PASS (1 passed)

- [ ] **Step 5: Reescrever `main()` para dois artefatos** (substituir do `out_path = Path(args.output)` até o `return 0`)

```python
    # --- saída 1: curations ---
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    curations = []
    done_ids = set()
    if out_path.exists():
        curations = json.loads(out_path.read_text(encoding="utf-8"))
        done_ids = {c.get("entity_id") for c in curations}

    # --- saída 2: entity descriptions ---
    desc_path = Path(args.descriptions_output)
    desc_path.parent.mkdir(parents=True, exist_ok=True)
    descriptions = []
    done_desc_ids = set()
    if desc_path.exists():
        descriptions = json.loads(desc_path.read_text(encoding="utf-8"))
        done_desc_ids = {d.get("entity_id") for d in descriptions}

    done = done_ids | done_desc_ids
    for i, e in enumerate(entities, 1):
        eid = e.get("entity_id") or e.get("_id")
        if eid in done:
            print(f"[{i}/{len(entities)}] {e.get('name')} — já feito, pulando")
            continue
        print(f"[{i}/{len(entities)}] {e.get('name')} …", end="", flush=True)
        try:
            cur, patch = research_entity(e, client, model, args.per_query_results, vocabulary=vocabulary)
        except Exception as exc:
            print(f" ERRO: {exc}")
            cur, patch = None, None
        if cur:
            curations.append(cur)
        if patch:
            descriptions.append(patch)
        n_cats = len(cur["categories"]) if cur else 0
        has_desc = "desc" if patch else "—"
        print(f" ok ({n_cats} categorias, {has_desc})" if (cur or patch) else " sem conceitos")
        out_path.write_text(json.dumps(curations, ensure_ascii=False, indent=2), encoding="utf-8")
        desc_path.write_text(json.dumps(descriptions, ensure_ascii=False, indent=2), encoding="utf-8")
        time.sleep(args.sleep)

    print(f"\nSalvo: {out_path}  ({len(curations)} curadorias)")
    print(f"Salvo: {desc_path}  ({len(descriptions)} descriptions)")
    print("Revisar e depois importar com:")
    print(f"  ./concierge-api-v3/venv/bin/python scripts/python-tools/import_curations.py "
          f"--input {out_path} --keep-entity-id --apply")
    print(f"  ./concierge-api-v3/venv/bin/python scripts/python-tools/import_entities.py "
          f"--input {desc_path} --apply")
    return 0
```

- [ ] **Step 6: Rodar a suíte inteira**

Run: `./concierge-api-v3/venv/bin/python -m pytest scripts/python-tools/tests/test_research_curations.py -q`
Expected: PASS (todos)

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(research): main grava curations + entity descriptions (2 artefatos)"
```

---

### Task 6: Smoke test real (rede + DeepSeek) e checkpoint

**Files:**
- Nenhum arquivo novo. Requer `DEEPSEEK_API_KEY` e `MONGODB_URL` no `.env`.

- [ ] **Step 1: Rodar em 3 entidades reais (arquivo novo p/ não colidir com o piloto anterior)**

Run:
```bash
./concierge-api-v3/venv/bin/python scripts/python-tools/research_curations.py \
    --city Rio --limit 3 \
    --output data/rio_curations_research_v3.json \
    --descriptions-output data/rio_entity_descriptions_v3.json
```
Expected: processa 3 entidades; cria os dois arquivos.

- [ ] **Step 2: Inspecionar as duas saídas**

Run:
```bash
./concierge-api-v3/venv/bin/python -c "import json; c=json.load(open('data/rio_curations_research_v3.json')); print('curations', len(c)); print('transcript[0][:300]:', c[0]['transcript'][:300]); d=json.load(open('data/rio_entity_descriptions_v3.json')); print('descriptions', len(d)); print(json.dumps(d[:2], ensure_ascii=False, indent=2))"
```
Expected: `transcript` visivelmente limpo (sem nav/rating repetido); `descriptions` com `{entity_id, name, type, data:{description}}` em PT, aterradas.

- [ ] **Step 3: Revisão humana (checkpoint)**

Parar aqui. Revisar juntos: transcript ficou limpo? descriptions são factuais e sem invenção? Ajustar regras de limpeza (Task 1) ou o prompt de description (Task 2) e re-rodar se necessário. Só escalar após aprovação.

---

## Self-Review

**1. Cobertura do spec:** limpeza heurística (T1), transcript = texto limpo (T4 usa `clean_scraped_text` antes do bloco; T6 verifica), LLM 1 chamada `{categories, description}` (T2), description PT aterrada + vazio quando sem evidência (T2), patch `{entity_id,name,type,data:{description}}` p/ deep-merge (T3), research_entity devolve `(curation, patch)` independentes (T4), dois artefatos + cache combinado + comandos de import (T5), smoke + checkpoint (T6). ✔

**2. Placeholders:** nenhum "TBD/TODO"; todo passo de código mostra o código completo. ✔

**3. Consistência de tipos:** `clean_scraped_text(str)->str`, `extract_concepts_llm(...)->{"categories","description"}`, `build_entity_patch(entity,str)->dict`, `research_entity(...)->(curation|None, patch|None)`, `parse_args().descriptions_output` — usados com as mesmas assinaturas em produção e nos testes. `categories`/`price_range`/vocab preservados de Task 2 anterior. ✔

**Nota de dependência:** import final de descriptions usa `import_entities.py --apply` (deep-merge confirmado em `bulk_upsert_entities`). Embeddings continuam fora de escopo.
