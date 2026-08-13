"""
File: app/core/vector_packing.py
Purpose: Implementação ÚNICA do empacotamento float32 de vetores de embedding
         (Binary subtype 0, little-endian) — ~6KB para 1536d vs ~20KB do array
         de doubles no BSON (o formato de lista estourou a cota do Atlas em
         2026-08-12). Usada pela API (app/api/curations.py) e pelos scripts
         locais (scripts/python-tools/mongo_tools.py re-exporta daqui).
Nota: o Atlas Vector Search não indexa o Binary subtype 0 genérico usado aqui
     — exige o formato de vetor BSON dedicado do Atlas. Se um dia o índice for
     reabilitado, confira o subtype suportado na doc atual do Atlas e migre o
     formato; enquanto isso a busca semântica roda com score em Python (ver
     fallback em app/api/curations.py).
Regra: NÃO adicionar dependências do resto do app aqui — os scripts importam
       este módulo sem o pacote completo (veja mongo_tools.py).
"""
import struct

from bson import Binary


def pack_vector(values):
    """Empacota um vetor (lista/tupla de floats) como Binary float32.

    Vetores já empacotados (bytes) passam direto. Qualquer outro tipo (dict,
    str, ndarray) levanta TypeError — um dict iteraria as CHAVES e empacotaria
    lixo silenciosamente."""
    if isinstance(values, bytes):
        return values
    if not isinstance(values, (list, tuple)):
        raise TypeError(
            f"vetor deve ser lista/tupla de floats, recebeu {type(values).__name__}"
        )
    arr = [float(x) for x in values]
    return Binary(struct.pack("<%df" % len(arr), *arr), subtype=0)


def try_pack_vector(values):
    """pack_vector sem levantar: None para ausente/vazio/malformado/fora da
    faixa float32. Política única de 'empacota ou mantém como veio' — usada
    pela API (fronteira de escrita do PATCH) e pelo db_rebuild (restore)."""
    if isinstance(values, bytes):
        return values
    if not isinstance(values, (list, tuple)) or not values:
        return None
    try:
        return pack_vector(values)
    except (TypeError, ValueError, OverflowError):
        return None
