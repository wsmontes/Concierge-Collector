"""
Testes de generate_embeddings.py — o cliente OpenAI nunca pode cair no
LM Studio do shell (OPENAI_BASE_URL=http://localhost:1234/v1) e o modo 2
(só curadorias sem embeddings) não pode reprocessar tudo.
"""
import os

import pytest

import generate_embeddings
from tests.fakes import FakeCollection, FakeDB


def test_openai_client_kwargs_env_key_wins_and_base_url_explicit(tmp_path, monkeypatch):
    """O shell exporta OPENAI_API_KEY=lm-studio e OPENAI_BASE_URL local — os
    kwargs do cliente têm que usar a chave do .env e SEMPRE o base_url real."""
    env_file = tmp_path / ".env"
    env_file.write_text('OPENAI_API_KEY="sk-proj-do-env"\n')
    monkeypatch.setenv("OPENAI_API_KEY", "lm-studio")
    monkeypatch.setenv("OPENAI_BASE_URL", "http://localhost:1234/v1")
    kwargs = generate_embeddings.openai_client_kwargs(env_file)
    assert kwargs["api_key"] == "sk-proj-do-env"
    assert kwargs["base_url"] == "https://api.openai.com/v1"


def test_curations_sem_embeddings_selects_only_missing_or_empty():
    """Modo 2: só curadorias SEM embeddings (a API /search projeta o campo
    fora da resposta, então o filtro precisa ir direto no Mongo)."""
    docs = [
        {"_id": "sem-embeddings", "status": "active", "categories": {"cuisine": ["x"]}},
        {"_id": "vazia", "status": "active", "embeddings": [], "categories": {}},
        {"_id": "ja-tem", "status": "active", "embeddings": [{"text": "x"}]},
        {"_id": "deletada", "status": "deleted", "categories": {}},
    ]
    db = FakeDB({"curations": FakeCollection(docs)})
    selecionadas = {c["curation_id"] for c in generate_embeddings.curations_sem_embeddings(db)}
    assert selecionadas == {"sem-embeddings", "vazia"}


def test_curations_sem_embeddings_dict_shape_for_processing_loop():
    """Os dicts retornados precisam ter curation_id/entity_id/categories —
    o mesmo formato que get_all_curations() entrega à main()."""
    db = FakeDB({"curations": FakeCollection([
        {"_id": "c1", "entity_id": "e1", "categories": {"cuisine": ["japonesa"]}},
    ])})
    [c] = generate_embeddings.curations_sem_embeddings(db)
    assert c["curation_id"] == "c1"
    assert c["entity_id"] == "e1"
    assert c["categories"] == {"cuisine": ["japonesa"]}
