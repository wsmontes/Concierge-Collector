"""Display media da Entity: o hero do card resolvido UMA vez e PERSISTIDO.

O card precisa de uma imagem; o que custa caro é DESCOBRIR qual imagem — HTML
do site, og:image, Google Places, download, decode e ranking. Esse custo era
pago a cada request, dentro do render path do card. Aqui ele é pago uma vez e o
RESULTADO fica no documento da Entity, como referência OPACA:

- ``website``       → origem + caminho da imagem do site, sem query nem
  fragment: a URL buscada pode estar assinada, e o que é durável não carrega
  credencial (uma imagem que só funcionava com a assinatura dá 403/404 no
  refetch → ``failed`` com código curto → re-descoberta no próximo ciclo);
- ``google_places`` → somente o nome opaco do Places (``places/...``). A URL
  assinada (``?key=...``) é reconstruída no servidor na hora de buscar e NUNCA
  entra no documento: persistir a URL vazaria a chave da API para qualquer
  leitura do documento.

Bytes de imagem nunca são persistidos (o cluster já estourou quota de storage
uma vez); o que fica é a referência. Persistir os BYTES processados em storage
durável é o passo seguinte deste caminho — hoje não há bucket configurado em
produção, então o caso quente continua no cache de bytes do processo e no Cache
Storage do navegador.

Estados persistidos (``display_media.state``):

- ``resolved``   — referência utilizável; ``expires_at`` = agora + 14d;
- ``no_sources`` — a Entity não tem ``website`` nem ``place_id``: não há o que
  resolver, e por isso a leitura responde 404 com cache longo;
- ``failed``     — tinha fonte e a resolução falhou; ``expires_at`` = agora +
  1h e ``last_error`` é um CÓDIGO CURTO (``timeout``, ``http_404``,
  ``decode_failed``...), nunca URL nem corpo de resposta.

Duas entradas, e só duas — sem poller, sem cron, sem processo novo:

1. o fire-and-forget da leitura (rank 0) quando falta um ``resolved`` fresco;
2. HOOK DE ESCRITA — documentado no bloco abaixo das constantes, não
   implementado (não há event loop nos pontos de escrita).

O disparo é idempotente de propósito: se o processo reiniciar no meio, a Entity
fica sem ``display_media`` (ou com um ``failed`` vencido) e a PRÓXIMA LEITURA
re-enfileira. O estado do documento é a fila; não há fila persistente.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from collections import deque
from typing import Any, Dict, List, Optional, Tuple

from app.core.config import settings
from app.services.og_image_service import (
    get_reference_image_bytes,
    get_restaurant_images,
    persistible_image_reference,
)

logger = logging.getLogger(__name__)

DISPLAY_MEDIA_FIELD = "display_media"

STATE_RESOLVED = "resolved"
STATE_NO_SOURCES = "no_sources"
STATE_FAILED = "failed"
# Não é estado persistido: é o resultado da leitura quando não há fato gravado
# (ou quando o fato gravado não descreve mais a Entity).
STATE_MISSING = "missing"

KIND_WEBSITE = "website"
KIND_GOOGLE_PLACES = "google_places"

NO_SOURCES_DETAIL = "entity sem website nem place_id (sem fonte de imagem)"
IMAGE_MISSING_DETAIL = "imagem não encontrada (og:image e Places sem resultado)"
# A leitura respondeu "ainda não resolvi" (não há fato gravado): é uma resposta
# TRANSITÓRIA, e o cliente precisa saber disso para voltar — ver `media_404`.
PENDING_DETAIL = "imagem ainda não resolvida (resolução em andamento)"

# Cache-Control das RESPOSTAS sem imagem. Duas classes, e a diferença é a única
# coisa que permite ao cliente decidir entre TENTAR DE NOVO e desistir:
# - transitório (`pending`): o enriquecimento acabou de ser disparado → 60 s, e o
#   cliente volta depois disso;
# - definitivo-por-ora (`no_sources`, `failed`): o servidor já avaliou as fontes e
#   o fato persistido diz que não há imagem → 1 h.
# Antes desta separação, `failed` e `pending` saíam os DOIS com `max-age=60` e o
# mesmo texto. O cliente não tinha como distingui-los e escolhia a leitura
# pessimista (negativo definitivo, sem fallback e sem nova tentativa): o card
# ficava placeholder mesmo depois de a foto existir. Medido no Collector em
# 2026-09-17 — 12 de 30 cards pintados, e o preenchimento parava ali.
NO_SOURCES_CACHE_CONTROL = "private, max-age=3600"
UNAVAILABLE_CACHE_CONTROL = "private, max-age=3600"
PENDING_CACHE_CONTROL = "private, max-age=60"
# Quanto o cliente deve esperar antes de perguntar de novo por uma imagem
# pendente. A resolução típica (baixar a página + ranquear + reencodar) leva
# segundos; 15 s evita um laço apertado sem fazer o operador esperar em pé.
PENDING_RETRY_AFTER_SECONDS = 15

# Enriquecimento: UMA resolução por vez no processo, e uma janela de silêncio
# por Entity depois do despacho. Sem a janela, uma Entity que falha (site fora
# do ar, Places sem foto) re-admite a descoberta a cada leitura de card — que é
# exatamente o custo que a persistência veio remover.
ENRICH_COOLDOWN_SECONDS = 60.0

# Códigos de referência MORTA (a URL salva não serve mais: assinatura vencida,
# imagem removida do site, referência recusada). Uma nova descoberta tende a
# escolher o mesmo vencedor, então insistir de hora em hora é trabalho jogado
# fora; de dia em dia é o ritmo certo. Falha transitória (rede, timeout, decode)
# continua no ritmo curto configurado.
DEAD_REFERENCE_ERRORS = frozenset({"http_400", "http_403", "http_404", "http_410", "invalid_reference"})
DEAD_REFERENCE_RETRY_SECONDS = 24 * 3600
# Teto da fila de espera: 200 entidades é uma lista fria inteira de uma carga de
# página; acima disso a demanda passou do que o processo pode e o excedente é
# descartado COM contagem e log (o pedido volta na próxima leitura).
ENRICH_QUEUE_MAX_ENTRIES = 200

# entity_id -> instante (monotonic) do último despacho; entradas expiradas são
# podadas a cada despacho, então o dicionário é limitado ao último minuto.
_enrichment_dispatched: Dict[str, float] = {}
_enrichment_active = 0
_enrichment_queue: "deque[Tuple[Any, Any, str]]" = deque()
_enrichment_queued: "set[str]" = set()
_enrichment_queue_task: "Optional[asyncio.Task[None]]" = None
_enrichment_dropped = 0
# Referência forte da task consumidora: uma task sem referência pode ser
# coletada pelo GC antes de rodar.
_enrichment_consumer: "Optional[asyncio.Task[None]]" = None

# ---------------------------------------------------------------------------
# HOOK DE ESCRITA (documentado, NÃO implementado)
# ---------------------------------------------------------------------------
# Os dois pontos em que uma Entity ganha `website`/`place_id` são escritas
# SÍNCRONAS (pymongo), dentro de handlers `def` que o Starlette executa no
# threadpool:
#
#     app/services/entity_service.py::upsert_entity   (POST /entities e bulk)
#     app/api/entities.py::apply_entity_update        (PATCH /entities e CMS)
#
# Não existe event loop rodando nesses pontos, então `asyncio.create_task` não
# é uma opção: o hook exigiria capturar o loop no startup (frágil e fácil de
# quebrar em teste) só para ADIANTAR um trabalho que a entrada (1) já dispara na
# primeira leitura do card. Fica documentado, não implementado — como pedido.
#
# Se for implementado um dia, precisa: (a) comparar `website`/`place_id` velho x
# novo, (b) disparar só quando mudou de fato e (c) nunca deixar uma falha de
# resolução derrubar a escrita. Nenhuma das duas escritas usa replace: ambas
# fazem `$set`, então `display_media` sobrevive a um PATCH/POST da Entity.


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: Any) -> Optional[datetime]:
    """Normaliza um datetime vindo do Mongo para UTC aware.

    O pymongo devolve datetime NAIVE (o BSON não guarda offset) e aqui isso É
    UTC; comparar naive com `now()` desloca o prazo pelo offset do visitante —
    bug já visto no acervo (registro "atualizado no futuro"). Leitura e escrita
    passam por aqui.
    """
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def extract_image_sources(doc: dict) -> Tuple[Optional[str], Optional[str]]:
    """Website + place_id da Entity — a MESMA cadeia tolerante dos cards
    (v3 singular + bulk plural + google_place_id).

    Implementação única: a rota agregada (`app/api/entities.py`) e o boundary do
    CMS delegam para cá, para que a decisão de "esta Entity tem fonte de
    imagem?" não se bifurque.
    """
    data = doc.get("data") or {}
    website = (
        (data.get("contact") or {}).get("website")
        or (data.get("contacts") or {}).get("website")
        or data.get("website")
        or None
    )
    # google_place_id é o shape de algumas entities bulk (37 sem
    # data.place_id no acervo vivo) — sem ele o fallback Places não
    # alcançava esses lugares.
    place_id = data.get("place_id") or data.get("google_place_id") or None
    return website, place_id


def source_fingerprint(website: Optional[str], place_id: Optional[str]) -> str:
    """Impressão da FONTE que produziu o fato — hash, nunca a URL ou o place_id.

    Sem ela, um `display_media` gravado continua sendo servido por até 14 dias
    depois de a Entity trocar de website ou de place_id: o operador corrige a
    fonte, o card segue mostrando a foto do site antigo, e o dado persistido
    passa a contradizer o documento. É o mesmo defeito de "fato derivado sem
    vínculo com a origem" que já apareceu no espelho de identidade do Admin.

    É hash porque a fonte pode ser URL com query assinada: o que precisa ser
    comparável não é o valor, é a igualdade.
    """
    material = f"{(website or '').strip()}|{(place_id or '').strip()}".encode("utf-8")
    return hashlib.sha256(material).hexdigest()[:16]


def entity_key(doc: dict) -> str:
    """Identidade curta e segura para log/dedupe (nunca URL, nunca documento)."""
    return str(doc.get("_id") if doc.get("_id") is not None else doc.get("entity_id") or "?")


@dataclass(frozen=True)
class HeroMediaRead:
    """Resultado de uma leitura de rank 0: a imagem, quando existe, ou o estado.

    `state` é o estado do FATO (``resolved``/``no_sources``/``failed``) ou
    ``missing`` quando não há fato persistido. A rota trata `no_sources` com
    cache longo e todo o resto com cache curto.
    """

    state: str
    image: Optional[Tuple[bytes, str]] = None


def _stored(doc: dict) -> Optional[dict]:
    """O `display_media` do documento, normalizado — só o que a leitura usa."""
    value = doc.get(DISPLAY_MEDIA_FIELD)
    if not isinstance(value, dict):
        return None
    state = value.get("state")
    if state not in (STATE_RESOLVED, STATE_NO_SOURCES, STATE_FAILED):
        return None
    attempts = value.get("attempts")
    provider_ref = value.get("provider_ref")
    return {
        "state": state,
        "kind": value.get("kind"),
        "provider_ref": provider_ref if isinstance(provider_ref, str) else None,
        "attempts": attempts if isinstance(attempts, int) else 0,
        "expires_at": _as_utc(value.get("expires_at")),
        "source_fingerprint": (
            value.get("source_fingerprint") if isinstance(value.get("source_fingerprint"), str) else None
        ),
    }


def _write_state(
    entities_collection,
    doc: dict,
    *,
    state: str,
    kind: Optional[str] = None,
    provider_ref: Optional[str] = None,
    width: Optional[int] = None,
    height: Optional[int] = None,
    score: Optional[float] = None,
    last_error: Optional[str] = None,
    attempts: int = 0,
    source_fingerprint: Optional[str] = None,
) -> dict:
    """Grava o fato e devolve o valor exatamente como foi persistido.

    O shape é fixo (as dez chaves sempre presentes) para que um leitor do
    documento não precise distinguir "ausente" de "nulo".
    """
    resolved_at = _now()
    if state == STATE_RESOLVED:
        expires_at = resolved_at + timedelta(days=settings.display_media_ttl_days)
    elif state == STATE_FAILED and last_error in DEAD_REFERENCE_ERRORS:
        expires_at = resolved_at + timedelta(seconds=DEAD_REFERENCE_RETRY_SECONDS)
    elif state == STATE_FAILED:
        expires_at = resolved_at + timedelta(seconds=settings.display_media_failure_retry_seconds)
    else:
        # `no_sources` é verificado na própria leitura, direto do documento:
        # não há fato com prazo de validade para expirar.
        expires_at = None

    value = {
        "state": state,
        "kind": kind,
        "provider_ref": provider_ref,
        "width": width,
        "height": height,
        "score": score,
        "resolved_at": resolved_at,
        "expires_at": expires_at,
        "attempts": attempts,
        "last_error": last_error,
        "source_fingerprint": source_fingerprint,
    }

    entity_id = doc.get("_id")
    if entity_id is None:
        return value
    try:
        entities_collection.update_one({"_id": entity_id}, {"$set": {DISPLAY_MEDIA_FIELD: value}})
    except Exception as exc:
        # O fato derivado NUNCA pode derrubar a leitura que o descobriu (lição
        # do espelho de identidade no Admin: escrita derivada não falha request).
        logger.warning(
            "display media: falha ao persistir em %s (%s)",
            entity_key(doc),
            type(exc).__name__,
        )
    return value


def _winner_reference(image) -> Optional[Tuple[str, str]]:
    """(kind, provider_ref) do candidato vencedor, ou None se não é persistível.

    Guarda de escrita da regra de segurança, aplicada no ÚNICO ponto que
    persiste: referência de Places só no formato opaco (`places/...`) e
    referência de site só como origem + caminho — sem query, sem fragment e,
    obviamente, sem `key=` (`og_image_service.persistible_image_reference` recusa
    URL com query — não a limpa).

    Consequência aceita e documentada: quando a melhor imagem do site só existe
    atrás de URL assinada, não há referência durável; o estado é `failed` com
    `no_reference` e a retentativa é rara, porque a próxima tentativa
    reencontraria o mesmo vencedor.
    """
    reference = getattr(image, "provider_ref", None)
    if not isinstance(reference, str) or not reference.strip():
        return None
    if getattr(image, "source", None) == KIND_GOOGLE_PLACES:
        if reference.startswith("places/") and "key=" not in reference:
            return (KIND_GOOGLE_PLACES, reference)
        return None
    # Defesa em profundidade: a referência de site precisa ser uma URL http(s)
    # durável — sem query, sem fragment, sem `key=`. A descoberta já aplica
    # `persistible_image_reference`; aqui recusamos de novo porque este é o único
    # ponto que escreve no documento.
    safe = persistible_image_reference(reference)
    if safe is None or "key=" in safe:
        return None
    return (KIND_WEBSITE, safe)


def _log_resolution(key: str, value: dict, started: float) -> None:
    """Uma linha por resolução: entity, estado, tipo, duração e o CÓDIGO da falha.

    O código entra porque é ele que responde "por que este card não tem foto?" —
    e é curto por contrato (`no_image_found`, `image_rejected`, `http_404`…), nunca
    URL nem corpo de resposta. Sem ele a linha dizia apenas `state=failed` e o
    diagnóstico voltava a ser adivinhação.
    """
    logger.info(
        "display media: entity=%s state=%s kind=%s attempts=%s ms=%d error=%s",
        key,
        value["state"],
        value["kind"] or "-",
        value["attempts"],
        int((time.monotonic() - started) * 1000),
        value["last_error"] or "-",
    )


async def resolve_display_media(entities_collection, entity: dict) -> dict:
    """Resolve o hero da Entity e PERSISTE o fato; devolve o valor persistido.

    Reusa o pipeline ranqueado com `limit=1` (o mesmo hero do card): nenhum
    ranking novo, nenhum limite novo — só o RESULTADO passa a ser durável.
    """
    key = entity_key(entity)
    started = time.monotonic()
    website, place_id = extract_image_sources(entity)
    stored = _stored(entity)
    attempts = (stored["attempts"] if stored else 0) + 1

    if not website and not place_id:
        value = _write_state(
            entities_collection,
            entity,
            state=STATE_NO_SOURCES,
            attempts=attempts,
            source_fingerprint=source_fingerprint(website, place_id),
        )
        _log_resolution(key, value, started)
        return value

    kind: Optional[str] = None
    provider_ref: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    score: Optional[float] = None
    last_error: Optional[str] = None
    images: List[Any] = []

    try:
        images = await get_restaurant_images(page_url=website, place_id=place_id, limit=1)
    except asyncio.CancelledError:
        raise
    except ValueError:
        # SSRF guard: a fonte guardada aponta para rede interna.
        last_error = "blocked_source"
    except Exception:
        last_error = "resolution_failed"

    state = STATE_FAILED
    if images:
        winner = images[0]
        reference = _winner_reference(winner)
        if reference is None:
            # Sem referência durável não há fato durável: um "resolved" sem
            # `provider_ref` seria um cache que nunca serve.
            last_error = "no_reference"
        else:
            candidate_kind, candidate_ref = reference
            # PROVA antes de gravar. A referência durável pode não ser a URL que
            # a descoberta validou (a query sai ao persistir), então o fato só
            # vira `resolved` depois de a referência devolver imagem AGORA —
            # quando é a mesma URL, o cache de bytes do processo responde sem
            # rede. Sem esta prova, `resolved` seria uma promessa que só falha na
            # leitura de quem opera, e o teste de referência assinada não teria
            # como distinguir "morreu depois" de "nunca serviu".
            probe, probe_error = await get_reference_image_bytes(candidate_kind, candidate_ref)
            if probe is None:
                last_error = probe_error or "no_reference"
            else:
                kind, provider_ref = candidate_kind, candidate_ref
                state = STATE_RESOLVED
                width, height = winner.width, winner.height
                score = round(float(winner.score), 2)
    elif last_error is None:
        last_error = "no_image_found"

    value = _write_state(
        entities_collection,
        entity,
        state=state,
        kind=kind,
        provider_ref=provider_ref,
        width=width,
        height=height,
        score=score,
        last_error=last_error,
        attempts=attempts,
        source_fingerprint=source_fingerprint(website, place_id),
    )
    _log_resolution(key, value, started)
    return value


async def read_hero_media(entities_collection, entity: dict) -> HeroMediaRead:
    """Leitura do hero (rank 0) a partir do fato persistido.

    `resolved` fresco → busca SOMENTE a `provider_ref` (a URL assinada do
    Places é reconstruída no servidor) e reencoda. Qualquer outra coisa →
    estado sem imagem + enriquecimento em background, sem bloquear a resposta.
    Rank ≥ 1 (galeria) não passa por aqui: continua no caminho do collector,
    documentado na rota.
    """
    website, place_id = extract_image_sources(entity)
    if not website and not place_id:
        # Caminho explícito do "não há o que resolver": grava UMA vez e a
        # leitura responde com cache longo. Sem ele esta Entity voltaria à fila
        # de enriquecimento para sempre.
        if (_stored(entity) or {}).get("state") != STATE_NO_SOURCES:
            _write_state(
                entities_collection,
                entity,
                state=STATE_NO_SOURCES,
                source_fingerprint=source_fingerprint(website, place_id),
            )
        return HeroMediaRead(state=STATE_NO_SOURCES)

    stored = _stored(entity)
    if stored is not None and stored.get("source_fingerprint") != source_fingerprint(website, place_id):
        # A fonte mudou depois de o fato ser gravado: o que está persistido fala
        # de outro site/place. Não serve como resposta; volta a pendente e
        # reenfileira.
        #
        # IGUALDADE, não "igual ou sem impressão". Aceitar `None` (fato gravado
        # antes deste campo existir) pouparia UMA resolução por Entity e deixaria
        # um fato órfão de origem sendo servido por até 14 dias — exatamente o
        # defeito de "derivado sem vínculo com a origem" que esta impressão veio
        # corrigir. O custo de não abrir a exceção é uma resolução por fato
        # legado: limitado aos que existirem, decrescente, e pago uma vez.
        _schedule_enrichment(entities_collection, entity)
        return HeroMediaRead(state=STATE_MISSING)

    if (
        stored is not None
        and stored["state"] == STATE_RESOLVED
        and stored["kind"] in (KIND_WEBSITE, KIND_GOOGLE_PLACES)
        and stored["provider_ref"]
        and stored["expires_at"] is not None
        and stored["expires_at"] > _now()
    ):
        image, error = await get_reference_image_bytes(stored["kind"], stored["provider_ref"])
        if image is not None:
            return HeroMediaRead(state=STATE_RESOLVED, image=image)
        # A referência morreu no provedor (404, site trocou a imagem, decode
        # quebrou): vira o MESMO fato negativo do `failed` — prazo curto — e a
        # próxima descoberta já está enfileirada.
        _write_state(
            entities_collection,
            entity,
            state=STATE_FAILED,
            last_error=error,
            attempts=stored["attempts"],
            source_fingerprint=stored.get("source_fingerprint"),
        )
        _schedule_enrichment(entities_collection, entity)
        return HeroMediaRead(state=STATE_FAILED)

    # Um `no_sources` guardado com fontes presentes (as fontes apareceram
    # depois) não vale como resposta, e um `resolved` vencido também não: o que
    # sai daqui é "pendente" — só um `failed` persistido se identifica.
    failed = stored is not None and stored["state"] == STATE_FAILED

    # BACKOFF PERSISTIDO. `_write_state` grava `expires_at` para o estado
    # `failed` justamente para dizer QUANDO vale tentar de novo (uma hora para
    # falha transitória, um dia para referência morta). Reagendar ignorando esse
    # prazo transformava os dois em dado morto e reduzia tudo ao cooldown de 60 s
    # do processo — ou seja, uma Entity que falhou por referência assinada
    # tentava de novo a cada minuto em que alguém abrisse o card.
    retry_fresh = failed and stored.get("expires_at") is not None and stored["expires_at"] > _now()
    if not retry_fresh:
        _schedule_enrichment(entities_collection, entity)

    return HeroMediaRead(state=STATE_FAILED if failed else STATE_MISSING)


def media_404(read: HeroMediaRead) -> Tuple[str, Dict[str, str]]:
    """A resposta 404 de uma leitura sem imagem — decisão ÚNICA para os dois boundaries.

    Existe para que o contrato entre servidor e cliente seja um só (a rota pública
    e a do CMS não podem divergir):

    - ``no_sources`` → o próprio documento diz que não há fonte: definitivo;
    - ``failed``     → o servidor avaliou as fontes e falhou; o fato persistido já
      tem prazo (`expires_at`), e enquanto ele vale não adianta insistir: definitivo
      por ora;
    - ``missing``    → **não há fato gravado**. O enriquecimento acabou de ser
      enfileirado, então esta resposta é a mais transitória das três: 60 s e um
      ``Retry-After`` explícito, que é o que autoriza o cliente a voltar em vez de
      marcar o card como "sem foto" e nunca mais perguntar.
    """
    if read.state == STATE_NO_SOURCES:
        return NO_SOURCES_DETAIL, {"Cache-Control": NO_SOURCES_CACHE_CONTROL}
    if read.state == STATE_MISSING:
        return PENDING_DETAIL, {
            "Cache-Control": PENDING_CACHE_CONTROL,
            "Retry-After": str(PENDING_RETRY_AFTER_SECONDS),
        }
    return IMAGE_MISSING_DETAIL, {"Cache-Control": UNAVAILABLE_CACHE_CONTROL}


def _schedule_enrichment(entities_collection, entity: dict) -> bool:
    """Enfileira a resolução do hero (fire-and-forget) e devolve se entrou.

    Fila LIMITADA com um consumidor sequencial. A primeira versão descartava todo
    pedido enquanto uma resolução estava em voo: uma lista fria de trinta cards
    resolvia UM e deixava vinte e nove esperando uma releitura que talvez nunca
    viesse — o oposto do que o enriquecimento existe para fazer. Agora o trabalho
    é acumulado numa fila de tamanho fixo e processado um por vez, que é o que a
    memória do container permite; só o transbordo da fila é descartado, e isso é
    contado e logado (sinal de que a demanda passou do que o processo pode).

    Dedupe por `entity_id` (na fila, em voo, ou despachado há menos de
    `ENRICH_COOLDOWN_SECONDS`) e nenhuma fila persistente: se o processo
    reiniciar no meio, a Entity fica sem `display_media` e a próxima leitura
    reenfileira — idempotente por construção.
    """
    global _enrichment_consumer, _enrichment_dropped
    if not settings.display_media_enrich_enabled:
        return False

    key = entity_key(entity)
    now = time.monotonic()
    for stale in [
        candidate for candidate, sent_at in _enrichment_dispatched.items() if now - sent_at >= ENRICH_COOLDOWN_SECONDS
    ]:
        _enrichment_dispatched.pop(stale, None)
    last = _enrichment_dispatched.get(key)
    if last is not None and now - last < ENRICH_COOLDOWN_SECONDS:
        return False
    if key in _enrichment_queued:
        return False

    if len(_enrichment_queue) >= ENRICH_QUEUE_MAX_ENTRIES:
        _enrichment_dropped += 1
        logger.warning(
            "display media: fila cheia (%d), pedido descartado; %d descartados no total",
            ENRICH_QUEUE_MAX_ENTRIES,
            _enrichment_dropped,
        )
        return False

    # Identidade, não documento: a fila pode segurar 200 itens sem segurar 200
    # documentos em memória — e o documento é relido no momento de resolver, para
    # não trabalhar em cima de uma fonte que mudou desde o enfileiramento.
    _enrichment_queue.append((entities_collection, entity.get("_id"), key))
    _enrichment_queued.add(key)
    _enrichment_dispatched[key] = now

    running = _enrichment_consumer
    if running is None or running.done():
        try:
            _enrichment_consumer = asyncio.create_task(_consume_enrichment_queue())
        except RuntimeError:
            # Sem event loop rodando não há background: a próxima leitura tenta
            # de novo (o caminho de leitura é async, então isto é blindagem).
            _enrichment_queue.pop()
            _enrichment_queued.discard(key)
            _enrichment_dispatched.pop(key, None)
            return False
    return True


async def _consume_enrichment_queue() -> None:
    """Consumidor único: um hero por vez, na ordem em que a demanda chegou."""
    global _enrichment_active
    try:
        while _enrichment_queue:
            entities_collection, entity_id, key = _enrichment_queue.popleft()
            _enrichment_active += 1
            try:
                entity = None
                if entity_id is not None:
                    try:
                        entity = entities_collection.find_one({"_id": entity_id})
                    except Exception:
                        entity = None
                if not entity:
                    logger.debug("display media: %s saiu do catálogo antes da vez", key)
                    continue
                await _enrich(entities_collection, entity, key)
            finally:
                _enrichment_active -= 1
                # A chave volta a ser enfileirável só DEPOIS da resolução. Soltá-la
                # no popleft deixava a janela de dedupe a cargo do cooldown de 60 s,
                # que conta desde o ENFILEIRAMENTO: com fila cheia, uma resolução
                # podia passar de um minuto e a mesma Entity era enfileirada de novo
                # enquanto a primeira ainda rodava (trabalho dobrado, transbordo da
                # fila à toa).
                _enrichment_queued.discard(key)
    finally:
        _enrichment_active = 0


async def _enrich(entities_collection, entity: dict, key: str) -> None:
    try:
        await resolve_display_media(entities_collection, entity)
    except asyncio.CancelledError:
        raise
    except Exception:
        # Uma resolução em background jamais pode escapar como exceção solta no
        # loop: o estado fica sem fato novo e a próxima leitura re-enfileira.
        logger.warning("display media: enriquecimento falhou para %s", key)
