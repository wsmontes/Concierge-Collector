"""
Endpoint de og:image dos cards do Collector — devolve a imagem
redimensionada em real-time.

O browser não pode buscar HTML de domínios arbitrários (CORS) e as
imagens OG originais têm megabytes; este endpoint resolve a meta tag
og:image do site, baixa a imagem com o SSRF guard do openai_service,
redimensiona (JPEG ~768px) e devolve os bytes com Cache-Control de 1h
(o cliente também persiste em Cache Storage). Sem og:image/download
falho → 404; URL inválida/rede interna → 400.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.core.security import require_role
from app.services.og_image_service import get_og_image_bytes, get_og_stats

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/og-image/stats")
async def og_image_stats(auth: dict = Depends(require_role("curator"))):
    """Métricas de cobertura do véu: quantos resolvem por fonte
    (og vs places), cache hits e cards sem imagem (em memória)."""
    return get_og_stats()


@router.get("/og-image")
async def get_og_image(
    url: Optional[str] = Query(
        None,
        min_length=10,
        max_length=2048,
        description="URL do site do restaurante",
        example="https://www.manimanioca.com.br",
    ),
    place_id: Optional[str] = Query(
        None,
        min_length=5,
        max_length=512,
        description="Google place_id — fallback quando o site não tem og:image",
        example="ChIJR9vPqUpfzpQR9qTmaP7mN7E",
    ),
    auth: dict = Depends(require_role("curator")),
):
    """Devolve o JPEG redimensionado (og:image do site ou foto do
    Google Places como fallback) — 404 quando nenhuma fonte tem imagem.

    Fonte primária: og:image da URL. Sem resultado e com place_id,
    cai para a primeira foto do Google Places. Resposta: imagem JPEG
    com `Cache-Control: public, max-age=3600` (o cliente persiste em
    Cache Storage e revalida por TTL)."""
    try:
        result = await get_og_image_bytes(page_url=url, place_id=place_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if result is None:
        raise HTTPException(status_code=404, detail="imagem não encontrada (og:image e Places sem resultado)")

    data, content_type = result
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=3600"},
    )
