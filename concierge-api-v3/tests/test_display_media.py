"""Display media: o hero da Entity resolvido UMA vez e persistido.

O contrato que estes testes travam é o que tirou a descoberta do render path:

1. `resolved` serve pela referência persistida — a descoberta (site, og:image,
   Places) NÃO roda de novo;
2. `no_sources` é 404 com cache longo, gravado uma única vez;
3. ausente/failed/expirado é 404 com cache curto e dispara o enriquecimento em
   background, uma vez por Entity, sem segurar a resposta;
4. NENHUM documento persistido carrega a chave da API do Places — nem em
   `provider_ref`, nem em `last_error`, nem num candidato hostil;
5. as datas persistidas são aware/UTC (o Mongo devolve naive e o acervo já
   sofreu com data deslocada).
"""

import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.services import display_media_service as display
from app.services import og_image_service
from app.services.restaurant_image_collector import CollectedImage

PATH = "/api/v3/catalog/entities"
ACTOR_ID = "cms-admin-test"


class _RecordingCollection:
    """Coleção mínima: o serviço só usa `update_one` para persistir o fato.

    Guarda cada escrita inteira (query + update) — é o que permite afirmar que
    um segredo não apareceu em NENHUM valor gravado — e escreve NO MESMO doc que
    o teste passou, como o Mongo faria com a leitura seguinte.
    """

    def __init__(self, doc=None):
        self.doc = doc if doc is not None else {}
        self.writes = []

    def find_one(self, query, projection=None):
        """O consumidor do enriquecimento relê a Entity antes de resolver (para
        não trabalhar sobre uma fonte que mudou desde o enfileiramento)."""
        return self.doc if query.get("_id") == self.doc.get("_id") else None

    def update_one(self, query, update, upsert=False):
        self.writes.append({"query": query, "update": update})
        self.doc.update(update.get("$set", {}))
        return type("R", (), {"matched_count": 1, "modified_count": 1, "upserted_id": None})()

    @property
    def persisted(self):
        return self.doc.get(display.DISPLAY_MEDIA_FIELD)


class _FakeCollection:
    """Coleção que sempre TEM o documento pedido (para exercitar a FILA, não a releitura)."""

    def find_one(self, query):
        return {"_id": query["_id"]}


class _BrokenCollection(_RecordingCollection):
    """Mongo indisponível: o fato derivado não pode derrubar a leitura."""

    def update_one(self, query, update, upsert=False):
        self.writes.append({"query": query, "update": update})
        raise RuntimeError("mongo fora do ar")


def _entity(entity_id="e1", *, website="https://restaurante.example", place_id=None, display_media=None, contact=None):
    data = {}
    if contact is not None:
        data["contact"] = contact
    elif website:
        data["contact"] = {"website": website}
    if place_id:
        data["place_id"] = place_id
    doc = {"_id": entity_id, "name": "Café Teste", "data": data}
    if display_media is not None:
        doc[display.DISPLAY_MEDIA_FIELD] = display_media
    return doc


PERSISTED_KEYS = {
    "state",
    "kind",
    "provider_ref",
    "width",
    "height",
    "score",
    "resolved_at",
    "expires_at",
    "attempts",
    "last_error",
    # Impressão da FONTE (website|place_id): o fato é ignorado se a Entity trocar
    # de fonte depois de gravado.
    "source_fingerprint",
}


def _probe_ok(monkeypatch, image=(b"jpeg", "image/jpeg")):
    """A resolução PROVA a referência durável antes de gravar `resolved`."""
    calls: list[tuple[str, str]] = []

    async def probe(kind, provider_ref):
        calls.append((kind, provider_ref))
        return image, None

    monkeypatch.setattr(display, "get_reference_image_bytes", probe)
    return calls


def _probe_dead(monkeypatch, code="http_403"):
    async def probe(kind, provider_ref):
        return None, code

    monkeypatch.setattr(display, "get_reference_image_bytes", probe)


_UNSET = object()


def _resolved(
    kind="website",
    provider_ref="https://cdn.example/hero.jpg",
    *,
    expires_at=None,
    attempts=1,
    website="https://restaurante.example",
    place_id=None,
    source_fingerprint_value=_UNSET,
):
    return {
        "state": "resolved",
        "kind": kind,
        "provider_ref": provider_ref,
        "width": 1600,
        "height": 1000,
        "score": 72.5,
        "resolved_at": datetime.now(timezone.utc),
        "expires_at": expires_at if expires_at is not None else datetime.now(timezone.utc) + timedelta(days=14),
        "attempts": attempts,
        "last_error": None,
        # A impressão é de QUEM ESCREVEU o fato, então o seed a calcula a partir
        # da MESMA fonte que a Entity de teste carrega — a leitura exige
        # igualdade e um seed solto viraria "a fonte mudou". O valor explícito
        # fica para os dois casos que querem mismatch ou legado sem impressão.
        "source_fingerprint": (
            display.source_fingerprint(website, place_id)
            if source_fingerprint_value is _UNSET
            else source_fingerprint_value
        ),
    }


def _collected(source="website_og", provider_ref="https://cdn.example/hero.jpg"):
    return CollectedImage(
        jpeg_bytes=b"jpeg",
        source=source,
        width=1600,
        height=1000,
        byte_size=4,
        score=72.5,
        score_components={"source": 72.5},
        provider_ref=provider_ref,
    )


def _seed_cms_admin(db) -> None:
    db.users.insert_one({"_id": ACTOR_ID, "email": f"{ACTOR_ID}@example.com", "authorized": True, "role": "admin"})


def _headers() -> dict[str, str]:
    return {"X-CMS-Service-Key": settings.cms_service_key_value, "X-CMS-Actor-Id": ACTOR_ID}


def _reset_enrichment_state() -> None:
    """Zera o estado de processo do enriquecimento (dedupe, fila, contadores).

    Guardado por `getattr` de propósito: o mecanismo interno (fila + consumidor)
    pode evoluir e o teste não deve quebrar por um nome — o que ele cobra é
    comportamento. O consumidor também é solto: um consumidor de um loop já
    encerrado não pode bloquear o próximo teste.
    """
    for name in ("_enrichment_queue", "_enrichment_queued", "_enrichment_dispatched", "_enrichment_tasks"):
        state = getattr(display, name, None)
        if hasattr(state, "clear"):
            state.clear()
    for name in ("_enrichment_active", "_enrichment_dropped"):
        if hasattr(display, name):
            setattr(display, name, 0)
    for name in ("_enrichment_consumer", "_enrichment_queue_task"):
        if hasattr(display, name):
            setattr(display, name, None)


def _is_enrichment_task(task) -> bool:
    """A task de background DESTE módulo, sem depender do nome interno dela."""
    coro = getattr(task, "get_coro", lambda: None)()
    code = getattr(coro, "cr_code", None)
    return bool(code) and code.co_filename.endswith("display_media_service.py")


async def _drain_enrichment() -> None:
    """Aguarda o consumidor de background terminar a fila (determinístico)."""
    running = [
        task
        for task in asyncio.all_tasks()
        if task is not asyncio.current_task() and not task.done() and _is_enrichment_task(task)
    ]
    if running:
        await asyncio.gather(*running, return_exceptions=True)


async def _settle_enrichment(turns: int = 10) -> None:
    """Deixa o loop consumir a fila por completo, sem depender de nomes internos."""
    for _ in range(turns):
        await _drain_enrichment()
        await asyncio.sleep(0)
        if not any(_is_enrichment_task(task) for task in asyncio.all_tasks() if not task.done()):
            return


@pytest.fixture(autouse=True)
def _fresh_enrichment_state():
    _reset_enrichment_state()
    yield
    _reset_enrichment_state()


# ---------------------------------------------------------------------------
# (a) resolved serve sem redescobrir
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolved_serve_pela_referencia_sem_redescobrir(monkeypatch):
    entity = _entity(display_media=_resolved(provider_ref="https://cdn.example/hero.jpg"))
    collection = _RecordingCollection(entity)
    calls = {}

    async def fake_reference(kind, provider_ref):
        calls.update(kind=kind, provider_ref=provider_ref)
        return (b"jpeg", "image/jpeg"), None

    async def discovery_never_called(**_kwargs):  # pragma: no cover - o ponto do campo
        raise AssertionError("display media resolvida não pode redescobrir a imagem")

    monkeypatch.setattr(display, "get_reference_image_bytes", fake_reference)
    monkeypatch.setattr(display, "get_restaurant_images", discovery_never_called)

    read = await display.read_hero_media(collection, entity)

    assert read.state == display.STATE_RESOLVED
    assert read.image == (b"jpeg", "image/jpeg")
    assert calls == {"kind": "website", "provider_ref": "https://cdn.example/hero.jpg"}
    assert collection.writes == []


@pytest.mark.asyncio
async def test_rank_zero_no_boundary_do_cms_serve_o_fato_persistido(async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    in_memory_db.entities.insert_one(
        {
            **_entity(place_id="ChIJ123"),
            display.DISPLAY_MEDIA_FIELD: _resolved(
                kind="google_places", provider_ref="places/P1/photos/PH1", place_id="ChIJ123"
            ),
        }
    )
    calls = {}

    async def fake_reference(kind, provider_ref):
        calls.update(kind=kind, provider_ref=provider_ref)
        return (b"\xff\xd8\xff jpeg", "image/jpeg"), None

    async def discovery_never_called(**_kwargs):  # pragma: no cover - o ponto do campo
        raise AssertionError("o boundary também não redescobre")

    monkeypatch.setattr(display, "get_reference_image_bytes", fake_reference)
    monkeypatch.setattr(display, "get_restaurant_images", discovery_never_called)

    response = await async_client.get(f"{PATH}/e1/image", headers=_headers())

    assert response.status_code == 200, response.text
    assert response.content == b"\xff\xd8\xff jpeg"
    assert response.headers["cache-control"] == "private, max-age=300"
    # A referência que o boundary usa é o nome OPACO do Places; a URL assinada
    # é reconstruída no servidor e não aparece em lugar nenhum da resposta.
    assert calls == {"kind": "google_places", "provider_ref": "places/P1/photos/PH1"}
    assert "key=" not in response.text
    assert "places.googleapis.com" not in response.text


@pytest.mark.asyncio
async def test_fato_de_fonte_antiga_nao_e_servido_depois_da_entity_mudar(monkeypatch):
    """A impressão da fonte invalida o fato na hora: corrigir o website de uma
    Entity não pode deixar o card mostrando a foto do site antigo por 14 dias."""
    entity = _entity(website="https://novo.example", place_id=None)
    entity[display.DISPLAY_MEDIA_FIELD] = _resolved(
        kind="website",
        provider_ref="https://antigo.example/hero.jpg",
        source_fingerprint_value=display.source_fingerprint("https://antigo.example", None),
    )
    collection = _RecordingCollection(entity)
    probed = _probe_ok(monkeypatch)

    read = await display.read_hero_media(collection, entity)

    assert read.image is None
    assert read.state == display.STATE_MISSING
    assert probed == []  # nem chega a buscar a referência do fato antigo
    assert collection.writes == []

    # Controle: com a fonte atual, um fato com a impressão certa é servido.
    entity[display.DISPLAY_MEDIA_FIELD] = _resolved(
        kind="website",
        provider_ref="https://novo.example/hero.jpg",
        source_fingerprint_value=display.source_fingerprint("https://novo.example", None),
    )
    served = await display.read_hero_media(collection, entity)

    assert served.state == display.STATE_RESOLVED
    assert served.image == (b"jpeg", "image/jpeg")
    assert probed == [("website", "https://novo.example/hero.jpg")]


# ---------------------------------------------------------------------------
# (b) no_sources
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_sources_e_gravado_uma_vez_e_nao_dispara_resolucao(monkeypatch):
    monkeypatch.setattr(settings, "display_media_enrich_enabled", True)
    entity = _entity(website=None, place_id=None)
    collection = _RecordingCollection(entity)

    async def resolution_never_called(**_kwargs):  # pragma: no cover - não há o que resolver
        raise AssertionError("Entity sem fonte não pode entrar na fila de enriquecimento")

    monkeypatch.setattr(display, "get_restaurant_images", resolution_never_called)

    first = await display.read_hero_media(collection, entity)
    second = await display.read_hero_media(collection, entity)

    assert (first.state, second.state) == (display.STATE_NO_SOURCES, display.STATE_NO_SOURCES)
    assert [read.image for read in (first, second)] == [None, None]
    assert len(collection.writes) == 1  # o fato é do documento: grava uma vez
    value = collection.persisted
    assert value["state"] == "no_sources"
    assert value["kind"] is None and value["provider_ref"] is None
    assert value["source_fingerprint"] == display.source_fingerprint(None, None)
    assert set(value) == PERSISTED_KEYS
    assert len(display._enrichment_queue) == 0


@pytest.mark.asyncio
async def test_no_sources_no_boundary_e_404_com_cache_longo(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    in_memory_db.entities.insert_one(_entity(website=None))

    response = await async_client.get(f"{PATH}/e1/image", headers=_headers())

    assert response.status_code == 404, response.text
    assert response.headers["cache-control"] == "private, max-age=3600"
    assert response.json()["detail"] == display.NO_SOURCES_DETAIL
    assert in_memory_db.entities.find_one({"_id": "e1"})[display.DISPLAY_MEDIA_FIELD]["state"] == "no_sources"


# ---------------------------------------------------------------------------
# (c) ausente → 404 curto + enriquecimento UMA vez por Entity
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ausente_e_404_curto_com_enriquecimento_disparado_uma_vez(monkeypatch):
    monkeypatch.setattr(settings, "display_media_enrich_enabled", True)
    entity = _entity(place_id="ChIJ123")
    collection = _RecordingCollection(entity)
    resolved = []

    async def fake_resolve(entities_collection, doc):
        resolved.append(display.entity_key(doc))
        return {"state": "resolved"}

    monkeypatch.setattr(display, "resolve_display_media", fake_resolve)

    first = await display.read_hero_media(collection, entity)
    second = await display.read_hero_media(collection, entity)

    assert (first.state, second.state) == (display.STATE_MISSING, display.STATE_MISSING)
    assert first.image is None
    # A resposta não esperou o enriquecimento: nenhuma resolução rodou ainda.
    assert resolved == []

    await _settle_enrichment()

    assert resolved == ["e1"]  # duas leituras seguidas, UMA resolução
    assert display._enrichment_active == 0

    # Mesmo DEPOIS de resolvida, uma leitura dentro da janela de silêncio não
    # re-admite a descoberta: é o que impede um card que falha de custar de
    # novo a cada render.
    third = await display.read_hero_media(collection, entity)
    assert third.image is None
    await _settle_enrichment()
    assert resolved == ["e1"]


def _no_sources_fact(attempts=1):
    return {
        "state": "no_sources",
        "kind": None,
        "provider_ref": None,
        "width": None,
        "height": None,
        "score": None,
        "resolved_at": datetime.now(timezone.utc),
        "expires_at": None,
        "attempts": attempts,
        "last_error": None,
        "source_fingerprint": display.source_fingerprint(None, None),
    }


@pytest.mark.asyncio
async def test_no_sources_e_terminal_por_documento_e_reabre_so_com_fonte_nova(monkeypatch):
    """`no_sources` grava uma vez e NÃO reenfileira; a única reabertura é a
    Entity ganhar website/place_id, quando o fato antigo deixa de ser resposta."""
    monkeypatch.setattr(settings, "display_media_enrich_enabled", True)
    entity = _entity(website=None, place_id=None, display_media=_no_sources_fact())
    collection = _RecordingCollection(entity)
    scheduled: list[str] = []

    async def fake_resolve(entities_collection, doc):
        scheduled.append(display.entity_key(doc))
        return {"state": display.STATE_RESOLVED}

    monkeypatch.setattr(display, "resolve_display_media", fake_resolve)

    still = await display.read_hero_media(collection, entity)
    assert still.state == display.STATE_NO_SOURCES
    assert collection.writes == []  # já estava gravado: nada a reescrever
    await _settle_enrichment()
    assert scheduled == []  # e nada foi enfileirado

    # A fonte apareceu: o `no_sources` guardado não descreve mais a Entity.
    entity["data"] = {"contact": {"website": "https://rest.example.com"}}
    reopened = await display.read_hero_media(collection, entity)
    assert reopened.state == display.STATE_MISSING
    await _settle_enrichment()
    assert scheduled == ["e1"]


@pytest.mark.asyncio
async def test_ausente_no_boundary_e_404_curto(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    in_memory_db.entities.insert_one(_entity(place_id="ChIJ123"))

    response = await async_client.get(f"{PATH}/e1/image", headers=_headers())

    assert response.status_code == 404, response.text
    assert response.headers["cache-control"] == "private, max-age=60"
    assert response.json()["detail"] == display.IMAGE_MISSING_DETAIL
    # Enriquecimento desligado nos testes: nada foi gravado nem agendado.
    assert display.DISPLAY_MEDIA_FIELD not in in_memory_db.entities.find_one({"_id": "e1"})
    assert len(display._enrichment_queue) == 0


@pytest.mark.asyncio
async def test_enriquecimento_desligado_nao_dispara_tarefa(monkeypatch):
    monkeypatch.setattr(settings, "display_media_enrich_enabled", False)
    monkeypatch.setattr(display, "resolve_display_media", _never_called_resolve)

    assert display._schedule_enrichment(_RecordingCollection(), _entity(place_id="P1")) is False
    assert len(display._enrichment_queue) == 0


async def _never_called_resolve(*_args, **_kwargs):  # pragma: no cover - flag desligada
    raise AssertionError("resolução não pode ser enfileirada com a flag desligada")


@pytest.mark.asyncio
async def test_expires_at_vencido_nao_serve_e_reenfileira(monkeypatch):
    monkeypatch.setattr(settings, "display_media_enrich_enabled", True)
    expired = _resolved(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    entity = _entity(display_media=expired)
    collection = _RecordingCollection(entity)
    scheduled = []

    async def fake_resolve(entities_collection, doc):
        scheduled.append(display.entity_key(doc))
        return {"state": "resolved"}

    async def reference_never_called(**_kwargs):  # pragma: no cover - fato vencido não é servido
        raise AssertionError("fato vencido não pode ser buscado")

    monkeypatch.setattr(display, "resolve_display_media", fake_resolve)
    monkeypatch.setattr(display, "get_reference_image_bytes", reference_never_called)

    read = await display.read_hero_media(collection, entity)

    assert read.image is None
    assert read.state == display.STATE_MISSING
    assert collection.writes == []  # a leitura não reescreve o fato vencido
    await _settle_enrichment()
    assert scheduled == ["e1"]


@pytest.mark.asyncio
async def test_referencia_morta_vira_failed_e_reenfileira(monkeypatch):
    monkeypatch.setattr(settings, "display_media_enrich_enabled", True)
    entity = _entity(display_media=_resolved(kind="google_places", provider_ref="places/P1/photos/PH1", attempts=3))
    collection = _RecordingCollection(entity)

    async def dead_reference(kind, provider_ref):
        return None, "http_404"

    monkeypatch.setattr(display, "get_reference_image_bytes", dead_reference)

    read = await display.read_hero_media(collection, entity)

    assert read.state == display.STATE_FAILED and read.image is None
    value = collection.persisted
    assert value["state"] == "failed"
    assert value["last_error"] == "http_404"
    assert value["kind"] is None and value["provider_ref"] is None
    assert value["attempts"] == 3  # preservado: não houve nova resolução
    # Referência que MORREU depois de ter sido provada (imagem removida do site,
    # assinatura vencida): a próxima descoberta tende a escolher o mesmo
    # vencedor, então a cadência é diária, não horária. Isso só é honesto porque
    # o enriquecimento PROVA a referência antes de gravar `resolved` — sem essa
    # prova, "morreu depois" e "nunca serviu" seriam indistinguíveis daqui.
    assert value["expires_at"] == value["resolved_at"] + timedelta(seconds=display.DEAD_REFERENCE_RETRY_SECONDS)
    for task in list(asyncio.all_tasks()):
        if _is_enrichment_task(task):
            task.cancel()


@pytest.mark.asyncio
async def test_fato_sem_impressao_nao_serve_e_reenfileira(monkeypatch):
    """Fato gravado antes do campo existir não é aceito: ele não sabe de que fonte veio.

    Aceitar `None` como "serve" pouparia uma resolução e deixaria a Entity
    mostrando a foto de um site que talvez não seja mais o dela por 14 dias.
    """
    monkeypatch.setattr(settings, "display_media_enrich_enabled", True)
    legado = _resolved(provider_ref="https://antigo.example/hero.jpg", source_fingerprint_value=None)
    entity = _entity(display_media=legado)
    collection = _RecordingCollection(entity)
    probed = _probe_ok(monkeypatch)

    read = await display.read_hero_media(collection, entity)

    assert read.state == display.STATE_MISSING and read.image is None
    assert probed == []  # nem tentou buscar a referência do fato órfão
    assert len(display._enrichment_queue) == 1
    for task in list(asyncio.all_tasks()):
        if _is_enrichment_task(task):
            task.cancel()


@pytest.mark.asyncio
async def test_leitura_sobrevive_a_falha_de_escrita(monkeypatch):
    entity = _entity(display_media=_resolved())
    collection = _BrokenCollection(entity)

    async def fake_reference(kind, provider_ref):
        return (b"jpeg", "image/jpeg"), None

    monkeypatch.setattr(display, "get_reference_image_bytes", fake_reference)

    read = await display.read_hero_media(collection, entity)

    assert read.state == display.STATE_RESOLVED
    assert read.image == (b"jpeg", "image/jpeg")


# ---------------------------------------------------------------------------
# (d) nenhum documento persistido carrega a chave da API
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_nenhum_valor_persistido_carrega_a_chave_da_api(monkeypatch):
    secret = "super-secret-places-key"
    monkeypatch.setattr(settings, "google_places_api_key", secret)
    signed_url = og_image_service.places_photo_media_url("places/P1/photos/PH1")
    assert secret in signed_url  # a URL assinada EXISTE e é o que não pode ser gravado

    entity = _entity(place_id="ChIJ123")
    collection = _RecordingCollection(entity)

    async def places_winner(**_kwargs):
        return [_collected("google_places", provider_ref="places/P1/photos/PH1")]

    monkeypatch.setattr(display, "get_restaurant_images", places_winner)
    probed = _probe_ok(monkeypatch)
    value = await display.resolve_display_media(collection, entity)

    assert (value["state"], value["kind"]) == ("resolved", "google_places")
    assert value["provider_ref"] == "places/P1/photos/PH1"
    # A prova usa a referência OPACA: a URL assinada é reconstruída no servidor.
    assert probed == [("google_places", "places/P1/photos/PH1")]
    assert secret not in json.dumps(collection.persisted, default=str)

    # Candidato hostil: a própria URL assinada como referência jamais vira fato.
    async def hostile_winner(**_kwargs):
        return [_collected("google_places", provider_ref=signed_url)]

    monkeypatch.setattr(display, "get_restaurant_images", hostile_winner)
    hostile = await display.resolve_display_media(collection, entity)

    assert (hostile["state"], hostile["last_error"]) == ("failed", "no_reference")
    assert hostile["provider_ref"] is None
    assert secret not in json.dumps(collection.writes, default=str)

    # Falha cuja mensagem contém a URL assinada: só o código curto é gravado.
    async def failing(**_kwargs):
        raise RuntimeError(f"boom {signed_url}")

    monkeypatch.setattr(display, "get_restaurant_images", failing)
    failed = await display.resolve_display_media(collection, entity)

    assert (failed["state"], failed["last_error"]) == ("failed", "resolution_failed")
    assert secret not in json.dumps(collection.writes, default=str)


@pytest.mark.asyncio
async def test_places_ref_vira_url_assinada_no_servidor_e_cache_sem_segredo(monkeypatch):
    secret = "super-secret-places-key"
    monkeypatch.setattr(settings, "google_places_api_key", secret)
    signed_url = og_image_service.places_photo_media_url("places/P1/photos/PH1")
    og_image_service._og_bytes_cache.clear()
    fetched = []

    async def fake_download(url, timeout, *, error_sink=None):
        fetched.append(url)
        return b"raw-bytes"

    monkeypatch.setattr(og_image_service, "_download_bytes", fake_download)
    monkeypatch.setattr(og_image_service, "_resize_to_card_jpeg", lambda raw: (b"jpeg", "image/jpeg"))

    image, error = await og_image_service.get_reference_image_bytes("google_places", "places/P1/photos/PH1")

    assert (image, error) == ((b"jpeg", "image/jpeg"), None)
    assert fetched == [f"https://places.googleapis.com/v1/places/P1/photos/PH1/media?key={secret}&maxWidthPx=768"]
    # A chave vive na URL do request e no cache em memória (chaveado pelo nome
    # opaco) — nunca no documento da Entity, que é o que se persiste.
    assert list(og_image_service._og_bytes_cache) == ["display:google_places:places/P1/photos/PH1"]

    # Segunda busca do mesmo fato: um download, não dois.
    again = await og_image_service.get_reference_image_bytes("google_places", "places/P1/photos/PH1")
    assert again[0] == (b"jpeg", "image/jpeg")
    assert len(fetched) == 1

    # Website usa a URL pública da imagem, sem construtor nenhum.
    site_image, _ = await og_image_service.get_reference_image_bytes("website", "https://cdn.example/hero.jpg")
    assert site_image == (b"jpeg", "image/jpeg")
    assert fetched[-1] == "https://cdn.example/hero.jpg"

    # Nem uma referência que carregue chave, nem um kind desconhecido passam.
    assert await og_image_service.get_reference_image_bytes("google_places", signed_url) == (None, "invalid_reference")
    assert await og_image_service.get_reference_image_bytes("places", "places/P1") == (None, "invalid_reference")


# ---------------------------------------------------------------------------
# (e) datas persistidas são aware/UTC
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_datas_persistidas_sao_aware_e_utc(monkeypatch):
    entity = _entity(place_id="ChIJ123")
    collection = _RecordingCollection(entity)

    async def winner(**_kwargs):
        return [_collected()]

    monkeypatch.setattr(display, "get_restaurant_images", winner)
    _probe_ok(monkeypatch)
    value = await display.resolve_display_media(collection, entity)

    assert set(value) == PERSISTED_KEYS
    assert value["resolved_at"].tzinfo is not None
    assert value["resolved_at"].utcoffset() == timedelta(0)
    assert value["expires_at"].tzinfo is not None
    assert value["expires_at"] == value["resolved_at"] + timedelta(days=settings.display_media_ttl_days)
    assert (value["kind"], value["width"], value["height"]) == ("website", 1600, 1000)
    assert value["score"] == 72.5
    assert value["attempts"] == 1
    assert value["last_error"] is None

    async def failing(**_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(display, "get_restaurant_images", failing)
    failed = await display.resolve_display_media(collection, entity)

    assert failed["resolved_at"].utcoffset() == timedelta(0)
    assert failed["expires_at"] == failed["resolved_at"] + timedelta(
        seconds=settings.display_media_failure_retry_seconds
    )
    assert failed["attempts"] == 2


@pytest.mark.asyncio
async def test_expires_at_naive_do_bson_e_lido_como_utc(monkeypatch):
    # O pymongo devolve datetime NAIVE (BSON não guarda offset) e naive aqui É
    # UTC: sem normalizar, um fato válido por 14 dias pareceria vencido.
    naive_future = (datetime.now(timezone.utc) + timedelta(days=13)).replace(tzinfo=None)
    entity = _entity(display_media=_resolved(expires_at=naive_future))
    collection = _RecordingCollection(entity)

    async def fake_reference(kind, provider_ref):
        return (b"jpeg", "image/jpeg"), None

    async def discovery_never_called(**_kwargs):  # pragma: no cover - o fato é fresco
        raise AssertionError("fato fresco não redescobre")

    monkeypatch.setattr(display, "get_reference_image_bytes", fake_reference)
    monkeypatch.setattr(display, "get_restaurant_images", discovery_never_called)

    read = await display.read_hero_media(collection, entity)

    assert read.state == display.STATE_RESOLVED
    assert read.image is not None

    # E um naive já vencido não é servido.
    naive_past = (datetime.now(timezone.utc) - timedelta(minutes=5)).replace(tzinfo=None)
    stale = _entity(display_media=_resolved(expires_at=naive_past))
    read_stale = await display.read_hero_media(collection, stale)
    assert read_stale.image is None


# ---------------------------------------------------------------------------
# Propagação: o vencedor do SITE persiste a URL da IMAGEM (nunca a da página)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_vencedor_do_site_persiste_a_url_da_imagem(monkeypatch):
    """A referência durável do site é a URL DA IMAGEM, não a da página: a página
    não é imagem, e sem isso a descoberta teria de rodar de novo só para
    reencontrá-la."""
    from app.services.restaurant_image_discovery import SourcedImageURL

    discoveries = []

    async def resolve(page_url):
        discoveries.append(page_url)
        return [SourcedImageURL("https://site.example/img/hero.jpg", "website_og", 0)]

    async def download(url, timeout, *, error_sink=None):
        return _detail_png(1800, 1200)

    monkeypatch.setattr(og_image_service, "_resolve_og_image_candidates", resolve)
    monkeypatch.setattr(og_image_service, "_download_bytes", download)
    og_image_service._image_catalog_cache.clear()
    og_image_service._og_bytes_cache.clear()

    entity = _entity(website="https://site.example")
    collection = _RecordingCollection(entity)

    value = await display.resolve_display_media(collection, entity)

    assert (value["state"], value["kind"]) == ("resolved", "website")
    assert value["provider_ref"] == "https://site.example/img/hero.jpg"
    assert (value["width"], value["height"]) == (1800, 1200)
    assert value["score"] > 0

    # A leitura do fato baixa SÓ a imagem persistida — a descoberta não roda.
    read = await display.read_hero_media(collection, entity)

    assert read.state == display.STATE_RESOLVED
    assert read.image[0][:3] == b"\xff\xd8\xff"
    assert discoveries == ["https://site.example"]


# ---------------------------------------------------------------------------
# Extra: a chave nunca aparece em log nem em `last_error` de fontes internas
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_states_e_logs_nao_expoem_url_nem_chave(monkeypatch, caplog):
    secret = "super-secret-places-key"
    monkeypatch.setattr(settings, "google_places_api_key", secret)
    entity = _entity(place_id="ChIJ123")
    collection = _RecordingCollection(entity)

    async def winner(**_kwargs):
        return [_collected("google_places", provider_ref="places/P1/photos/PH1")]

    monkeypatch.setattr(display, "get_restaurant_images", winner)
    _probe_ok(monkeypatch)

    with caplog.at_level("INFO"):
        await display.resolve_display_media(collection, entity)

    assert caplog.records, "toda resolução precisa de uma linha de log"
    logged = "\n".join(record.getMessage() for record in caplog.records)
    assert "entity=e1" in logged
    assert "state=resolved" in logged
    assert "kind=google_places" in logged
    assert secret not in logged
    assert "key=" not in logged


# ---------------------------------------------------------------------------
# Smoke ponta a ponta: do fato persistido até os BYTES (rede trocada por um
# transport de mentira; download, validação PIL, reencode e cache são reais)
# ---------------------------------------------------------------------------


def _detail_png(width=1200, height=800):
    """PNG com textura suficiente para passar nos gates do prepare_image."""
    import io

    from PIL import Image

    small = Image.new("RGB", (32, 32))
    small.putdata(
        [((x * 7 + y * 11) % 256, (x * 3 + y * 5) % 256, (x * 13 + y * 7) % 256) for y in range(32) for x in range(32)]
    )
    buf = io.BytesIO()
    small.resize((width, height), Image.Resampling.BILINEAR).save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_smoke_do_fato_persistido_ate_os_bytes(monkeypatch):
    """`resolved` + Places: a URL assinada é reconstruída no servidor, os bytes
    são baixados e reencodados de verdade e NADA disso vai para o documento."""
    import httpx

    secret = "super-secret-places-key"
    monkeypatch.setattr(settings, "google_places_api_key", secret)
    # O guard de SSRF resolve DNS do host; aqui o alvo é a cadeia de bytes (o
    # guard tem cobertura própria em test_catalog_media/test_og_image).
    monkeypatch.setattr("app.services.openai_service._is_blocked_host", lambda hostname: False)
    og_image_service._og_bytes_cache.clear()
    requested = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        return httpx.Response(200, content=_detail_png(), headers={"content-type": "image/png"})

    real_client = httpx.AsyncClient

    def client_with_transport(**kwargs):
        kwargs.pop("transport", None)
        return real_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client_with_transport)

    entity = _entity(
        place_id="ChIJ123",
        display_media=_resolved(kind="google_places", provider_ref="places/P1/photos/PH1", place_id="ChIJ123"),
    )
    collection = _RecordingCollection(entity)

    read = await display.read_hero_media(collection, entity)

    assert read.state == display.STATE_RESOLVED
    body, content_type = read.image
    assert content_type == "image/jpeg"
    assert body[:3] == b"\xff\xd8\xff"  # é o JPEG reencodado, não o PNG baixado
    assert requested == [f"https://places.googleapis.com/v1/places/P1/photos/PH1/media?key={secret}&maxWidthPx=768"]
    # O download aconteceu UMA vez, com a chave só no request, e o documento
    # continua com a referência opaca.
    assert collection.persisted["provider_ref"] == "places/P1/photos/PH1"
    assert secret not in json.dumps(collection.doc, default=str)

    cached = await display.read_hero_media(collection, entity)
    assert cached.image == read.image
    assert requested == [f"https://places.googleapis.com/v1/places/P1/photos/PH1/media?key={secret}&maxWidthPx=768"]


# ---------------------------------------------------------------------------
# Revisão de arquitetura: referência durável, cadência do retry e fila
# ---------------------------------------------------------------------------


def test_referencia_de_site_perde_query_e_nao_perde_a_imagem():
    """Query sai da referência — inclusive quando era só cache-buster.

    Recusar toda URL com query jogaria fora as imagens cujo `?v=3`/`?w=1600` é
    cache-buster ou largura, que é boa parte do que existe. A query sai; o que
    sobra é a mesma imagem.
    """
    from app.services.og_image_service import persistible_image_reference

    assert persistible_image_reference("https://cdn.example.com/hero.jpg") == "https://cdn.example.com/hero.jpg"
    assert (
        persistible_image_reference("https://cdn.example.com/hero.jpg?w=1600&v=3") == "https://cdn.example.com/hero.jpg"
    )
    assert persistible_image_reference("https://cdn.example.com/hero.jpg?sig=abc") == "https://cdn.example.com/hero.jpg"
    assert persistible_image_reference("https://cdn.example.com/hero.jpg#frag") == "https://cdn.example.com/hero.jpg"
    assert persistible_image_reference("/relativo.jpg") is None


def test_codigo_de_referencia_morta_retenta_em_dia_e_transitorio_em_hora():
    """A cadência do retry vem da CLASSE do erro, não de um flag extra.

    Referência morta (assinatura vencida, imagem removida) reencontraria o mesmo
    vencedor na próxima descoberta: retry raro. Falha transitória (rede, decode)
    retenta no ritmo curto.
    """
    morta = display._write_state(object(), {}, state=display.STATE_FAILED, last_error="http_404", attempts=2)
    assert (morta["expires_at"] - morta["resolved_at"]).total_seconds() == display.DEAD_REFERENCE_RETRY_SECONDS

    transitoria = display._write_state(object(), {}, state=display.STATE_FAILED, last_error="timeout", attempts=2)
    assert (
        transitoria["expires_at"] - transitoria["resolved_at"]
    ).total_seconds() == settings.display_media_failure_retry_seconds

    sem_referencia = display._write_state(
        object(), {}, state=display.STATE_FAILED, last_error="no_reference", attempts=1
    )
    assert (
        sem_referencia["expires_at"] - sem_referencia["resolved_at"]
    ).total_seconds() == settings.display_media_failure_retry_seconds


@pytest.mark.asyncio
async def test_fila_de_enriquecimento_nao_descarta_a_carga_fria(monkeypatch):
    """Uma lista fria de N cards enfileira N, em vez de resolver 1 e perder N-1."""
    resolvidos: list[str] = []

    async def _fake_resolve(collection, entity):
        resolvidos.append(str(entity["_id"]))
        return {"state": display.STATE_RESOLVED}

    monkeypatch.setattr(display, "resolve_display_media", _fake_resolve)
    monkeypatch.setattr(settings, "display_media_enrich_enabled", True)
    _reset_enrichment_state()

    for index in range(5):
        assert display._schedule_enrichment(_FakeCollection(), {"_id": f"entity-{index}"}) is True

    assert len(display._enrichment_queue) == 5
    assert display._enrichment_consumer is not None
    await display._enrichment_consumer
    assert sorted(resolvidos) == [f"entity-{index}" for index in range(5)]
    assert display._enrichment_dropped == 0


@pytest.mark.asyncio
async def test_fila_cheia_descarta_com_contagem(monkeypatch):
    monkeypatch.setattr(settings, "display_media_enrich_enabled", True)

    async def _never_runs():
        await asyncio.sleep(3600)

    monkeypatch.setattr(display, "_consume_enrichment_queue", _never_runs)
    _reset_enrichment_state()

    collection = _FakeCollection()
    for index in range(display.ENRICH_QUEUE_MAX_ENTRIES):
        assert display._schedule_enrichment(collection, {"_id": f"fila-{index}"}) is True
    assert display._schedule_enrichment(collection, {"_id": "excedente"}) is False
    assert display._enrichment_dropped == 1
    assert len(display._enrichment_queue) == display.ENRICH_QUEUE_MAX_ENTRIES
    display._enrichment_consumer.cancel()


# ---------------------------------------------------------------------------
# A prova da referência durável acontece no ENRIQUECIMENTO
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_vencedor_com_query_e_provado_antes_de_virar_resolved(monkeypatch):
    """Cache-buster (`?w=1600`) some da referência, e a referência limpa é PROVADA.

    A pergunta que este caso responde: o documento pode dizer `resolved` para uma
    URL que nunca foi buscada? Não — a referência durável é buscada uma vez no
    enriquecimento; só se ela devolver imagem o fato é gravado.
    """
    monkeypatch.setattr(settings, "display_media_enrich_enabled", False)
    collection = _RecordingCollection({"_id": "e1"})

    async def ranked(*args, **kwargs):
        return [_collected(provider_ref="https://cdn.example.com/hero.jpg?w=1600")]

    provados: list[tuple[str, str]] = []

    async def probe(kind, provider_ref):
        provados.append((kind, provider_ref))
        return ((b"jpeg", "image/jpeg"), None)

    monkeypatch.setattr(display, "get_restaurant_images", ranked)
    monkeypatch.setattr(display, "get_reference_image_bytes", probe)

    value = await display.resolve_display_media(collection, _entity(website="https://rest.example.com"))

    assert provados == [("website", "https://cdn.example.com/hero.jpg")]
    assert value["state"] == "resolved"
    assert value["provider_ref"] == "https://cdn.example.com/hero.jpg"
    assert value["kind"] == "website"


@pytest.mark.asyncio
async def test_referencia_assinada_nao_vira_resolved(monkeypatch):
    """Quando a referência durável não serve, o estado é `failed` — nunca `resolved`."""
    monkeypatch.setattr(settings, "display_media_enrich_enabled", False)
    collection = _RecordingCollection({"_id": "e2"})

    async def ranked(*args, **kwargs):
        return [_collected(provider_ref="https://cdn.example.com/hero.jpg?w=1600")]

    async def probe(kind, provider_ref):
        return None, "http_403"

    monkeypatch.setattr(display, "get_restaurant_images", ranked)
    monkeypatch.setattr(display, "get_reference_image_bytes", probe)

    value = await display.resolve_display_media(collection, _entity(website="https://rest.example.com"))

    assert value["state"] == "failed"
    assert value["last_error"] == "http_403"
    assert value["provider_ref"] is None and value["kind"] is None
    # 403 é referência morta: cadência rara, para não redescobrir o mesmo
    # vencedor assinado de hora em hora.
    assert (value["expires_at"] - value["resolved_at"]).total_seconds() == display.DEAD_REFERENCE_RETRY_SECONDS


@pytest.mark.asyncio
async def test_backoff_persistido_e_quem_decide_quando_tentar_de_novo(monkeypatch):
    """`failed` dentro do prazo NÃO reenfileira; depois do prazo, reenfileira.

    O `expires_at` do estado `failed` existe para dizer quando vale tentar de
    novo (1h para falha transitória, 24h para referência morta). Agendar ignorando
    esse prazo reduzia as duas cadências ao cooldown de 60 s do processo — e uma
    referência assinada morta seria re-tentada a cada minuto em que alguém
    abrisse o card.
    """
    monkeypatch.setattr(settings, "display_media_enrich_enabled", True)
    agendados: list[str] = []

    def _agendar(collection, entity):
        agendados.append(str(entity.get("_id")))
        return True

    monkeypatch.setattr(display, "_schedule_enrichment", _agendar)
    _reset_enrichment_state()

    dentro_do_prazo = _entity(
        "e-dentro",
        display_media={
            "state": "failed",
            "last_error": "http_404",
            "attempts": 1,
            "resolved_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=5),
            "source_fingerprint": display.source_fingerprint("https://restaurante.example", None),
        },
    )
    vencido = _entity(
        "e-vencido",
        display_media={
            "state": "failed",
            "last_error": "http_404",
            "attempts": 1,
            "resolved_at": datetime.now(timezone.utc) - timedelta(days=2),
            "expires_at": datetime.now(timezone.utc) - timedelta(days=1),
            "source_fingerprint": display.source_fingerprint("https://restaurante.example", None),
        },
    )

    primeira = await display.read_hero_media(_RecordingCollection(dentro_do_prazo), dentro_do_prazo)
    segunda = await display.read_hero_media(_RecordingCollection(vencido), vencido)

    # A resposta é a mesma (sem imagem, cache curto); a DIFERENÇA é o trabalho.
    assert primeira.state == display.STATE_FAILED and segunda.state == display.STATE_FAILED
    assert agendados == ["e-vencido"]
