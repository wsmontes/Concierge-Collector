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
from __future__ import annotations

import argparse
import hashlib
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

# price_range é uma escala fechada nas curadorias humanas (ver memória
# curation-category-vocabulary). O extractor sempre trava nesses 3 valores.
PRICE_RANGE_SCALE = ["unexpensive", "mid-range", "expensive"]
PRICE_RANGE_SYNONYMS = {
    "inexpensive": "unexpensive", "cheap": "unexpensive", "budget": "unexpensive",
    "affordable": "unexpensive", "low": "unexpensive", "low-priced": "unexpensive",
    "mid range": "mid-range", "midrange": "mid-range", "moderate": "mid-range",
    "medium": "mid-range", "average": "mid-range", "reasonable": "mid-range",
    "pricey": "expensive", "high-end": "expensive", "high end": "expensive",
    "upscale": "expensive", "fine dining": "expensive", "very expensive": "expensive",
    "premium": "expensive",
}

# Curadores de automação/import cujos valores NÃO contam como vocabulário humano.
AUTOMATION_CURATOR_MARKERS = ("research", "import", "michelin", "ai-", "curator-json")

CURATOR_ID = "curator-ai-research"
CURATOR_NAME = "AI Web Research"


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


_NAV_TOKENS = {
    "home", "menu", "login", "logout", "sign in", "sign up",
    "buscar", "search", "compartilhar", "share", "contato", "sobre",
    "reservar", "fechar", "close", "faq", "imagens", "avaliações",
}
_BOILERPLATE_PATTERNS = [
    re.compile(r"cookie", re.I),
    re.compile(r"newsletter|assine|subscribe", re.I),
    re.compile(r"último update", re.I),
    re.compile(r"^\s*★?\s*\d+([.,]\d+)?\s*/\s*5"),          # ★ 2.3 / 5
    re.compile(r"\(\s*\d+\s+avalia", re.I),                # (6 Avaliação)
    re.compile(r"^avalia(ç|c)", re.I),                     # Avaliações
    re.compile(r"compartilh|facebook|whatsapp|twitter", re.I),
]


def clean_scraped_text(text: str) -> str:
    """Conservative heuristic cleaning: remove nav/boilerplate/rating lines and dedup, preserve real content."""
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


def snap_price_range(values: List[str]) -> List[str]:
    """Trava valores de price_range na escala fechada (com sinônimos); descarta o resto."""
    out: List[str] = []
    for v in values:
        if not isinstance(v, str):
            continue
        key = v.strip().lower()
        if not key:
            continue
        mapped = PRICE_RANGE_SYNONYMS.get(key)
        if mapped is None and key in PRICE_RANGE_SCALE:
            mapped = key
        if mapped and mapped not in out:
            out.append(mapped)
    return out


def build_vocabulary(
    curations: List[Dict[str, Any]],
    exclude_substrings=AUTOMATION_CURATOR_MARKERS,
) -> Dict[str, List[str]]:
    """Vocabulário controlado por categoria a partir de curadorias HUMANAS.

    Ignora curadorias de automação/import. Valores em minúsculo, ordenados por
    frequência (mais comum primeiro). Só chaves em TARGET_CATEGORIES.
    """
    from collections import Counter

    counters: Dict[str, Counter] = {cat: Counter() for cat in TARGET_CATEGORIES}
    for c in curations:
        if not isinstance(c, dict):
            continue
        curator = c.get("curator") if isinstance(c.get("curator"), dict) else {}
        cid = str(c.get("curator_id") or curator.get("id") or "").lower()
        if any(marker in cid for marker in exclude_substrings):
            continue
        cats = c.get("categories")
        if not isinstance(cats, dict):
            continue
        for cat in TARGET_CATEGORIES:
            values = cats.get(cat)
            if not isinstance(values, list):
                continue
            for v in values:
                if isinstance(v, str) and v.strip():
                    counters[cat][v.strip().lower()] += 1

    vocab: Dict[str, List[str]] = {}
    for cat, counter in counters.items():
        if counter:
            vocab[cat] = [val for val, _ in counter.most_common()]
    return vocab


def clean_llm_categories(raw: Dict[str, Any]) -> Dict[str, List[str]]:
    """Normaliza a saída do LLM: só chaves-alvo, minúsculo, sem duplicatas/vazios.

    `price_range` é travado na escala fechada via snap_price_range.
    """
    if not isinstance(raw, dict):
        return {}
    cleaned: Dict[str, List[str]] = {}
    for key in TARGET_CATEGORIES:
        values = raw.get(key)
        if not isinstance(values, list):
            continue
        vals: List[str] = []
        for v in values:
            if isinstance(v, str) and v.strip():
                tag = v.strip().lower()
                if tag not in vals:
                    vals.append(tag)
        if key == "price_range":
            vals = snap_price_range(vals)
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


def build_entity_patch(entity: Dict[str, Any], description: str) -> Dict[str, Any]:
    return {
        "entity_id": entity.get("entity_id") or entity.get("_id"),
        "name": entity.get("name"),
        "type": entity.get("type"),
        "data": {"description": description},
    }


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


def _format_vocab_block(vocabulary: Dict[str, List[str]], max_per_cat: int = 40) -> str:
    """Bloco compacto de vocabulário preferido por categoria (limitado por categoria)."""
    if not vocabulary:
        return ""
    lines: List[str] = []
    for cat in TARGET_CATEGORIES:
        vals = vocabulary.get(cat)
        if not vals:
            continue
        shown = vals[:max_per_cat]
        lines.append(f"- {cat}: {', '.join(shown)}")
    return "\n".join(lines)


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
    if not isinstance(data, dict):
        return {"categories": {}, "description": ""}
    categories = clean_llm_categories(data.get("categories"))  # safe: clean_llm_categories(None) -> {}
    raw_desc = data.get("description")
    description = (raw_desc or "").strip()[:DESCRIPTION_MAX_CHARS] if isinstance(raw_desc, str) else ""
    return {"categories": categories, "description": description}


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
            import requests
            import trafilatura
            # timeout por fetch: evita travar o run inteiro numa URL que
            # mantém a conexão aberta (ThreadPoolExecutor.map espera todas).
            resp = requests.get(
                u,
                timeout=15,
                headers={"User-Agent": "Mozilla/5.0 (compatible; ConciergeBot/1.0)"},
            )
            if resp.status_code != 200 or not resp.text:
                return ""
            return trafilatura.extract(resp.text) or ""
    try:
        return (fetcher(url) or "").strip()
    except Exception:
        return ""


def scrape_urls(urls: List[str], max_workers: int = 8, scraper=None) -> List[Dict[str, str]]:
    """Baixa várias URLs em paralelo (I/O-bound), preservando a ordem de `urls`.

    `scraper` é injetável (default: scrape_url). Retorna [{"url", "text"}].
    """
    if not urls:
        return []
    if scraper is None:
        scraper = scrape_url
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=min(max_workers, len(urls))) as ex:
        texts = list(ex.map(scraper, urls))
    return [{"url": u, "text": t} for u, t in zip(urls, texts)]


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
    pages = scrape_urls(urls)
    pages = [{"url": p["url"], "text": clean_scraped_text(p["text"])} for p in pages]
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


def metadata_field_count(entity: Dict[str, Any]) -> int:
    """Conta valores-folha não-vazios em entity['data'] (recursivo).

    Densidade de metadados: dict soma as chaves, list soma os itens, escalar
    não-vazio vale 1 (string vazia e None valem 0). Usado para ordenar por
    'mais metadados'.
    """
    def count(v: Any) -> int:
        if isinstance(v, dict):
            return sum(count(x) for x in v.values())
        if isinstance(v, list):
            return sum(count(x) for x in v)
        if v is None:
            return 0
        if isinstance(v, str) and not v.strip():
            return 0
        return 1

    return count((entity.get("data") or {}))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Gera curadorias draft via pesquisa web + LLM")
    p.add_argument("--city", default="Rio", help="Filtro de cidade (regex em data.location.city)")
    p.add_argument("--limit", type=int, default=30, help="Máx. de entidades (0 = todas)")
    p.add_argument("--output", default="data/rio_curations_research.json")
    p.add_argument("--descriptions-output", default="data/rio_entity_descriptions.json",
                   dest="descriptions_output")
    p.add_argument("--per-query-results", type=int, default=5, dest="per_query_results")
    p.add_argument("--sleep", type=float, default=1.0, help="Pausa entre entidades (s)")
    p.add_argument("--sort", choices=["natural", "metadata"], default="natural",
                   help="Ordem das entidades: natural (Mongo) ou metadata (densidade de campos, desc)")
    p.add_argument("--skip-with-description", action="store_true", dest="skip_with_description",
                   help="Não emite patch de description p/ entidades que já têm data.description")
    return p.parse_args()


def load_vocabulary_from_db(db) -> Dict[str, List[str]]:
    """Carrega o vocabulário controlado das curadorias humanas do Mongo."""
    proj = {"categories": 1, "curator": 1, "curator_id": 1, "_id": 0}
    curations = list(db.curations.find({"categories": {"$exists": True}}, proj))
    return build_vocabulary(curations)


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

    vocabulary = load_vocabulary_from_db(db)
    print("Vocabulário (curadorias humanas): "
          + ", ".join(f"{k}={len(v)}" for k, v in vocabulary.items()))

    query = {"type": {"$in": ["restaurant", "bar", "cafe"]}}
    if args.city:
        query["data.location.city"] = {"$regex": args.city, "$options": "i"}
    if args.sort == "metadata":
        entities = list(db.entities.find(query))
        entities.sort(key=metadata_field_count, reverse=True)
        if args.limit:
            entities = entities[:args.limit]
        print(f"{len(entities)} entidades candidatas (top por densidade de metadados)")
    else:
        cursor = db.entities.find(query)
        if args.limit:
            cursor = cursor.limit(args.limit)
        entities = list(cursor)
        print(f"{len(entities)} entidades candidatas")

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

    # Cache combinado: pula entidade já presente em qualquer artefato. Nota: um
    # kill entre as duas escritas pode, no pior caso, perder a description de UMA
    # entidade (a curadoria, escrita antes, é preservada).
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
        if patch and args.skip_with_description:
            existing_desc = ((e.get("data") or {}).get("description") or "").strip()
            if existing_desc:
                patch = None
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


if __name__ == "__main__":
    raise SystemExit(main())
