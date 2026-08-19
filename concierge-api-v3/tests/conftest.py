"""
Test configuration and fixtures
"""

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from pymongo import MongoClient
import os
from pathlib import Path

# O zsh do dev exporta OPENAI_BASE_URL=http://localhost:1234/v1 (LM Studio) e
# OPENAI_API_KEY=lm-studio — pydantic-settings congela essas env vars no
# singleton `settings` no import, e qualquer teste que passe pelo OpenAI SDK
# falha com 'No models loaded'/401. load_dotenv NÃO sobrescreve env existente,
# então a poluição conhecida precisa sair ANTES do load_dotenv carregar os
# valores reais do .env; exportações reais (chave/base_url legítimas) são
# preservadas.
if (
    "localhost:1234" in os.environ.get("OPENAI_BASE_URL", "")
    or os.environ.get("OPENAI_API_KEY", "").strip().lower() == "lm-studio"
):
    for _var in ("OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"):
        os.environ.pop(_var, None)

# Load .env file before importing app
from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

# TESTES NUNCA TOCAM O ATLAS DE PRODUÇÃO: banco de teste dedicado
# (<nome>-test) forçado ANTES do import — pydantic-settings congela settings
# no import, e get_database/lifespan seguem o settings. Sem isso, mongo tests
# inserem/apagam docs no banco real e asserts dependem do volume de produção
# (o incidente do '0-' prefix no review 30).
os.environ["MONGODB_DB_NAME"] = f"{os.environ.get('MONGODB_DB_NAME', 'concierge-collector')}-test"

from main import app  # noqa: E402  (import DEPOIS do setup de env acima)
from app.core.config import settings  # noqa: E402


@pytest.fixture(scope="session")
def hermetic_test_database():
    """Drop do banco de teste no início da sessão (startup recria índices);
    mantém o banco ao final para inspeção pós-falha."""
    client = MongoClient(settings.mongodb_url)
    client.drop_database(settings.mongodb_db_name)
    client.close()
    yield


@pytest.fixture(scope="session")
def test_db():
    """Banco de teste HERMÉTICO (<db>-test, dropado no início da sessão) —
    nunca o Atlas de produção."""
    client = MongoClient(settings.mongodb_url)
    db = client[settings.mongodb_db_name]
    yield db
    client.close()


@pytest.fixture(scope="session")
def client(hermetic_test_database):
    """FastAPI test client — hermetic_test_database garante o drop ANTES do
    startup (lifespan cria os índices no banco de teste vazio)."""
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _client_cookie_isolation(request):
    """Isola o jar de cookies ENTRE testes (2026-08-15): o client é
    session-scoped e o TestClient persiste cookies — o dev-login de
    test_auth deixava o access_token no jar e autenticava requests "sem
    credencial" dos testes seguintes (poluição cross-file).

    Não pede o fixture ``client`` incondicionalmente: testes unitários de
    serviços não devem iniciar a aplicação nem depender de MongoDB remoto.
    """
    if "client" not in request.fixturenames:
        yield
        return

    client = request.getfixturevalue("client")
    yield
    client.cookies.clear()


@pytest.fixture(scope="function")
def clean_test_entities(test_db):
    """Clean test entities before and after each test"""
    # Clean before
    test_db.entities.delete_many({"_id": {"$regex": "^test_"}})
    yield
    # Clean after
    test_db.entities.delete_many({"_id": {"$regex": "^test_"}})


@pytest.fixture(scope="function")
def clean_test_curations(test_db):
    """Clean test curations before and after each test"""
    # Clean before
    test_db.curations.delete_many({"entity_id": {"$regex": "^test_"}})
    yield
    # Clean after
    test_db.curations.delete_many({"entity_id": {"$regex": "^test_"}})


@pytest.fixture
def test_google_api_key():
    """Get Google Places API key from settings for integration tests"""
    return settings.google_places_api_key if hasattr(settings, "google_places_api_key") else None


@pytest.fixture
def test_place_id():
    """Provide a known valid place ID for testing"""
    # Using a well-known place: Google's Sydney office
    return "ChIJN1t_tDeuEmsRUsoyG83frY4"


def pytest_addoption(parser):
    """Add custom command line options"""
    parser.addoption(
        "--run-integration",
        action="store_true",
        default=False,
        help="Run integration tests that hit external APIs",
    )


@pytest.fixture
def sample_entity():
    """Sample entity data for testing"""
    return {
        "entity_id": "test_restaurant_001",
        "type": "restaurant",
        "name": "Test Restaurant",
        "data": {"address": "123 Test St", "cuisine": "Italian"},
    }


@pytest.fixture
def sample_curation():
    """Sample curation data for testing"""
    return {
        "curation_id": "test_curation_001",
        "entity_id": "test_restaurant_001",
        "curator_id": "test_curator",
        "status": "draft",
        "curator": {"id": "test_curator", "name": "Test Curator"},
        "data": {"notes": "Test notes"},
    }


# Auth bypass removed - tests must use real authentication
# Use auth_headers fixture with valid API key from .env


@pytest_asyncio.fixture(scope="function")
async def async_client():
    """Async test client for testing async endpoints"""
    from httpx import ASGITransport, AsyncClient
    from app.core.database import connect_to_mongo, _client

    # Ensure MongoDB is connected for async tests
    if _client is None:
        connect_to_mongo()

    # Use ASGITransport to mount the FastAPI app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture
def auth_headers():
    """Real auth headers — primeira chave da lista ADMIN_API_KEYS (fallback
    API_SECRET_KEY; separação de segredos 2026-08-15)."""
    keys = settings.admin_api_key_list
    if not keys:
        pytest.skip("API_SECRET_KEY/ADMIN_API_KEYS not set in .env")
    return {"X-API-Key": keys[0]}


@pytest.fixture
def auth_token():
    """API key for tests that expect just the token"""
    keys = settings.admin_api_key_list
    if not keys:
        pytest.skip("API_SECRET_KEY/ADMIN_API_KEYS not set in .env")
    return keys[0]
