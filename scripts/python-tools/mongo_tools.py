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
