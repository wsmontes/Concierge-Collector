"""
Test configuration and fixtures
"""

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from pymongo import MongoClient
import os
from pathlib import Path
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

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

# Testes unitários não podem herdar a URL Atlas pessoal do `.env`. Estes
# valores são definidos antes do dotenv para que `load_dotenv` não os
# sobrescreva; nenhum client Mongo é aberto no caminho padrão de testes.
os.environ["MONGODB_URL"] = "mongodb://127.0.0.1:27017"
os.environ["MONGODB_DB_NAME"] = "concierge-collector-test"
os.environ["ENVIRONMENT"] = "development"
os.environ["API_SECRET_KEY"] = "test-api-secret-key"
os.environ["ADMIN_API_KEYS"] = ""

# Load .env file before importing app
from dotenv import load_dotenv

env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

# O handoff do CMS usa uma credencial de serviço distinta. Fixá-la antes de
# importar ``main`` garante que esses testes nunca herdam, exibem ou dependem
# de uma credencial de produção carregada do ambiente local.
os.environ["CMS_SERVICE_KEY"] = "test-cms-key"
os.environ["CMS_ADMIN_ORIGIN"] = "https://admin.concierge-collector.com"
os.environ["CMS_ADMIN_CALLBACK_URL"] = "https://admin.concierge-collector.com/auth/callback"
os.environ["METRICS_KEY"] = "test-metrics-key"

from main import app  # noqa: E402  (import DEPOIS do setup de env acima)
from app.core.config import settings  # noqa: E402
from app.core.database import get_database  # noqa: E402


class InMemoryCollection:
    """Subset of PyMongo usado pelos testes de autenticação sem rede."""

    def __init__(self):
        self.documents: list[dict] = []

    @staticmethod
    def _value(document: dict, key: str):
        value = document
        for part in key.split("."):
            if not isinstance(value, dict):
                return None
            value = value.get(part)
        return value

    @classmethod
    def _matches(cls, document: dict, query: dict) -> bool:
        for key, expected in query.items():
            if key == "$or":
                if not any(cls._matches(document, branch) for branch in expected):
                    return False
                continue
            if key == "$and":
                if not all(cls._matches(document, branch) for branch in expected):
                    return False
                continue

            actual = cls._value(document, key)
            if not isinstance(expected, dict):
                if actual != expected:
                    return False
                continue

            for operator, operand in expected.items():
                if operator == "$ne" and actual == operand:
                    return False
                if operator == "$in" and actual not in operand:
                    return False
                if operator == "$gte" and (actual is None or actual < operand):
                    return False
                if operator == "$gt" and (actual is None or actual <= operand):
                    return False
                if operator == "$lte" and (actual is None or actual > operand):
                    return False
                if operator == "$lt" and (actual is None or actual >= operand):
                    return False
                if operator == "$exists" and (actual is not None) != operand:
                    return False
                if operator == "$regex":
                    import re

                    if actual is None or not re.search(operand, str(actual), re.IGNORECASE):
                        return False
        return True

    @staticmethod
    def _project(document: dict, projection: dict | None) -> dict:
        if not projection:
            return deepcopy(document)
        included = [key for key, value in projection.items() if value and key != "_id"]
        if not included:
            result = deepcopy(document)
            for key, value in projection.items():
                if not value:
                    result.pop(key, None)
            return result
        result = {key: document[key] for key in included if key in document}
        if projection.get("_id", 1) and "_id" in document:
            result["_id"] = document["_id"]
        return result

    def find_one(self, query: dict, projection: dict | None = None):
        for document in self.documents:
            if self._matches(document, query):
                return self._project(document, projection)
        return None

    def find(self, query: dict | None = None, projection: dict | None = None):
        return InMemoryCursor(
            self._project(document, projection) for document in self.documents if self._matches(document, query or {})
        )

    def count_documents(self, query: dict) -> int:
        return sum(self._matches(document, query) for document in self.documents)

    def insert_one(self, document: dict):
        stored = deepcopy(document)
        stored.setdefault("_id", uuid4().hex)
        self.documents.append(stored)
        return SimpleNamespace(inserted_id=stored["_id"])

    def update_one(self, query: dict, update: dict, upsert: bool = False):
        for document in self.documents:
            if self._matches(document, query):
                document.update(deepcopy(update.get("$set", {})))
                return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
        if not upsert:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        document = deepcopy(query)
        document.update(deepcopy(update.get("$setOnInsert", {})))
        document.update(deepcopy(update.get("$set", {})))
        result = self.insert_one(document)
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=result.inserted_id)

    def find_one_and_update(self, query: dict, update: dict, **_kwargs):
        for document in self.documents:
            if self._matches(document, query):
                original = deepcopy(document)
                document.update(deepcopy(update.get("$set", {})))
                return deepcopy(document) if _kwargs.get("return_document") else original
        return None

    def create_index(self, *_args, **_kwargs):
        return "in-memory-index"

    def index_information(self):
        return {}

    def drop_index(self, *_args, **_kwargs):
        return None

    def aggregate(self, *_args, **_kwargs):
        return InMemoryCursor([])

    def delete_one(self, query: dict):
        for index, document in enumerate(self.documents):
            if self._matches(document, query):
                self.documents.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    def delete_many(self, query: dict):
        before = len(self.documents)
        self.documents = [document for document in self.documents if not self._matches(document, query)]
        return SimpleNamespace(deleted_count=before - len(self.documents))


class InMemoryCursor(list):
    """Cursor encadeável suficiente para as leituras unitárias da API."""

    def __init__(self, documents):
        super().__init__(documents)

    def sort(self, key_or_list, direction=None):
        pairs = key_or_list if isinstance(key_or_list, list) else [(key_or_list, direction or 1)]
        for key, sort_direction in reversed(pairs):
            super().sort(
                key=lambda document: InMemoryCollection._value(document, key) or "", reverse=sort_direction < 0
            )
        return self

    def skip(self, amount):
        del self[:amount]
        return self

    def limit(self, amount):
        del self[amount:]
        return self


class InMemoryDatabase:
    """Collections criadas sob demanda para dependências FastAPI unitárias."""

    def __init__(self):
        self._collections: dict[str, InMemoryCollection] = {}
        self.name = "concierge-collector-test"

    def __getattr__(self, name: str) -> InMemoryCollection:
        return self[name]

    def __getitem__(self, name: str) -> InMemoryCollection:
        return self._collections.setdefault(name, InMemoryCollection())

    def command(self, command: str):
        if command != "ping":
            raise ValueError(f"Unsupported in-memory command: {command}")
        return {"ok": 1}


class InMemoryMongoClient:
    """Cliente mínimo para o lifecycle FastAPI, sem qualquer conexão de rede."""

    def __init__(self, database: InMemoryDatabase):
        self._database = database
        self.admin = self

    def __getitem__(self, _name: str) -> InMemoryDatabase:
        return self._database

    def command(self, command: str):
        return self._database.command(command)

    def close(self):
        return None


class UnavailableAIOrchestrator:
    """Mantém testes de transporte fora de provedores OpenAI e Mongo reais."""

    async def orchestrate(self, *_args, **_kwargs):
        raise ValueError("AI provider unavailable in unit tests")


@pytest.fixture(scope="session")
def in_memory_db():
    return InMemoryDatabase()


def pytest_addoption(parser):
    """Add custom command line options."""
    parser.addoption(
        "--run-integration",
        action="store_true",
        default=False,
        help="Run integration tests that hit external APIs",
    )
    parser.addoption(
        "--run-mongo",
        action="store_true",
        default=False,
        help="Run @pytest.mark.mongo tests against MONGODB_TEST_URL",
    )


@pytest.fixture(scope="session")
def hermetic_test_database(pytestconfig):
    """Opt-in Mongo database; it can only target an explicitly named test DB."""
    if not pytestconfig.getoption("--run-mongo"):
        pytest.skip("Mongo tests require --run-mongo and MONGODB_TEST_URL")
    mongo_url = os.environ.get("MONGODB_TEST_URL", "")
    database_name = os.environ.get("MONGODB_TEST_DB_NAME", "concierge-collector-test")
    if not mongo_url:
        pytest.skip("Mongo tests require MONGODB_TEST_URL")
    if not database_name.endswith("-test"):
        raise RuntimeError("MONGODB_TEST_DB_NAME must end with '-test'")

    mongo_client = MongoClient(mongo_url)
    mongo_client.drop_database(database_name)
    try:
        yield mongo_client[database_name]
    finally:
        mongo_client.close()


@pytest.fixture
def test_db(hermetic_test_database, monkeypatch):
    """Mongo real somente para testes marcados e opt-in; sempre `<name>-test`."""
    monkeypatch.setattr(settings, "mongodb_url", os.environ["MONGODB_TEST_URL"])
    monkeypatch.setattr(settings, "mongodb_db_name", os.environ.get("MONGODB_TEST_DB_NAME", "concierge-collector-test"))
    return hermetic_test_database


@pytest.fixture(scope="session")
def client(in_memory_db):
    """Client global com lifecycle e banco em memória — sem Atlas no gate unitário."""
    from app.core import database
    from app.api.ai import get_ai_orchestrator

    original_client = database._client
    original_connect = database.connect_to_mongo
    sentinel = object()
    previous_orchestrator_override = app.dependency_overrides.get(get_ai_orchestrator, sentinel)

    def connect_in_memory():
        database._client = InMemoryMongoClient(in_memory_db)

    database.connect_to_mongo = connect_in_memory
    app.dependency_overrides[get_ai_orchestrator] = UnavailableAIOrchestrator
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        database.connect_to_mongo = original_connect
        database._client = original_client
        if previous_orchestrator_override is sentinel:
            app.dependency_overrides.pop(get_ai_orchestrator, None)
        else:
            app.dependency_overrides[get_ai_orchestrator] = previous_orchestrator_override


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
async def async_client(request, in_memory_db):
    """Async client sem conexão implícita; Mongo exige o mesmo opt-in do client sync."""
    from httpx import ASGITransport, AsyncClient

    database = in_memory_db
    if request.node.get_closest_marker("mongo"):
        database = request.getfixturevalue("test_db")

    sentinel = object()
    previous_override = app.dependency_overrides.get(get_database, sentinel)
    app.dependency_overrides[get_database] = lambda: database
    try:
        # ASGITransport não entra no lifespan; o override evita abrir Mongo
        # tanto nos testes unitários quanto nos testes @mongo opt-in.
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as test_client:
            yield test_client
    finally:
        if previous_override is sentinel:
            app.dependency_overrides.pop(get_database, None)
        else:
            app.dependency_overrides[get_database] = previous_override


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
