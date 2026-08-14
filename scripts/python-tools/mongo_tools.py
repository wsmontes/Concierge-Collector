#!/usr/bin/env python3
"""
File: mongo_tools.py
Purpose: Helpers compartilhados pelos scripts locais de scripts/python-tools
         (db_rebuild.py, backfill_embeddings.py, data_cleanup.py):
         carregamento do .env com precedência seletiva, conexão ao Mongo e
         re-export do empacotamento float32 de vetores (implementação única,
         na árvore da API: app/core/vector_packing.py).
Dependencies: pymongo, bson (venv de concierge-api-v3)
"""
import os
import sys

import pymongo

# A implementação única do formato de vetor vive na árvore da API; este módulo
# injeta a raiz da API no path e re-exporta a função. app/core/vector_packing.py
# NÃO pode ganhar dependências do resto do app (os scripts não o importam junto
# com o pacote completo).
API_ROOT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "concierge-api-v3"
)
if API_ROOT not in sys.path:
    sys.path.insert(0, API_ROOT)

from app.core.vector_packing import (  # noqa: E402  (re-export)
    DEFAULT_EMBEDDING_DIMENSIONS,
    pack_vector,
    try_pack_vector,
)

ENV_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "concierge-api-v3", ".env"
)
DEFAULT_DB_NAME = "concierge-collector"
SERVER_SELECTION_TIMEOUT_MS = 20000

# O perfil do shell exporta OPENAI_BASE_URL=http://localhost:1234/v1 e
# OPENAI_API_KEY=lm-studio (LM Studio), que sequestram o SDK da OpenAI — para
# essas chaves o .env TEM precedência. Para o resto (ex.: MONGODB_URL), um
# valor exportado no shell é intenção explícita do operador (ex.: testar um
# comando destrutivo contra um cluster scratch) e VENCE — sobrescrever
# silenciosamente retargetaria wipe/restore para produção.
OVERWRITE_KEYS = ("OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL")


def load_env(path=None, always_env=()):
    """Carrega variáveis do .env: sobrescreve o shell nas chaves OPENAI_*
    (sombra do LM Studio) e nas chaves de always_env — cada script declara sua
    política; nas demais usa setdefault (override explícito do shell vence).
    Retorna a lista de chaves lidas DO ARQUIVO (permite ao chamador distinguir
    'vinda do .env' de 'herdada do shell').

    always_env: ex., backfill passa ('MONGODB_URL', 'MONGODB_DB_NAME') — um
    MONGODB_URL obsoleto no shell não pode retargetar o backfill; scripts
    destrutivos (db_rebuild, data_cleanup) NÃO passam e preservam a intenção
    explícita do operador (ex.: testar contra cluster scratch)."""
    path = path or ENV_PATH
    loaded = []
    if not os.path.isfile(path):
        # arquivo ausente = no-op: CI/workflows com MONGODB_URL exportada no
        # shell funcionam sem .env local (connect() depende disso)
        return loaded
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            valor = v.strip().strip('"')
            loaded.append(k)
            if k in OVERWRITE_KEYS or k in always_env:
                os.environ[k] = valor
            else:
                os.environ.setdefault(k, valor)
    return loaded


def connect():
    """Conecta ao MongoDB usando MONGODB_URL/MONGODB_DB_NAME do .env.

    Retorna (client, db) após um ping — falha cedo se o cluster não responde."""
    load_env()
    client = pymongo.MongoClient(
        os.environ["MONGODB_URL"],
        serverSelectionTimeoutMS=SERVER_SELECTION_TIMEOUT_MS,
    )
    db = client[os.environ.get("MONGODB_DB_NAME", DEFAULT_DB_NAME)]
    client.admin.command("ping")
    return client, db


def dedupe_entity_twins(db, apply=False, backup_dir=None):
    """Deduplica pares de entities gêmeas (mesmo externalId ou data.place_id de
    importações diferentes) NO BANCO VIVO. Regra do keeper, por par:
    1) doc com curadoria `linked` vence; 2) desempate: curadoria `draft`;
    3) desempate: mais campos em `data`; 4) desempate: `updatedAt` mais
    recente; 5) desempate final: `_id` (determinístico).
    Curadorias do perdedor são repontadas para o `entity_id` do keeper (com
    version+1 e updatedAt novo — o frontend sincroniza por If-Match). O
    perdedor é deletado APÓS backup JSON dos 32 docs + curadorias afetadas em
    `data/backups/` (gitignored). Com apply=False é read-only: só imprime o
    plano. Retorna o plano."""
    import json
    from datetime import datetime, timezone

    def _dup_groups(field):
        return list(db.entities.aggregate([
            {"$match": {field: {"$type": "string"}}},
            {"$group": {"_id": f"${field}", "ids": {"$addToSet": "$_id"}, "n": {"$sum": 1}}},
            {"$match": {"n": {"$gt": 1}}},
        ]))

    groups = _dup_groups("externalId") + _dup_groups("data.place_id")
    involved = set()
    for g in groups:
        if g["n"] > 2:
            print(f"⚠️ Grupo com {g['n']} docs na chave {g['_id']!r} — dedupe"
                  " assumia pares; ignorando grupo.")
            continue
        involved.update(g["ids"])

    docs = list(db.entities.find({"_id": {"$in": list(involved)}}))
    by_id = {d["_id"]: d for d in docs}
    chaves = {}
    for g in groups:
        for i in g["ids"]:
            chaves.setdefault(i, set()).add(str(g["_id"]))

    pairs = []
    emparelhados = set()
    for i, a in enumerate(docs):
        if a["_id"] in emparelhados:
            continue
        for b in docs[i + 1:]:
            if b["_id"] in emparelhados:
                continue
            if chaves.get(a["_id"], set()) & chaves.get(b["_id"], set()):
                pairs.append((a, b))
                emparelhados.update((a["_id"], b["_id"]))
                break

    def _score(d):
        slug = d.get("entity_id")
        linked = db.curations.count_documents(
            {"entity_id": slug, "status": {"$nin": ["deleted", "draft"]}})
        drafts = db.curations.count_documents(
            {"entity_id": slug, "status": "draft"})
        return (linked, drafts, len(d.get("data", {})), str(d.get("updatedAt") or ""))

    plano = []
    for a, b in pairs:
        # max com desempate determinístico por _id
        keeper, loser = (a, b) if _score(a) >= _score(b) else (b, a)
        if _score(a) == _score(b):
            keeper, loser = (a, b) if str(a["_id"]) <= str(b["_id"]) else (b, a)
        plano.append({"keeper": keeper, "loser": loser,
                      "scores": {str(a["_id"]): _score(a), str(b["_id"]): _score(b)}})

    if not apply:
        for p in plano:
            k, l = p["keeper"], p["loser"]
            sk = p["scores"][str(k["_id"])]
            sl = p["scores"][str(l["_id"])]
            print(f"KEEP  {k.get('entity_id','')[:46]:46} (linked={sk[0]}, draft={sk[1]}, keys={sk[2]})")
            print(f"DROP  {l.get('entity_id','')[:46]:46} (linked={sl[0]}, draft={sl[1]}, keys={sl[2]})")
        print(f"\nTotal: {len(plano)} pares — nada aplicado (apply=False)")
        return plano

    # ── apply ──────────────────────────────────────────────────────────────
    backup_dir = backup_dir or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "backups")
    os.makedirs(backup_dir, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    backup_path = os.path.join(backup_dir, f"entity-twins-dedup-{stamp}.json")
    slugs = {d.get("entity_id") for d in docs}
    afetadas = list(db.curations.find({"entity_id": {"$in": list(slugs)}}))
    with open(backup_path, "w", encoding="utf-8") as f:
        json.dump({"entities": docs, "curations": afetadas}, f, default=str)
    print(f"Backup: {backup_path} ({len(docs)} entities, {len(afetadas)} curations)")

    now = datetime.now(timezone.utc)
    for p in plano:
        k, l = p["keeper"], p["loser"]
        if l.get("entity_id") and l["entity_id"] != k.get("entity_id"):
            res = db.curations.update_many(
                {"entity_id": l["entity_id"]},
                {"$set": {"entity_id": k["entity_id"], "updatedAt": now},
                 "$inc": {"version": 1}})
            print(f"  repoint {l['entity_id']} → {k['entity_id']}: {res.modified_count} curations")
        res = db.entities.delete_one({"_id": l["_id"]})
        print(f"  DROP {l.get('entity_id','')[:46]} — deleted={res.deleted_count}")
    print(f"Concluído: {len(plano)} losers removidos")
    return plano
