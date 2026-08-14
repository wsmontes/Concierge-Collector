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


class _BaseClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url):  # pragma: no cover
        raise AssertionError(f"httpx não deveria baixar {url} neste teste")


def _mk_fake_httpx(monkeypatch, responder):
    class _Client(_BaseClient):
        async def get(self, url):
            return responder(url)

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
async def test_download_falha_vira_valueerror(monkeypatch):
    class _Fail(_BaseClient):
        async def get(self, url):
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
