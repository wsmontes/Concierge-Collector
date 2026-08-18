"""
Regressão: analyze_image passava a URL da imagem direto para o GPT-4 Vision —
o downloader da OpenAI não segue o redirect do proxy /places/photo (302 →
Google) e falha com "Error while downloading https://.../places/photo?...".
O backend agora baixa a imagem server-side e envia data URL (base64) para a
OpenAI — o download remoto nunca mais acontece do lado deles.
"""

import base64
import json

import pytest

from app.services.openai_service import OpenAIService, resolve_image_input

IMG_BYTES = b"\xff\xd8\xff\xe0fakejpegdata"


class FakeResponse:
    def __init__(self, content, content_type="image/jpeg"):
        self.content = content
        self.headers = {"content-type": content_type}

    def raise_for_status(self):
        return None

    async def aiter_bytes(self):
        yield self.content


class _StreamCtx:
    """Context manager de stream do httpx fake — devolve a response."""

    def __init__(self, resp):
        self.resp = resp

    async def __aenter__(self):
        return self.resp

    async def __aexit__(self, *exc):
        return False


class _BaseClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url):  # pragma: no cover
        raise AssertionError(f"httpx não deveria baixar {url} neste teste")

    def stream(self, method, url, **kwargs):  # pragma: no cover
        raise AssertionError(f"httpx não deveria baixar {url} neste teste")


def _mk_fake_httpx(monkeypatch, responder):
    class _Client(_BaseClient):
        def stream(self, method, url, **kwargs):
            return _StreamCtx(responder(url))

    monkeypatch.setattr("app.services.openai_service.httpx.AsyncClient", _Client)


@pytest.mark.asyncio
async def test_url_http_vira_data_url(monkeypatch):
    captured = {}

    def responder(url):
        captured["url"] = url
        return FakeResponse(IMG_BYTES)

    _mk_fake_httpx(monkeypatch, responder)

    result = await resolve_image_input("https://api.onrender.com/api/v3/places/photo?reference=x")
    assert captured["url"] == "https://api.onrender.com/api/v3/places/photo?reference=x"
    assert result.startswith("data:image/jpeg;base64,")
    assert base64.b64decode(result.split(",", 1)[1]) == IMG_BYTES


@pytest.mark.asyncio
async def test_data_url_passa_direto(monkeypatch):
    # httpx falso que explode se for chamado — data URL não pode baixar nada
    monkeypatch.setattr("app.services.openai_service.httpx.AsyncClient", _BaseClient)

    data = "data:image/jpeg;base64," + base64.b64encode(IMG_BYTES).decode()
    assert await resolve_image_input(data) == data


@pytest.mark.asyncio
async def test_base64_cru_vira_data_url_com_sniff(monkeypatch):
    """Regressão: o frontend antigo (e o contrato documentado do image_file)
    mandava base64 CRU — a validação inicial rejeitava com 'Formato de imagem
    não suportado'. Agora o mime é detectado pelos magic bytes."""
    monkeypatch.setattr("app.services.openai_service.httpx.AsyncClient", _BaseClient)

    b64 = base64.b64encode(IMG_BYTES).decode()  # começa com \xff\xd8\xff = jpeg
    result = await resolve_image_input(b64)
    assert result == f"data:image/jpeg;base64,{b64}"


@pytest.mark.asyncio
async def test_base64_invalido_vira_valueerror(monkeypatch):
    monkeypatch.setattr("app.services.openai_service.httpx.AsyncClient", _BaseClient)

    # casa o regex de base64 mas falha o decode (comprimento inválido)
    with pytest.raises(ValueError, match="base64 inválido"):
        await resolve_image_input("abc")


@pytest.mark.asyncio
async def test_base64_magic_desconhecido_vira_valueerror(monkeypatch):
    monkeypatch.setattr("app.services.openai_service.httpx.AsyncClient", _BaseClient)

    b64 = base64.b64encode(b"texto-plano-sem-magic").decode()
    with pytest.raises(ValueError, match="não reconhecido"):
        await resolve_image_input(b64)


@pytest.mark.asyncio
async def test_download_falha_vira_valueerror(monkeypatch):
    class _Fail(_BaseClient):
        def stream(self, method, url, **kwargs):
            raise RuntimeError("conexão recusada")

    monkeypatch.setattr("app.services.openai_service.httpx.AsyncClient", _Fail)

    with pytest.raises(ValueError, match="Não foi possível baixar"):
        await resolve_image_input("https://x.example/img.jpg")


@pytest.mark.asyncio
async def test_content_type_nao_imagem_vira_valueerror(monkeypatch):
    def responder(url):
        return FakeResponse(b"<html>ops</html>", content_type="text/html")

    _mk_fake_httpx(monkeypatch, responder)

    with pytest.raises(ValueError, match="content-type"):
        await resolve_image_input("https://x.example/page")


@pytest.mark.asyncio
async def test_analyze_image_envia_data_url_para_openai(monkeypatch):
    """Ponta a ponta: URL do proxy entra, OpenAI recebe data URL."""
    captured_create = {}

    class FakeCompletions:
        def create(self, **kwargs):
            captured_create.update(kwargs)
            msg = type(
                "M",
                (),
                {
                    "content": json.dumps(
                        {
                            "concepts": ["aconchegante"],
                            "confidence_score": 0.9,
                            "visual_notes": "ok",
                        }
                    )
                },
            )
            return type("R", (), {"choices": [type("C", (), {"message": msg})]})

    class FakeClient:
        def __init__(self):
            self.chat = type("Chat", (), {"completions": FakeCompletions()})()

    def responder(url):
        return FakeResponse(IMG_BYTES)

    _mk_fake_httpx(monkeypatch, responder)

    service = OpenAIService(api_key="sk-test", db_url="mongodb://x", db_name="db")
    service.client = FakeClient()
    service.config_service = type(
        "Cfg",
        (),
        {
            "get_config": lambda self, s: {
                "model": "gpt-4o",
                "config": {"detail": "high", "temperature": 0.3, "max_tokens": 300},
            },
            "render_prompt": lambda self, s, v: "prompt pronto",
        },
    )()

    class _CatStub:
        async def get_categories(self, entity_type):
            return []

    service.category_service = _CatStub()

    result = await service.analyze_image(
        "https://api.onrender.com/api/v3/places/photo?reference=abc",
        entity_type="restaurant",
        save_to_cache=False,
    )

    content = captured_create["messages"][0]["content"]
    img_block = [b for b in content if b.get("type") == "image_url"][0]
    assert img_block["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert result["concepts"] == ["aconchegante"]
    # response_format do config é repassado para a OpenAI
    assert captured_create.get("response_format") is None or "type" in captured_create["response_format"]


@pytest.mark.asyncio
async def test_resposta_markdown_vira_json(monkeypatch):
    """Regressão: o gpt-4o às vezes devolve markdown/code fences — o parse
    extrai o primeiro objeto JSON em vez de estourar json.JSONDecodeError."""
    captured_create = {}

    class FakeCompletions:
        def create(self, **kwargs):
            captured_create.update(kwargs)
            msg = type("M", (), {"content": '```json\n{"concepts": ["elegante"], "confidence_score": 0.7}\n```'})
            return type("R", (), {"choices": [type("C", (), {"message": msg})]})

    class FakeClient:
        def __init__(self):
            self.chat = type("Chat", (), {"completions": FakeCompletions()})()

    def responder(url):
        return FakeResponse(IMG_BYTES)

    _mk_fake_httpx(monkeypatch, responder)

    service = OpenAIService(api_key="sk-test", db_url="mongodb://x", db_name="db")
    service.client = FakeClient()
    service.config_service = type(
        "Cfg",
        (),
        {
            "get_config": lambda self, s: {
                "model": "gpt-4o",
                "config": {"detail": "high", "temperature": 0.3, "max_tokens": 300},
            },
            "render_prompt": lambda self, s, v: "prompt pronto",
        },
    )()

    class _CatStub:
        async def get_categories(self, entity_type):
            return []

    service.category_service = _CatStub()

    result = await service.analyze_image(
        "https://api.onrender.com/api/v3/places/photo?reference=abc",
        entity_type="restaurant",
        save_to_cache=False,
    )
    assert result["concepts"] == ["elegante"]


@pytest.mark.asyncio
async def test_resposta_sem_json_vira_valueerror(monkeypatch):
    class FakeCompletions:
        def create(self, **kwargs):
            msg = type("M", (), {"content": "não consigo analisar esta imagem"})
            return type("R", (), {"choices": [type("C", (), {"message": msg})]})

    class FakeClient:
        def __init__(self):
            self.chat = type("Chat", (), {"completions": FakeCompletions()})()

    def responder(url):
        return FakeResponse(IMG_BYTES)

    _mk_fake_httpx(monkeypatch, responder)

    service = OpenAIService(api_key="sk-test", db_url="mongodb://x", db_name="db")
    service.client = FakeClient()
    service.config_service = type(
        "Cfg",
        (),
        {
            "get_config": lambda self, s: {
                "model": "gpt-4o",
                "config": {"detail": "high", "temperature": 0.3, "max_tokens": 300},
            },
            "render_prompt": lambda self, s, v: "prompt pronto",
        },
    )()

    class _CatStub:
        async def get_categories(self, entity_type):
            return []

    service.category_service = _CatStub()

    with pytest.raises(ValueError, match="não é JSON"):
        await service.analyze_image(
            "https://api.onrender.com/api/v3/places/photo?reference=abc",
            entity_type="restaurant",
            save_to_cache=False,
        )


# ── SSRF / limites de download (auditoria ago/2026) ──────────────────────


async def test_image_url_loopback_bloqueado(monkeypatch):
    """127.0.0.1/localhost são rede interna — o download NÃO pode nem começar."""
    from app.services.openai_service import resolve_image_input

    for url in ("http://127.0.0.1/x.png", "http://localhost/x.png", "http://[::1]/x.png"):
        with pytest.raises(ValueError, match="não permitido|não permitida"):
            await resolve_image_input(url)


@pytest.mark.asyncio
async def test_analyze_image_canonicaliza_categorias(monkeypatch):
    """Caminho de imagem (2026-08-18): o gpt-4o podia devolver chaves fora do
    vocabulário (ambiance/design do prompt antigo) e price_range fora da
    escala — o caminho de TEXTO já canonicaliza; a imagem vazava direto
    para as curadorias. A validação dura agora é igual nos dois caminhos."""
    from app.services.openai_service import OpenAIService  # noqa: F401

    class FakeCompletions:
        def create(self, **kwargs):
            msg = type(
                "M",
                (),
                {
                    "content": json.dumps(
                        {
                            "mood": ["acolhedor"],
                            "ambiance": ["intimista"],  # fora do vocabulário
                            "design": ["moderno"],  # fora do vocabulário
                            "price_range": ["moderate"],  # alias → mid-range
                            "confidence_score": 0.8,
                        }
                    )
                },
            )
            return type("R", (), {"choices": [type("C", (), {"message": msg})]})

    class FakeClient:
        def __init__(self):
            self.chat = type("Chat", (), {"completions": FakeCompletions()})()

    def responder(url):
        return FakeResponse(IMG_BYTES)

    _mk_fake_httpx(monkeypatch, responder)

    service = OpenAIService(api_key="sk-test", db_url="mongodb://x", db_name="db")
    service.client = FakeClient()
    service.config_service = type(
        "Cfg",
        (),
        {
            "get_config": lambda self, s: {
                "model": "gpt-4o",
                "config": {"detail": "high", "temperature": 0.3, "max_tokens": 300},
            },
            "render_prompt": lambda self, s, v: "prompt pronto",
        },
    )()

    class _CatStub:
        async def get_categories(self, entity_type):
            return ["mood", "price_range", "cuisine"]

    service.category_service = _CatStub()

    result = await service.analyze_image(
        "https://api.onrender.com/api/v3/places/photo?reference=abc",
        entity_type="restaurant",
        save_to_cache=False,
    )

    assert "ambiance" not in result
    assert "design" not in result
    assert result["mood"] == ["acolhedor"]
    assert result["price_range"] == ["mid-range"]


async def test_image_url_privado_bloqueado(monkeypatch):
    """RFC1918, link-local (metadata cloud) e reservados são bloqueados."""
    from app.services.openai_service import resolve_image_input

    for url in (
        "http://10.0.0.5/x.png",
        "http://192.168.1.1/x.png",
        "http://172.16.0.1/x.png",
        "http://169.254.169.254/latest/meta-data/",
    ):
        with pytest.raises(ValueError, match="não permitido|não permitida"):
            await resolve_image_input(url)


async def test_image_url_com_credenciais_embutidas_bloqueado(monkeypatch):
    from app.services.openai_service import resolve_image_input

    with pytest.raises(ValueError):
        await resolve_image_input("http://user:pass@example.com/x.png")


async def test_host_nao_resolvivel_bloqueado(monkeypatch):
    """Host que não resolve não pode ser baixado (evita bypass via DNS)."""
    import socket
    from app.services.openai_service import _is_blocked_host

    def fake_getaddrinfo(host, port=None, *args, **kwargs):
        raise socket.gaierror("no address")

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    assert _is_blocked_host("naoexiste.invalid") is True


async def test_download_limita_bytes_durante_streaming(monkeypatch):
    """O limite de 20MB vale DURANTE o download (não depois de baixar tudo)."""
    import httpx
    from app.services.openai_service import resolve_image_input

    class FakeResponse:
        headers = {"content-type": "image/png"}

        def raise_for_status(self):
            return None

        async def aiter_bytes(self):
            chunk = b"x" * 1024
            while True:
                yield chunk

    class FakeStream:
        async def __aenter__(self):
            return FakeResponse()

        async def __aexit__(self, *args):
            return None

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        def stream(self, method, url, **kwargs):
            return FakeStream()

    async def fake_getaddrinfo(host, port=None, *args, **kwargs):
        return [(2, 1, 6, "", ("93.184.216.34", 0))]

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr("socket.getaddrinfo", fake_getaddrinfo)

    with pytest.raises(ValueError, match="maior que"):
        await resolve_image_input("http://example.com/x.png")


async def test_redirect_para_loopback_bloqueado_no_hook(monkeypatch):
    """Cada request da cadeia de redirects passa pelo hook de validação."""
    import httpx
    from app.services.openai_service import _validate_image_request

    req = httpx.Request("GET", "http://127.0.0.1/x.png")
    with pytest.raises(ValueError):
        _validate_image_request(req)
