"""
Testes do módulo compartilhado mongo_tools (scripts/python-tools/mongo_tools.py).
Cobre: precedência do .env (sobrescreve OPENAI_*, respeita override explícito
do shell para MONGODB_URL) e o empacotamento float32 (implementação única,
compartilhada com a API via app/core/vector_packing.py).
"""
import os
import struct

from bson import Binary

import mongo_tools
from app.core.vector_packing import pack_vector as api_pack_vector
from app.core.vector_packing import try_pack_vector


def test_load_env_overwrites_openai_shell_shadow(tmp_path, monkeypatch):
    """O perfil do shell exporta OPENAI_BASE_URL/OPENAI_API_KEY do LM Studio —
    para essas chaves o .env TEM precedência (overwrite)."""
    env_file = tmp_path / ".env"
    env_file.write_text('OPENAI_API_KEY="sk-proj-do-env"\n')
    monkeypatch.setenv("OPENAI_API_KEY", "lm-studio")
    mongo_tools.load_env(env_file)
    assert os.environ["OPENAI_API_KEY"] == "sk-proj-do-env"


def test_load_env_respects_shell_override_for_mongodb_url(tmp_path, monkeypatch):
    """MONGODB_URL exportada no shell é intenção explícita do operador
    (ex.: testar o rebuild contra um cluster scratch) — setdefault preserva.
    Overwrite silencioso retargetaria comandos destrutivos para produção."""
    env_file = tmp_path / ".env"
    env_file.write_text('MONGODB_URL="mongodb://prod-real.example/db"\n')
    monkeypatch.setenv("MONGODB_URL", "mongodb://scratch-local.example/db")
    mongo_tools.load_env(env_file)
    assert os.environ["MONGODB_URL"] == "mongodb://scratch-local.example/db"


def test_load_env_sets_vars_absent_from_shell(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text('MONGODB_URL="mongodb://do-env.example/db"\n')
    monkeypatch.delenv("MONGODB_URL", raising=False)
    mongo_tools.load_env(env_file)
    assert os.environ["MONGODB_URL"] == "mongodb://do-env.example/db"


def test_load_env_ignores_comments_and_blank_lines(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("# comentario\n\nMONGODB_URL=mongodb://x\n")
    monkeypatch.delenv("MONGODB_URL", raising=False)
    mongo_tools.load_env(env_file)
    assert os.environ["MONGODB_URL"] == "mongodb://x"


def test_load_env_always_env_forces_env_over_shell(tmp_path, monkeypatch):
    """always_env: scripts não destrutivos (backfill) declaram que o .env
    vence para o Mongo também — um MONGODB_URL obsoleto no shell não pode
    retargetar o backfill para o cluster errado."""
    env_file = tmp_path / ".env"
    env_file.write_text('MONGODB_URL="mongodb://do-env.example/db"\n')
    monkeypatch.setenv("MONGODB_URL", "mongodb://do-shell.example/db")
    mongo_tools.load_env(env_file, always_env=("MONGODB_URL",))
    assert os.environ["MONGODB_URL"] == "mongodb://do-env.example/db"


def test_pack_vector_is_the_api_implementation():
    """Implementação ÚNICA do formato: scripts e API compartilham a função
    (uma mudança de formato não pode derivar entre as duas árvores)."""
    assert mongo_tools.pack_vector is api_pack_vector


def test_pack_vector_rejects_dict_instead_of_packing_garbage():
    """dict iteraria as CHAVES e empacotaria floats sem sentido — deve falhar."""
    import pytest

    with pytest.raises(TypeError):
        mongo_tools.pack_vector({"0": 0.31, "1": -0.2})


def test_try_pack_vector_returns_none_for_unpackable():
    assert try_pack_vector({"0": 0.31}) is None
    assert try_pack_vector([]) is None
    assert try_pack_vector(None) is None
    assert try_pack_vector("abc") is None
    assert isinstance(try_pack_vector([1.0, 2.0]), Binary)
    already = Binary(b"\x00\x00\x80?")
    assert try_pack_vector(already) is already


def test_pack_vector_converts_list_to_binary_float32():
    packed = mongo_tools.pack_vector([1.0, -0.5, 0.25])
    assert isinstance(packed, Binary)
    assert struct.unpack("<3f", packed) == (1.0, -0.5, 0.25)


def test_pack_vector_passes_through_existing_binary():
    already = Binary(b"\x00\x00\x80?")
    assert mongo_tools.pack_vector(already) is already


def test_pack_vector_roundtrip_1536_dims():
    vals = [float(i % 7) / 7.0 for i in range(1536)]
    packed = mongo_tools.pack_vector(vals)
    assert len(packed) == 1536 * 4
    # float32 perde precisão vs double — compara contra o float32 esperado
    expected = [struct.unpack("<f", struct.pack("<f", v))[0] for v in vals]
    assert struct.unpack("<1536f", packed) == tuple(expected)
