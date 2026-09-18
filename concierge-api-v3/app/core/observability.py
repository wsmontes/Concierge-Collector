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


def _redact_arg(value: object) -> object:
    """Redige o argumento, preservando o que o FORMATO do log precisa.

    Números ficam intactos porque `%d`/`%f` exigem número — o access log do uvicorn
    passa o status como `int` e o formatter chama `int()` nele. Todo o resto vira
    texto redigido: uma `Exception` que carrega URL com `?key=` é o caso real
    (`auth.py`, `og_image_service.py`), e deixá-la passar intacta por "não ser
    string" devolveria o vazamento que o filtro existe para fechar.
    """
    if value is None or isinstance(value, (int, float, bool)):
        return value
    return redact_text(value)


def _redact_args(args: object) -> object:
    """Redige cada argumento preservando tupla/dicionário e o COMPRIMENTO.

    Comprimento importa: o `AccessFormatter` do uvicorn desempacota
    `record.args` como `(client, método, path, http_version, status)`.
    """
    if isinstance(args, dict):
        return {key: _redact_arg(value) for key, value in args.items()}
    if isinstance(args, tuple):
        return tuple(_redact_arg(item) for item in args)
    return args


class SecretRedactionFilter(logging.Filter):
    """Redact the message at handler time, including third-party loggers.

    A redação NÃO destrói a forma do registro: `msg` continua sendo o formato (com
    `%s`) e `args` continua com o mesmo número de elementos. A versão anterior
    renderizava tudo dentro de `msg` e zerava `args` — e o handler do access log do
    uvicorn desempacota esses args, então zerá-los fazia o `AccessFormatter`
    estourar `ValueError: not enough values to unpack (expected 5, got 0)` a CADA
    requisição, imprimindo um traceback de ~30 linhas no stderr (medido em
    produção e reproduzido local com o uvicorn real). O log ficava ilegível
    justamente no lugar de onde os incidentes são diagnosticados.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact_text(record.msg)
        record.args = _redact_args(record.args)
        return True


def configure_logging() -> None:
    """Faz os logs OPERACIONAIS do processo existirem de verdade.

    Medido em produção (2026-09-17): `LOG_LEVEL=INFO` estava no ambiente e **nada
    o lia**; o root logger não tinha handler nenhum, então todo `logger.info(...)`
    do app era engolido pelo `logging.lastResort` (que só imprime WARNING para
    cima). O custo apareceu no diagnóstico do pipeline de imagem: as linhas
    `display media: entity=… state=… ms=…` — escritas justamente para isso — não
    existiam no log, e um defeito de mídia ficou sem rastro nenhum até ser
    reproduzido no browser.

    Formato deliberadamente magro (nível, logger, mensagem): o log de produção hoje
    mistura uvicorn, supervisord e nginx na mesma linha do tempo, e um prefixo
    longo só empurra a mensagem para fora da tela.
    """
    root = logging.getLogger()
    level = getattr(logging, str(settings.log_level or "INFO").upper(), logging.INFO)
    root.setLevel(level)
    if not any(getattr(handler, "_concierge_root", False) for handler in root.handlers):
        handler = logging.StreamHandler()  # stderr (o Render captura os dois)
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
        handler._concierge_root = True  # type: ignore[attr-defined]
        root.addHandler(handler)
    # O uvicorn tem handlers próprios; sem `propagate=False` cada linha dele sairia
    # duas vezes (a dele e a do root recém-configurado).
    for proprio in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(proprio).propagate = False


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
