import json as _json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from research_curations import (  # noqa: E402
    build_queries,
    build_research_block,
    clean_llm_categories,
    clean_scraped_text,
    build_curation,
    build_vocabulary,
    snap_price_range,
    extract_concepts_llm,
    search_web,
    scrape_url,
    research_entity,
)


# --- Task 1: build_queries ---------------------------------------------------

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


# --- Task 2: build_research_block --------------------------------------------

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


# --- Task 3: clean_llm_categories + build_curation ---------------------------

def test_clean_llm_categories_lowercases_dedups_and_drops_bad_price_range():
    raw = {
        "cuisine": ["Italian", "italian", ""],   # dedup + lowercase
        "mood": [],
        "lixo_inventado": ["x"],                 # chave fora do alvo
        "price_range": ["Preço justo"],          # fora da escala -> descartado
    }
    out = clean_llm_categories(raw)
    assert out == {"cuisine": ["italian"]}


def test_clean_llm_categories_snaps_valid_price_range():
    out = clean_llm_categories({"price_range": ["Moderate"]})
    assert out == {"price_range": ["mid-range"]}


# --- Vocabulário controlado (das curadorias humanas) -------------------------

def test_snap_price_range_maps_synonyms_to_closed_scale():
    assert snap_price_range(["Mid-Range"]) == ["mid-range"]
    assert snap_price_range(["moderate"]) == ["mid-range"]
    assert snap_price_range(["cheap", "budget"]) == ["unexpensive"]   # dedup
    assert snap_price_range(["expensive", "pricey"]) == ["expensive"]
    assert snap_price_range(["$$", "preço justo"]) == []             # desconhecidos caem


def test_build_vocabulary_aggregates_humans_lowercased_by_frequency():
    curations = [
        {"curator_id": "wagner@x.com",
         "categories": {"cuisine": ["Italian", "Bar"], "price_range": ["mid-range"]}},
        {"curator_id": "wagner@x.com",
         "categories": {"cuisine": ["italian"], "mood": ["Cozy"]}},
        {"curator_id": "curator-ai-research",   # automação -> ignorada
         "categories": {"cuisine": ["should-be-ignored"]}},
    ]
    vocab = build_vocabulary(curations)
    assert vocab["cuisine"] == ["italian", "bar"]   # italian (2x) antes de bar (1x), lowercase
    assert vocab["mood"] == ["cozy"]
    assert "should-be-ignored" not in vocab["cuisine"]
    assert "lixo" not in vocab                        # só chaves em TARGET_CATEGORIES


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


# --- Task 4: extract_concepts_llm (fake client) ------------------------------

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
    payload = _json.dumps({"cuisine": ["Japanese"], "lixo": ["x"], "mood": []})
    client = _FakeClient(payload)
    out = extract_concepts_llm("--- FONTE: a ---\nsushi", "Sushi X", client, "deepseek-chat")
    assert out == {"cuisine": ["japanese"]}  # inglês minúsculo, normalizado
    # prompt precisa conter instrução grounded e o nome da entidade
    sent = client.last_kwargs["messages"][-1]["content"]
    assert "Sushi X" in sent


def test_extract_concepts_llm_handles_bad_json():
    client = _FakeClient("desculpa, não achei nada")
    out = extract_concepts_llm("texto", "X", client, "deepseek-chat")
    assert out == {}


def test_extract_concepts_llm_injects_vocabulary_and_price_scale():
    client = _FakeClient(_json.dumps({"cuisine": ["italian"]}))
    vocab = {"cuisine": ["italian", "japanese"], "mood": ["cozy"]}
    extract_concepts_llm("texto", "X", client, "deepseek-chat", vocabulary=vocab)
    sent = client.last_kwargs["messages"][-1]["content"]
    # vocabulário preferido injetado no prompt
    assert "italian" in sent and "japanese" in sent and "cozy" in sent
    # escala fechada de price_range presente
    assert "unexpensive" in sent and "mid-range" in sent and "expensive" in sent


# --- Task 5: search_web + scrape_url (injected doubles) ----------------------

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


# --- Task 6: research_entity (end to end with fakes) -------------------------

def test_research_entity_end_to_end_with_fakes():
    entity = {"_id": "overture_x", "entity_id": "overture_x", "name": "Trattoria Y",
              "data": {"location": {"city": "Rio de Janeiro"}}}

    payload = _json.dumps({"cuisine": ["Italian"], "price_range": ["Mid-Range"]})
    client = _FakeClient(payload)

    def fake_search(query, max_results, searcher=None):
        return ["https://a.com"]

    def fake_scrape(url, fetcher=None):
        return "Comida italiana, ambiente aconchegante."

    import research_curations as rc
    rc.search_web = fake_search
    rc.scrape_url = fake_scrape

    cur = research_entity(entity, client, "deepseek-chat")
    assert cur["entity_id"] == "overture_x"
    assert cur["categories"] == {"cuisine": ["italian"], "price_range": ["mid-range"]}
    assert cur["sources"]["web_research"] == ["https://a.com"]


def test_research_entity_forwards_vocabulary(monkeypatch):
    import research_curations as rc
    monkeypatch.setattr(rc, "search_web", lambda q, max_results, searcher=None: ["https://a.com"])
    monkeypatch.setattr(rc, "scrape_url", lambda url, fetcher=None: "texto")

    captured = {}

    def fake_extract(block, name, client, model, vocabulary=None):
        captured["vocab"] = vocabulary
        return {"cuisine": ["italian"]}

    monkeypatch.setattr(rc, "extract_concepts_llm", fake_extract)

    entity = {"_id": "x", "entity_id": "x", "name": "X", "data": {}}
    vocab = {"cuisine": ["italian"]}
    rc.research_entity(entity, client=None, model="m", vocabulary=vocab)
    assert captured["vocab"] == vocab


def test_research_entity_returns_none_without_concepts():
    entity = {"_id": "z", "entity_id": "z", "name": "Nada", "data": {}}
    client = _FakeClient("{}")
    import research_curations as rc
    rc.search_web = lambda q, max_results, searcher=None: ["https://a.com"]
    rc.scrape_url = lambda url, fetcher=None: "texto"
    assert research_entity(entity, client, "deepseek-chat") is None


# --- Task 1: clean_scraped_text -------------------------------------------------

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
