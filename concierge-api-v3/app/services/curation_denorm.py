"""Denormaliza city/type da entity na curadoria para filtro/paginação server-side."""

import re
from typing import Any, Dict, Optional

# Padrão brasileiro de endereço completo: "... , Cidade - UF" (opcionalmente
# seguido de CEP e país). Ex.: "R. Oscar Freire, 533 - Jardins, São Paulo - SP,
# 01426-001, Brazil". Group 1 captura a cidade sem o sufixo.
_CITY_BR_SUFFIX_RE = re.compile(r",\s*([^,]+?)\s*-\s*[A-Z]{2}(?:\s*,\s*\d{5}[-–—]\d{3}|\s*,|\s*$)")


def city_from_address_string(value: Any) -> Optional[str]:
    """Extrai a cidade de uma string de endereço completo (best-effort).

    Usado como fallback para entities criadas pelo fluxo Google Places (v3),
    que guardam o endereço inteiro em `formatted_address`/`address.street`
    sem campo de cidade estruturado. Só cobre o padrão "Cidade - UF"; para
    formatos não brasileiros retorna None (sem risco de cidade errada).
    """
    if not isinstance(value, str) or not value.strip():
        return None
    match = _CITY_BR_SUFFIX_RE.search(value)
    return match.group(1).strip() if match else None


def denormalize_curation_location(entity: Dict[str, Any]) -> Dict[str, Any]:
    """Extrai city/type da entity para denormalizar na curadoria.

    Retorna sempre ambas as chaves; valores ausentes viram None para que
    MongoDB $set limpe campos stale quando a entity linkada mudar.

    Cadeia de fallback de city (os shapes de entity divergem por origem):
    data.location.city (bulk OSM/Overture) → data.address.city (v3 Places) →
    parse de data.address.street → parse de data.formatted_address.
    """
    if not isinstance(entity, dict):
        return {"city": None, "type": None}
    etype = entity.get("type")
    type_val = etype.strip() if isinstance(etype, str) and etype.strip() else None

    data = entity.get("data") or {}
    location = data.get("location") or {}
    address = data.get("address") or {}
    city = (
        location.get("city")
        or address.get("city")
        or city_from_address_string(address.get("street"))
        or city_from_address_string(data.get("formatted_address"))
    )
    city_val = city.strip() if isinstance(city, str) and city.strip() else None
    return {"city": city_val, "type": type_val}
