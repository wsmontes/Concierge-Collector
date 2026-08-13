"""
File: app/core/query_utils.py
Purpose: Conversão de after_id para cursor paginado. _id ObjectId (bulk
         imports) NUNCA casa com comparação contra string hex: o Mongo ordena
         por tipo e ObjectId fica fora de $gt/$lt de qualquer string.
         Verificado ao vivo (2026-08-12): entities = 21.150 _id string + 471
         ObjectId.
"""
from bson import ObjectId
from bson.errors import InvalidId


def resolve_after_id(db, collection_name, after_id):
    """Converte hex → ObjectId SÓ se um doc com esse ObjectId EXISTE na
    coleção — uma string 24-hex legítima (ex.: ObjectId stringificado usado
    como entity_id) nunca é confundida, e o cursor continua visitando as
    strings corretamente. Um lookup indexado por página."""
    if isinstance(after_id, str) and len(after_id) == 24:
        try:
            oid = ObjectId(after_id)
        except InvalidId:
            return after_id
        if db[collection_name].find_one({"_id": oid}, {"_id": 1}):
            return oid
    return after_id
