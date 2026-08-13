"""
File: app/core/query_utils.py
Purpose: Conversão de after_id para cursor paginado. _id ObjectId (bulk
         imports) NUNCA casa com comparação contra string hex: o Mongo ordena
         por tipo e ObjectId fica fora de $gt/$lt de qualquer string.
         Verificado ao vivo (2026-08-12): entities = 21.150 _id string + 471
         ObjectId; nenhum _id string tem formato 24-hex, então a conversão é
         inequívoca no banco atual.
"""
from bson import ObjectId
from bson.errors import InvalidId


def to_cursor_id(after_id):
    """24-hex → ObjectId (visita os dois tipos de _id na ordem correta);
    senão mantém a string como veio."""
    if isinstance(after_id, str) and len(after_id) == 24:
        try:
            return ObjectId(after_id)
        except InvalidId:
            return after_id
    return after_id
