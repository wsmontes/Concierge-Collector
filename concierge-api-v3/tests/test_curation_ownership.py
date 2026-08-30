"""Testes puros do ownership/takeover de curadorias (regra 2026-08-29).

Sem MongoDB: resolve_ownership_action decide forbidden/transfer/ok.
Regra de negócio: humano→humano é duplicar (não edita direto); curadoria
SINTÉTICA editada por humano TRANSFERE — o curador sintético nunca está no
mesmo nível de um curador humano. Admin em curadoria humana edita sem
transferir (operação administrativa).
"""

from app.models.schemas import CuratorInfo, CurationCreate
from app.services.curation_service import resolve_ownership_action, stored_owner_identity

HUMAN_ADMIN = {"method": "jwt", "user": "anwar@lotier.com", "role": "admin"}
HUMAN_CURATOR = {"method": "jwt", "user": "caio@lotier.com", "role": "curator"}
API_KEY = {"method": "api_key", "user": None, "role": "admin"}


def test_synthetic_edited_by_human_transfers():
    # qualquer humano (admin ou curator) que edita curadoria sintética assume
    assert resolve_ownership_action("curator-ai-research", "synthetic", HUMAN_ADMIN) == "transfer"
    assert resolve_ownership_action("curator-ai-research", "synthetic", HUMAN_CURATOR) == "transfer"


def test_synthetic_edited_by_machine_stays():
    # pipeline reexecutado via API key não transfere (máquina)
    assert resolve_ownership_action("curator-ai-research", "synthetic", API_KEY) == "ok"


def test_legacy_absent_type_treated_as_human():
    # doc legado sem curator_type: aplica a regra de humano
    assert resolve_ownership_action("wagner@lotier.com", None, HUMAN_CURATOR) == "forbidden"
    assert resolve_ownership_action("wagner@lotier.com", "human", HUMAN_CURATOR) == "forbidden"


def test_placeholder_identity_transfers():
    # legado sem dono: qualquer curator logado assume
    assert resolve_ownership_action(None, None, HUMAN_CURATOR) == "transfer"
    assert resolve_ownership_action("unknown", "human", HUMAN_CURATOR) == "transfer"


def test_owner_edits_own_curation():
    assert resolve_ownership_action("caio@lotier.com", "human", HUMAN_CURATOR) == "ok"


def test_admin_edits_human_without_transfer():
    # admin em curadoria humana: operação administrativa, sem transferência
    assert resolve_ownership_action("caio@lotier.com", "human", HUMAN_ADMIN) == "ok"


def test_human_owner_blocks_other_human():
    # humano→humano: caminho é duplicar, não editar
    assert resolve_ownership_action("wagner@lotier.com", "human", HUMAN_CURATOR) == "forbidden"


def test_curation_create_defaults_to_human_curator():
    base = dict(
        curation_id="c1",
        entity_id=None,
        curator_id="x@lotier.com",
        curator=CuratorInfo(id="x@lotier.com", name="X"),
    )
    assert CurationCreate(**base).curator_type == "human"
    synthetic = CurationCreate(**base, curator_type="synthetic")
    assert synthetic.curator_type == "synthetic"


def test_stored_owner_identity_prefers_embedded_real_over_top_placeholder():
    # legado envenenado: top-level 'unknown' com curator.id real — o dono é o real
    doc = {"curator_id": "unknown", "curator": {"id": "real-1", "name": "Nome Real"}}
    assert stored_owner_identity(doc) == "real-1"


def test_stored_owner_identity_falls_back_to_top_level():
    assert stored_owner_identity({"curator_id": "wagner@lotier.com", "curator": {"id": ""}}) == "wagner@lotier.com"
    assert stored_owner_identity({"curator": {"id": "unknown"}}) == "unknown"


def test_stored_owner_identity_returns_none_without_identity():
    assert stored_owner_identity({}) is None
    assert stored_owner_identity({"curator": {}}) is None
