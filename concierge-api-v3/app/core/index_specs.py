"""
File: app/core/index_specs.py
Purpose: FONTE ÚNICA das specs de índices do MongoDB. Usada por:
         - app/core/database.py:_ensure_indexes (todas EXCETO o TTL);
         - app/core/lifespan.py (TTL de capture_sessions, 48h);
         - scripts/python-tools/db_rebuild.py (todas as 19).
         Antes havia duas listas hand-maintained (18 vs 19 specs) com risco de
         deriva silenciosa — a classe exata do incidente 2026-08-12 (entities
         rodando com 4 de 10 índices).
Regra: NÃO adicionar dependências do resto do app aqui (os scripts importam
       este módulo sem o pacote completo, via mongo_tools.py).
"""
# (coleção, chaves, kwargs extras)
INDEX_SPECS = [
    # ── Entities ────────────────────────────────────────────────────────────
    # Simple indexes
    ("entities", "type", {}),
    ("entities", "name", {}),
    ("entities", "createdAt", {}),
    ("entities", [("name", "text")], {}),
    # Uniqueness guards
    ("entities", "externalId", {"unique": True, "sparse": True}),
    ("entities", "data.place_id", {"unique": True, "sparse": True}),
    # Composite indexes for scale
    # Supports: list with status filter + incremental sync (?since)
    ("entities", [("status", 1), ("updatedAt", -1)], {}),
    # Supports: stable cursor-based pagination on large collections
    ("entities", [("updatedAt", -1), ("_id", 1)], {}),
    # Supports: type filter combined with status
    ("entities", [("type", 1), ("status", 1)], {}),
    # ── Curations ──────────────────────────────────────────────────────────
    # Simple indexes
    ("curations", "entity_id", {}),
    ("curations", "curator.id", {}),
    ("curations", "createdAt", {}),
    ("curations", "city", {}),
    ("curations", "type", {}),
    # Composite indexes for scale
    # Supports: status filter + incremental sync (?since)
    ("curations", [("status", 1), ("updatedAt", -1)], {}),
    # Supports: curations per entity excluding deleted (most common query)
    ("curations", [("entity_id", 1), ("status", 1)], {}),
    # Supports: curations per curator with status filter
    ("curations", [("curator.id", 1), ("status", 1)], {}),
    # Supports: stable cursor-based pagination on large collections
    ("curations", [("updatedAt", -1), ("_id", 1)], {}),
    # ── capture_sessions ───────────────────────────────────────────────────
    # TTL 48h (auto-delete de sessões de captura) — criado pelo lifespan.py
    ("capture_sessions", "createdAt", {"expireAfterSeconds": 172800}),
]
