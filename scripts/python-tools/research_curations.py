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


def extract_concepts_llm(
    research_block: str,
    entity_name: str,
    client,
    model: str,
    vocabulary: Dict[str, List[str]] | None = None,
) -> Dict[str, List[str]]:
    cats = ", ".join(TARGET_CATEGORIES)
    price_scale = " | ".join(PRICE_RANGE_SCALE)
    system = (
        "You extract structured concept tags about a restaurant from web-researched "
        "text. Rules: use ONLY information explicitly supported by the text; if a "
        "category has no evidence, omit it; NEVER invent. Output ALL tag values in "
        "ENGLISH, lowercase, as short tags of 1-3 words — never full sentences, never a "
        "website's navigation labels, never raw menu prices. Reply with a single JSON "
        "object only."
    )
    semantics = (
        "Category meanings:\n"
        "- cuisine: kind of cuisine (italian, japanese, brazilian, wine bar) — NOT an "
        "aggregator's navigation label.\n"
        "- menu: specific dishes/items served (pasta, oysters, feijoada).\n"
        "- food_style: preparation/style (slow food, casual food, gourmet, traditional).\n"
        "- drinks: beverages offered (wine list, craft beers, signature cocktails).\n"
        "- setting: physical space/decor (terrace, open kitchen, upscale, rustic).\n"
        "- mood: the vibe/atmosphere (lively, cozy, romantic, formal).\n"
        "- crowd: WHO goes there (tourists, locals, families, executives, young) — never "
        "vibe words.\n"
        "- suitable_for: occasions (dating, business lunches, celebrations, quick bite).\n"
        "- special_features: services/amenities (delivery, valet parking, reservations "
        "recommended).\n"
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
        'Return JSON shaped as {"category": ["tag", ...]} with only categories that have '
        "explicit support in the text.\n\n"
        f"RESEARCHED TEXT:\n{research_block}"
    )
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0,
    )
    content = resp.choices[0].message.content
    return clean_llm_categories(_parse_json_object(content))


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


def research_entity(
    entity: Dict[str, Any],
    client,
    model: str,
    per_query_results: int = 5,
    vocabulary: Dict[str, List[str]] | None = None,
) -> Dict[str, Any] | None:
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
    categories = extract_concepts_llm(
        block, entity.get("name") or "", client, model, vocabulary=vocabulary
    )
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
            cur = research_entity(e, client, model, args.per_query_results, vocabulary=vocabulary)
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
