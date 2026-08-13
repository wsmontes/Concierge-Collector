"""
File: app/core/index_specs.py
Purpose: FONTE ÚNICA das specs de índices do MongoDB. Usada por:
         - app/core/database.py:_ensure_indexes (todas EXCETO o TTL);
         - app/core/lifespan.py (TTL de capture_sessions, 48h);
         - scripts/python-tools/db_rebuild.py (todas as 21).
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
    ("entities", "entity_id", {}),
    ("entities", [("name", "text")], {}),
    # REALIDADE DOS DADOS (ago/2026): ~21k entities com externalId EXPLÍCITO
    # null (sparse não exclui null, só campo ausente), 16 pares de externalId
    # string duplicados (mesma praça em importações diferentes) e place_ids
    # duplicados x2. Com unique+sparse esses índices NUNCA construíam:
    # startup falhava a cada deploy e os lookups do enriquecimento do Google
    # Places (llm_place_service: find_one por externalId/place_id) rodavam
    # sem índice. Unicidade nunca existiu na prática — manter unique é só
    # ruído; índices simples devolvem o lookup indexado. Deduplicar os twins
    # é decisão de dados (qual doc é autoritativo), não de índice.
    ("entities", "externalId", {}),
    ("entities", "data.place_id", {}),
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
    ("curations", "curation_id", {}),
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
