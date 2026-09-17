"""Testes do backfill de `display_media` (scripts/python-tools/enrich_display_media.py).

O que este arquivo vigia:
  - a SELEÇÃO é a parte que não tem volta: pular uma Entity que precisa de fato é
    o defeito que a ferramenta existe para consertar, e re-resolver o que já está
    fresco é o desperdício que ela existe para evitar;
  - `--dry-run` é estritamente read-only;
  - a guarda de banco (`--yes` fora de *-test) aborta ANTES de conectar;
  - o resumo conta `no_sources`/`failed` (por código) — é o número que o
    operador lê para decidir se roda de novo.

O serviço é o REAL (`app.services.display_media_service`): a ferramenta tem de
concordar com a leitura do card sobre o que é "fresco", e um dublê aqui testaria
o dublê. O import é tardio porque `app.core.config.settings` exige MONGODB_URL no
ambiente ao ser construído (o .env não vive na raiz do repo e a ferramenta não o
carrega ao ser importada).

Fake de coleção próprio (com cursor ordenável) em vez de estender o de
`tests/fakes.py`: aquele é a superfície que as outras suítes já exercitam, e este
script é o único que ordena por `_id`.
"""
import copy
import json
from datetime import datetime, timedelta, timezone

import pytest

import mongo_tools
from enrich_display_media import (
    SKIP_FRESH,
    SKIP_NO_SOURCE,
    format_summary,
    main,
    require_confirmation,
    run_pass,
    scan,
    skip_reason,
)
from tests.fakes import FakeClient, FakeCollection, FakeDB

NOW = datetime(2026, 9, 16, 12, 0, tzinfo=timezone.utc)
SITE = "https://restaurante.example"
SITE_ANTIGO = "https://antigo.example"


@pytest.fixture(scope="module")
def display():
    """O serviço real do display media (leitor do fato + resolvedor)."""
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("MONGODB_URL", "mongodb://127.0.0.1:27017/?directConnection=true")
        patch.setenv("MONGODB_DB_NAME", "concierge-collector-test")
        from app.services import display_media_service

        yield display_media_service


class Cursor(list):
    """Cursor mínimo: o script ordena por `_id` para o passe ser determinístico —
    é o que faz `--limit` ser retomável."""

    def sort(self, key_or_list):
        if isinstance(key_or_list, str):
            key_or_list = [(key_or_list, 1)]
        key, direction = key_or_list[0]
        list.sort(self, key=lambda doc: (doc.get(key) is None, str(doc.get(key))))
        if direction == -1:
            self.reverse()
        return self


class Entities(FakeCollection):
    """`fakes.FakeCollection` + o `find` que devolve cursor.

    `projection` entra posicional como no pymongo real — o harness compartilhado
    só declara `**kwargs`, e o script usa a assinatura do driver.
    """

    def find(self, query, projection=None, **kwargs):
        return Cursor(super().find(query))


def _entity(entity_id="e1", *, website=SITE, place_id=None, display_media=None):
    data = {}
    if website:
        data["contact"] = {"website": website}
    if place_id:
        data["place_id"] = place_id
    doc = {"_id": entity_id, "entity_id": entity_id, "data": data}
    if display_media is not None:
        doc["display_media"] = display_media
    return doc


def _fact(
    display,
    state,
    *,
    website=SITE,
    place_id=None,
    expires_in=None,
    fingerprint=None,
    last_error=None,
    provider_ref="https://cdn.example/hero.jpg",
    resolved_at=None,
):
    """O shape que o serviço grava (as dez chaves do fato, sempre presentes)."""
    resolved_at = resolved_at or NOW
    resolvido = state == display.STATE_RESOLVED
    return {
        "state": state,
        "kind": "website" if resolvido else None,
        "provider_ref": provider_ref if resolvido else None,
        "width": 1600 if resolvido else None,
        "height": 1000 if resolvido else None,
        "score": 72.5 if resolvido else None,
        "resolved_at": resolved_at,
        "expires_at": resolved_at + expires_in if expires_in is not None else None,
        "attempts": 1,
        "last_error": last_error,
        "source_fingerprint": (
            fingerprint if fingerprint is not None else display.source_fingerprint(website, place_id)
        ),
    }


def _db(entities):
    """O banco do passe — a MESMA coleção que o teste inspeciona depois."""
    return FakeDB({"entities": entities})


class Client(FakeClient):
    """`FakeClient` + o `close()` que o main chama no finally."""

    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


# ---------------------------------------------------------------------------
# Seleção — o que entra e o que fica de fora
# ---------------------------------------------------------------------------


def test_selecao_pula_fato_fresco_e_pega_o_vencido(display):
    fresco = timedelta(days=13)
    vencido = -timedelta(minutes=1)
    docs = [
        # inseridos FORA da ordem de `_id` de propósito: o passe ordena por `_id`
        _entity("z_sem_fato"),
        _entity("a_resolved_fresco", display_media=_fact(display, "resolved", expires_in=fresco)),
        _entity("b_resolved_vencido", display_media=_fact(display, "resolved", expires_in=vencido)),
        _entity("c_resolved_naive_futuro", display_media=_fact(
            display,
            "resolved",
            expires_in=fresco,
            # O BSON devolve datetime NAIVE e naive aqui É UTC: sem o normalizador
            # do serviço isto pareceria vencido (bug já visto no acervo).
            resolved_at=NOW.replace(tzinfo=None),
        )),
        _entity("d_resolved_sem_prazo", display_media=_fact(display, "resolved")),
        _entity("e_failed_fresco", display_media=_fact(
            display, "failed", expires_in=timedelta(minutes=30), last_error="timeout"
        )),
        _entity("f_failed_vencido", display_media=_fact(
            display, "failed", expires_in=vencido, last_error="http_404"
        )),
        _entity("g_fonte_mudou", display_media=_fact(
            display, "resolved", expires_in=fresco, fingerprint=display.source_fingerprint(SITE_ANTIGO, None)
        )),
        _entity("h_no_sources_sem_fonte", website=None, display_media=_fact(
            display, "no_sources", website=None, expires_in=None
        )),
        _entity("i_sem_fonte", website=None),
        _entity("j_no_sources_com_fonte_nova", display_media=_fact(
            display, "no_sources", website=None, expires_in=None
        )),
        _entity("k_estado_desconhecido", display_media={"state": "???"}),
    ]
    entidades = Entities(docs)
    resumo = {}

    candidatas = [doc["_id"] for doc in scan(entidades, service=display, now=NOW, resumo=resumo)]

    assert candidatas == [
        "b_resolved_vencido",
        "d_resolved_sem_prazo",
        "f_failed_vencido",
        "g_fonte_mudou",
        "j_no_sources_com_fonte_nova",
        "k_estado_desconhecido",
        "z_sem_fato",
    ]
    assert resumo["varridas"] == len(docs)
    assert resumo[SKIP_NO_SOURCE] == 2  # h e i
    assert resumo[SKIP_FRESH] == 3  # a, c e e
    assert resumo["candidatas"] == 7


def test_skip_reason_nomeia_o_motivo(display):
    assert skip_reason(_entity("sem-fonte", website=None), service=display, now=NOW) == SKIP_NO_SOURCE
    assert skip_reason(
        _entity("fresco", display_media=_fact(display, "resolved", expires_in=timedelta(days=1))),
        service=display,
        now=NOW,
    ) == SKIP_FRESH
    assert skip_reason(_entity("sem-fato"), service=display, now=NOW) is None


def test_limit_corta_no_numero_de_candidatas_sem_consumir_o_caminho(display):
    """O limite conta CANDIDATAS: as frescas do caminho não gastam o orçamento."""
    docs = [
        _entity("a_fresco", display_media=_fact(display, "resolved", expires_in=timedelta(days=13))),
        _entity("b_candidata"),
        _entity("c_fresco", display_media=_fact(display, "resolved", expires_in=timedelta(days=13))),
        _entity("d_candidata"),
        _entity("e_candidata"),
    ]
    resumo = {}

    candidatas = list(scan(Entities(docs), service=display, now=NOW, limit=2, resumo=resumo))

    assert [doc["_id"] for doc in candidatas] == ["b_candidata", "d_candidata"]
    assert resumo["candidatas"] == 2
    # As duas frescas do caminho foram vistas (a e c) e nenhuma gastou o
    # orçamento: o limite conta candidatas.
    assert resumo[SKIP_FRESH] == 2
    assert resumo["varridas"] == 4  # parou na 2ª candidata, sem varrer a última


# ---------------------------------------------------------------------------
# Passe: dry-run, resumo e a escrita (que é do serviço)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dry_run_conta_sem_resolver_sem_escrever(display, monkeypatch):
    chamadas = []

    async def resolver(*_args, **_kwargs):
        chamadas.append(1)
        raise AssertionError("dry-run não pode resolver nem escrever")

    monkeypatch.setattr(display, "resolve_display_media", resolver)
    entidades = Entities([_entity("e1"), _entity("e2", website=None), _entity("e3")])
    resumo = await run_pass(_db(entidades), service=display, dry_run=True, now=NOW, log=lambda _l: None)

    assert chamadas == []
    assert entidades.last_update_filter is None
    assert all("display_media" not in doc for doc in entidades.docs)
    assert resumo["dry_run"] is True
    assert (resumo["varridas"], resumo["candidatas"], resumo["processadas"]) == (3, 2, 0)
    assert resumo["exemplos"] == ["e1", "e3"]
    assert resumo["segundos"] >= 0


def test_main_dry_run_le_o_banco_e_nao_escreve(display, monkeypatch, capsys):
    monkeypatch.setattr(mongo_tools, "load_env", lambda *a, **k: [])
    monkeypatch.setenv("MONGODB_URL", "mongodb://127.0.0.1:27017/?directConnection=true")
    monkeypatch.setenv("MONGODB_DB_NAME", "concierge-collector-test")
    entidades = Entities([_entity("e1"), _entity("e2", website=None)])
    cliente = Client()
    monkeypatch.setattr(mongo_tools, "connect", lambda: (cliente, _db(entidades)))

    assert main(["--dry-run", "--limit", "5"]) == 0

    out = capsys.readouterr().out
    assert "dry-run: nada foi escrito" in out
    assert cliente.closed is True
    assert entidades.last_update_filter is None
    assert all("display_media" not in doc for doc in entidades.docs)


@pytest.mark.asyncio
async def test_resumo_conta_no_sources_e_failed_por_codigo(display, monkeypatch):
    """`no_sources` pode aparecer NO MEIO do passe: a varredura é um retrato, e a
    fonte pode sumir antes de a resolução acontecer."""
    respostas = iter(
        [
            {"state": "resolved", "kind": "website", "last_error": None},
            {"state": "no_sources", "kind": None, "last_error": None},
            {"state": "failed", "kind": None, "last_error": "no_image_found"},
            {"state": "failed", "kind": None, "last_error": "http_404"},
            {"state": "failed", "kind": None, "last_error": "no_reference"},
        ]
    )

    async def resolver(_collection, _doc):
        return next(respostas)

    monkeypatch.setattr(display, "resolve_display_media", resolver)
    docs = [_entity(f"e{i}") for i in range(5)]

    resumo = await run_pass(_db(Entities(docs)), service=display, now=NOW, batch_size=2, log=lambda _l: None)

    assert (resumo["processadas"], resumo["resolved"], resumo["no_sources"], resumo["failed"]) == (5, 1, 1, 3)
    assert resumo["failed_por_erro"] == {"no_image_found": 1, "http_404": 1, "no_reference": 1}
    # `failed` não é um número só: "não havia imagem" e "achei imagem e a
    # referência durável não serviu" são problemas diferentes para o operador.
    assert resumo["failed_sem_imagem"] == 1
    assert resumo["failed_imagem_recusada"] == 2  # no_reference + http_404 (referência morta)
    assert "no_reference=1" in "\n".join(format_summary(resumo, "concierge-collector-test"))


@pytest.mark.asyncio
async def test_passe_grava_pelo_servico_e_so_o_campo_display_media(display, monkeypatch):
    """Resolução REAL (rede trocada por fakes): o fato é o do serviço, que prova
    a referência durável antes de gravar `resolved` — e a referência gravada não
    carrega a query assinada."""
    from app.services.restaurant_image_collector import CollectedImage

    segredo = "key=super-secreta-do-places"
    site_limpo = "https://site-limpo.example"
    site_assinado = "https://site-assinado.example"

    def _imagem(provider_ref):
        return CollectedImage(
            jpeg_bytes=b"jpeg",
            source="website",
            width=1200,
            height=800,
            byte_size=4,
            score=80.0,
            provider_ref=provider_ref,
        )

    async def imagens(page_url=None, place_id=None, limit=1):
        if page_url == site_limpo:
            return [_imagem("https://cdn.example/hero.jpg")]
        if page_url == site_assinado:
            # URL ASSINADA: a query (com `?key=`) sai da referência durável — o
            # que é persistido é a imagem sem credencial.
            return [_imagem(f"https://cdn.example/hero.jpg?{segredo}&w=1600")]
        return []

    async def prova(_kind, _provider_ref):
        return b"jpeg", "image/jpeg"

    monkeypatch.setattr(display, "get_restaurant_images", imagens)
    monkeypatch.setattr(display, "get_reference_image_bytes", prova)

    docs = [
        _entity("e_resolvida", website=site_limpo),
        _entity("e_assinada", website=site_assinado),
        _entity("e_sem_imagem", website="https://site-sem-imagem.example"),
    ]
    entidades = Entities(docs)
    antes = {doc["_id"]: copy.deepcopy(doc) for doc in docs}
    linhas = []

    resumo = await run_pass(_db(entidades), service=display, now=NOW, log=linhas.append)

    assert (resumo["resolved"], resumo["no_sources"], resumo["failed"]) == (2, 0, 1)
    assert resumo["failed_por_erro"] == {"no_image_found": 1}
    assert resumo["failed_sem_imagem"] == 1
    assert resumo["failed_imagem_recusada"] == 0
    fatos = {doc["_id"]: doc["display_media"] for doc in entidades.docs}
    assert fatos["e_resolvida"]["state"] == "resolved"
    assert fatos["e_resolvida"]["kind"] == "website"
    assert fatos["e_resolvida"]["source_fingerprint"] == display.source_fingerprint(site_limpo, None)
    assert fatos["e_assinada"]["state"] == "resolved"
    assert fatos["e_assinada"]["provider_ref"] == "https://cdn.example/hero.jpg"
    assert fatos["e_assinada"]["source_fingerprint"] == display.source_fingerprint(site_assinado, None)
    assert fatos["e_sem_imagem"]["state"] == "failed"
    assert fatos["e_sem_imagem"]["last_error"] == "no_image_found"

    for doc in entidades.docs:
        sem_fato = {k: v for k, v in doc.items() if k != "display_media"}
        # Nenhum outro campo da Entity é tocado — quem escreve é o serviço, e só
        # ele — e nenhum valor gravado carrega a chave da API.
        assert sem_fato == antes[doc["_id"]]
        assert "key=" not in json.dumps(doc, default=str)

    # A última escrita é a da última candidata na ordem (`_id`), nunca um filtro
    # derivado.
    assert entidades.last_update_filter == {"_id": "e_sem_imagem"}
    # Uma linha por resolução: entity, estado, tipo e duração (nunca a URL).
    assert any("entity=e_resolvida state=resolved kind=website" in linha and "ms=" in linha for linha in linhas)
    assert all("key=" not in linha and "site-limpo.example" not in linha for linha in linhas)


@pytest.mark.asyncio
async def test_falha_na_resolucao_nao_derruba_o_passe_e_nao_vaza_a_fonte(display, monkeypatch):
    segredo = "key=super-secreta-do-places"
    website = f"https://site.example/hero.jpg?{segredo}"
    linhas = []

    async def explode(_collection, _doc):
        raise RuntimeError(f"falhou baixando {website}")

    monkeypatch.setattr(display, "resolve_display_media", explode)

    resumo = await run_pass(
        _db(Entities([_entity("e1", website=website), _entity("e2", website=website)])),
        service=display,
        now=NOW,
        log=linhas.append,
    )

    assert (resumo["processadas"], resumo["failed"]) == (0, 2)
    assert resumo["failed_por_erro"] == {"RuntimeError": 2}
    texto = "\n".join(linhas)
    assert "entity=e1 state=failed kind=- erro=RuntimeError" in texto
    # Só o TIPO do erro é logável: a mensagem pode carregar a URL assinada.
    assert "key=" not in texto and "site.example" not in texto


@pytest.mark.asyncio
async def test_entity_sem_id_e_pulada_com_contagem(display, monkeypatch):
    chamadas = []

    async def resolver(_collection, doc):
        chamadas.append(doc["_id"])
        return {"state": "resolved", "kind": "website", "last_error": None}

    monkeypatch.setattr(display, "resolve_display_media", resolver)
    sem_id = {"entity_id": "sem-id", "data": {"contact": {"website": SITE}}}

    resumo = await run_pass(_db(Entities([sem_id, _entity("e1")])), service=display, now=NOW, log=lambda _l: None)

    # Sem `_id` não há chave de escrita: a candidata é pulada COM contagem, e o
    # resto do passe segue.
    assert chamadas == ["e1"]
    assert resumo["sem_id"] == 1
    assert resumo["resolved"] == 1


@pytest.mark.asyncio
async def test_passe_interrompido_e_retomado_continua_de_onde_parou(display, monkeypatch):
    """O estado do passe é o PRÓPRIO documento: quem já recebeu fato fresco não
    volta a ser candidato — é isso que torna Ctrl+C seguro."""

    async def resolver(collection, doc):
        value = _fact(display, "resolved", expires_in=timedelta(days=13))
        collection.update_one({"_id": doc["_id"]}, {"$set": {"display_media": value}})
        return value

    monkeypatch.setattr(display, "resolve_display_media", resolver)
    entidades = Entities([_entity(f"e{i}") for i in range(5)])
    db = _db(entidades)

    primeiro = await run_pass(db, service=display, limit=2, now=NOW, log=lambda _l: None)
    segundo = await run_pass(db, service=display, now=NOW, log=lambda _l: None)
    terceiro = await run_pass(db, service=display, now=NOW, log=lambda _l: None)

    assert primeiro["processadas"] == 2
    assert segundo["processadas"] == 3
    assert segundo[SKIP_FRESH] == 2
    assert terceiro["candidatas"] == 0


# ---------------------------------------------------------------------------
# Guarda de banco
# ---------------------------------------------------------------------------


def test_sem_yes_fora_de_banco_de_teste_recusa():
    with pytest.raises(ValueError, match="--yes"):
        require_confirmation("concierge-collector", confirmed=False, dry_run=False)


def test_banco_de_teste_ou_dry_run_ou_yes_passam():
    require_confirmation("concierge-collector-test", confirmed=False, dry_run=False)
    require_confirmation("concierge-collector", confirmed=False, dry_run=True)
    require_confirmation("concierge-collector", confirmed=True, dry_run=False)


def test_main_recusa_antes_de_conectar(monkeypatch, capsys):
    monkeypatch.setattr(mongo_tools, "load_env", lambda *a, **k: [])
    monkeypatch.setenv("MONGODB_URL", "mongodb://127.0.0.1:27017/?directConnection=true")
    monkeypatch.setenv("MONGODB_DB_NAME", "concierge-collector")

    def proibido(*_args, **_kwargs):
        raise AssertionError("a guarda tem de recusar ANTES de abrir conexão")

    monkeypatch.setattr(mongo_tools, "connect", proibido)

    assert main([]) != 0
    assert main(["--limit", "5"]) != 0
    erro = capsys.readouterr().err
    assert "ABORTADO" in erro and "--yes" in erro
