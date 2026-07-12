"""Denormaliza city/type da entity na curadoria para filtro/paginação server-side."""
from typing import Any, Dict


def denormalize_curation_location(entity: Dict[str, Any]) -> Dict[str, Any]:
    """Extrai city/type da entity para denormalizar na curadoria.

    Retorna sempre ambas as chaves; valores ausentes viram None para que
    MongoDB $set limpe campos stale quando a entity linkada mudar.
    """
    if not isinstance(entity, dict):
        return {"city": None, "type": None}
    etype = entity.get("type")
    type_val = etype.strip() if isinstance(etype, str) and etype.strip() else None
    city = ((entity.get("data") or {}).get("location") or {}).get("city")
    city_val = city.strip() if isinstance(city, str) and city.strip() else None
    return {"city": city_val, "type": type_val}
