"""Denormaliza city/type da entity na curadoria para filtro/paginação server-side."""
from typing import Any, Dict


def denormalize_curation_location(entity: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(entity, dict):
        return {}
    out: Dict[str, Any] = {}
    etype = entity.get("type")
    if isinstance(etype, str) and etype.strip():
        out["type"] = etype.strip()
    city = ((entity.get("data") or {}).get("location") or {}).get("city")
    if isinstance(city, str) and city.strip():
        out["city"] = city.strip()
    return out
