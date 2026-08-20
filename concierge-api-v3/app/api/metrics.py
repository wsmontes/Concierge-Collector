"""Authenticated Prometheus metrics endpoint."""

from fastapi import APIRouter, Request
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.core.observability import metrics_authorized

router = APIRouter(tags=["operations"])


@router.get("/metrics", include_in_schema=False)
def metrics(request: Request):
    metrics_authorized(request)
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
