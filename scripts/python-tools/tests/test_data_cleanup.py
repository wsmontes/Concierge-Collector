"""
Testes do data_cleanup.py — a guarda do modo execute compara por IDS (não
por contagens): um doc novo com a mesma contagem não pode ser deletado sem
estar no backup.
"""
import data_cleanup


def test_validar_contra_backup_aceita_plano_coberto():
    saved = {
        "curations": [{"_id": "c1"}, {"_id": "c2"}],
        "entities": [{"_id": "e1"}],
        "users": [],
    }
    plano = {"curations": [{"_id": "c1"}], "entities": [], "users": []}
    ok, divergente = data_cleanup.validar_contra_backup(saved, plano)
    assert ok and divergente is None


def test_validar_contra_backup_recusa_id_fora_do_backup():
    """Mesma contagem (1 curation), mas o id atual NÃO está no backup — a
    guarda antiga por contagem aprovaria e deletaria um doc irrecuperável."""
    saved = {"curations": [{"_id": "c1"}], "entities": [], "users": []}
    plano = {"curations": [{"_id": "c-nova"}], "entities": [], "users": []}
    ok, divergente = data_cleanup.validar_contra_backup(saved, plano)
    assert not ok
    assert divergente == "curations"


def test_validar_contra_backup_cobertura_total():
    saved = {"curations": [{"_id": "c1"}], "entities": [{"_id": "e1"}], "users": [{"_id": "u1"}]}
    plano = {"curations": [{"_id": "c1"}], "entities": [{"_id": "e1"}], "users": [{"_id": "u1"}]}
    ok, divergente = data_cleanup.validar_contra_backup(saved, plano)
    assert ok and divergente is None
