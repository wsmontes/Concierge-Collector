"""
Testes do loader de settings do merge_restaurant_datasets.py — o --apply
estava sempre quebrado: procurava .env na raiz do repo (não existe) e lia a
chave errada (API_KEY em vez de API_SECRET_KEY).
"""
import pytest

from merge_restaurant_datasets import load_settings


def test_load_settings_reads_api_secret_key_from_env(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text('API_SECRET_KEY="sk-secret-teste"\n')
    url, key = load_settings(env_file)
    assert key == "sk-secret-teste"
    assert url.endswith("/entities/bulk")


def test_load_settings_raises_without_key(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text('OUTRA_COISA=x\n')
    with pytest.raises(RuntimeError, match="API_SECRET_KEY"):
        load_settings(env_file)
