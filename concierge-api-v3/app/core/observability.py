"""Correlation and low-cardinality operational metrics for the API."""

from __future__ import annotations

from contextvars import ContextVar
import logging
import re
import secrets
import time
import uuid

from fastapi import HTTPException, Request
from prometheus_client import Counter, Histogram

from app.core.config import settings

REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
request_id_var: ContextVar[str] = ContextVar("request_id", default="")

# Never use URLs, user identifiers, curation ids or exception text as labels.
http_requests_total = Counter(
    "concierge_api_http_requests_total",
    "HTTP requests handled by the Concierge API",
    ("method", "route", "status"),
)
http_request_duration_seconds = Histogram(
    "concierge_api_http_request_duration_seconds",
    "HTTP request duration by stable route",
    ("method", "route", "status"),
)

_SENSITIVE = re.compile(
    r"(?i)(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+|"
    r"(x-(?:api|cms-service|metrics)-key\s*[:=]\s*)[^\s,;]+|"
    r"((?:token|secret|password)\s*[:=]\s*)[^\s,;]+|"
    # Chave em QUERY (Google Places entrega a chave como `?key=...` — formato
    # documentado do endpoint dele). Sem esta linha, a linha de log do httpx com a
    # URL completa vaza a chave da API no log do Render; foi medido num teste, e o
    # log de produção é exatamente o mesmo caminho.
    r"([?&](?:key|api_key|apikey|access_key)=)[^\s&,;]+"
)


def redact_text(value: object) -> str:
    """Return a string safe for operational logs without parsing request bodies."""

    return _SENSITIVE.sub(r"\1\2\3[REDACTED]", str(value))


class SecretRedactionFilter(logging.Filter):
    """Redact the message at handler time, including third-party loggers."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact_text(record.getMessage())
        record.args = ()
        return True


def install_log_redaction() -> None:
    """Manda o filtro para os HANDLERS, que é onde todo registro passa.

    A primeira versão instalava o filtro no logger raiz. Isso não funciona para o
    caso que importa: `Logger.filter()` só é consultado para registros emitidos
    DIRETAMENTE naquele logger — um registro de logger filho (`httpx`,
    `uvicorn.access`) sobe por `propagate` e nunca passa pelos filtros do
    ancestral. O vazamento da chave do Places na linha do httpx é a prova
    (medido num teste desta sessão). Handler é o único ponto por onde todo
    registro passa, então é ali que o filtro vive.
    """
    filt = SecretRedactionFilter()
    root = logging.getLogger()
    targets = [
        root,
        logging.getLogger("uvicorn"),
        logging.getLogger("uvicorn.error"),
        logging.getLogger("uvicorn.access"),
    ]
    handlers = [handler for logger in targets for handler in logger.handlers]
    if not handlers:
        # Sem handler nenhum (o caso de um processo de teste que ainda não
        # configurou logging) o filtro não teria onde viver: instala um.
        fallback = logging.StreamHandler()
        root.addHandler(fallback)
        handlers = [fallback]
    for handler in handlers:
        if not any(isinstance(item, SecretRedactionFilter) for item in handler.filters):
            handler.addFilter(filt)

    # Segunda tranca: o httpx loga a request line inteira em INFO (URL, query e
    # tudo). O filtro já redige o segredo; silenciar tira o ruído e reduz a
    # superfície a um nível que ninguém precisa ler.
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def request_id_from_request(request: Request) -> str:
    candidate = request.headers.get("x-request-id", "")
    return candidate if REQUEST_ID_RE.fullmatch(candidate) else str(uuid.uuid4())


def _metric_route(request: Request) -> str:
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) else "unmatched"


async def request_context_middleware(request: Request, call_next):
    request_id = request_id_from_request(request)
    token = request_id_var.set(request_id)
    started = time.perf_counter()
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        response.headers["X-Request-Id"] = request_id
        return response
    finally:
        elapsed = max(0.0, time.perf_counter() - started)
        labels = {"method": request.method, "route": _metric_route(request), "status": str(status)}
        http_requests_total.labels(**labels).inc()
        http_request_duration_seconds.labels(**labels).observe(elapsed)
        request_id_var.reset(token)


def metrics_authorized(request: Request) -> None:
    supplied = request.headers.get("x-metrics-key", "")
    if not supplied or not secrets.compare_digest(supplied, settings.metrics_key_value):
        raise HTTPException(status_code=401, detail="Metrics authorization required")
