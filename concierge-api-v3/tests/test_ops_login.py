"""Acesso de operação (POST /api/v3/auth/ops-login).

O endpoint troca a PROVA de identidade (o Google) por uma chave de operação; a
autorização continua sendo a do banco. Estes testes travam as propriedades que
fazem isso ser seguro em produção:

- fail-closed: sem configuração, a rota responde como se não existisse;
- chave errada recebe a MESMA resposta de rota inexistente (sem oráculo);
- nenhuma chave malformada vira 500;
- nenhum sujeito que já não fosse admin autorizado ganha sessão;
- a chave nunca aparece em log;
- o token nunca entra em query string (só no fragmento e em cookie HttpOnly).

`client` e `in_memory_db` são session-scoped: cada teste usa um sujeito próprio,
senão o documento do vizinho é que responde ao `find_one`.
"""

import logging
from datetime import datetime, timezone
from urllib.parse import urlsplit

import pytest
from jose import jwt

from app.core.config import settings
from app.core.security import ALGORITHM, get_jwt_secret

OPS_KEY = "ops-key-de-teste-nao-usar-em-producao"
FRONTEND = "https://collector.ops-test.example"


@pytest.fixture
def ops_identity(request):
    # Um sujeito por teste: e-mail tem limite de 64 chars no local-part, então
    # o nome do teste entra como dígitos, não literalmente.
    return f"ops{abs(hash(request.node.name)) % 10**10}@conciergecollector.com"


@pytest.fixture
def ops_configured(monkeypatch, ops_identity):
    monkeypatch.setattr(settings, "ops_login_key", OPS_KEY)
    monkeypatch.setattr(settings, "ops_login_subject", ops_identity)
    # Qualquer que seja o ambiente da suíte, o alvo do redirect é previsível.
    monkeypatch.setattr(settings, "frontend_url", FRONTEND)
    monkeypatch.setattr(settings, "frontend_url_production", FRONTEND)


def _seed_user(db, email, *, role="admin", authorized=True):
    db.users.insert_one(
        {
            "_id": email,
            "email": email,
            "google_id": "google-ops",
            "name": "Ops User",
            "picture": None,
            "authorized": authorized,
            "role": role,
            "created_at": datetime.now(timezone.utc),
            "last_login": None,
            "refresh_token": None,
        }
    )


def _post(client, key, redirect=False):
    # `follow_redirects=False`: o default do TestClient seguiria o 303 até a
    # raiz do Collector, e o teste mediria o app do vizinho, não a rota.
    return client.post("/api/v3/auth/ops-login", json={"key": key, "redirect": redirect}, follow_redirects=False)


class TestOpsLoginFailClosed:
    """Sem as duas variáveis, a rota não existe para quem sonda."""

    def test_unconfigured_route_is_not_found_and_writes_nothing(self, client, in_memory_db, ops_identity):
        _seed_user(in_memory_db, ops_identity)

        response = _post(client, OPS_KEY)

        assert response.status_code == 404
        assert response.json() == {"detail": "Not Found"}
        assert list(in_memory_db.auth_sessions.find({})) == []
        assert in_memory_db.users.find_one({"email": ops_identity})["last_login"] is None

    def test_only_the_subject_missing_also_closes_the_route(self, client, ops_configured, monkeypatch):
        monkeypatch.setattr(settings, "ops_login_subject", "")

        assert _post(client, OPS_KEY).status_code == 404

    def test_wrong_key_is_indistinguishable_from_an_unconfigured_route(
        self, client, ops_configured, in_memory_db, ops_identity
    ):
        _seed_user(in_memory_db, ops_identity)

        response = _post(client, f"{OPS_KEY}-errado")

        assert response.status_code == 404
        assert response.json() == {"detail": "Not Found"}
        assert list(in_memory_db.auth_sessions.find({})) == []

    def test_a_malformed_key_does_not_turn_into_a_server_error(
        self, client, ops_configured, in_memory_db, ops_identity
    ):
        """`compare_digest` com str não-ASCII levanta TypeError; a rota fecha igual."""
        _seed_user(in_memory_db, ops_identity)

        assert _post(client, "chave").status_code == 404
        assert _post(client, "𝕜𝕖𝕪").status_code == 404
        assert _post(client, "").status_code == 404

    def test_the_key_never_reaches_the_logs(self, client, ops_configured, in_memory_db, ops_identity, caplog):
        _seed_user(in_memory_db, ops_identity)

        with caplog.at_level(logging.DEBUG):
            _post(client, OPS_KEY)
            _post(client, f"{OPS_KEY}-errado")

        assert OPS_KEY not in caplog.text
        assert "Session issued" in caplog.text


class TestOpsLoginAuthorization:
    """A chave prova identidade; quem entra continua decidido pelo banco."""

    def test_unknown_subject_is_refused(self, client, ops_configured):
        assert _post(client, OPS_KEY).status_code == 403

    def test_authorized_curator_is_refused(self, client, ops_configured, in_memory_db, ops_identity):
        _seed_user(in_memory_db, ops_identity, role="curator")

        assert _post(client, OPS_KEY).status_code == 403

    def test_admin_without_authorization_is_refused(self, client, ops_configured, in_memory_db, ops_identity):
        _seed_user(in_memory_db, ops_identity, authorized=False)

        assert _post(client, OPS_KEY).status_code == 403

    def test_an_authorized_admin_gets_the_same_session_as_oauth(
        self, client, ops_configured, in_memory_db, ops_identity
    ):
        _seed_user(in_memory_db, ops_identity)

        response = _post(client, OPS_KEY)

        assert response.status_code == 200
        body = response.json()
        claims = jwt.decode(body["access_token"], get_jwt_secret(), algorithms=[ALGORITHM])
        assert claims["sub"] == ops_identity
        assert claims["role"] == "admin"
        assert claims["type"] == "access"
        assert body["expires_in"] == settings.access_token_expire_minutes * 60

        cookies = response.cookies
        assert cookies.get("access_token") == body["access_token"]
        assert cookies.get("refresh_token") == body["refresh_token"]
        refreshed = jwt.decode(body["refresh_token"], get_jwt_secret(), algorithms=[ALGORITHM])
        assert refreshed["type"] == "refresh"
        # O refresh fica registrado no servidor, como em qualquer login: é assim
        # que o logout e a rotação de sessão têm o que revogar.
        sessions = list(in_memory_db.auth_sessions.find({"sub": ops_identity}))
        assert [session["jti"] for session in sessions] == [refreshed["jti"]]

    def test_the_session_marks_the_login_and_the_curator_row(self, client, ops_configured, in_memory_db, ops_identity):
        _seed_user(in_memory_db, ops_identity)

        assert _post(client, OPS_KEY).status_code == 200

        assert in_memory_db.users.find_one({"email": ops_identity})["last_login"] is not None
        assert in_memory_db.curators.find_one({"curator_id": ops_identity})["name"] == "Ops User"


class TestOpsLoginCollectorRedirect:
    """O Collector consome a sessão pelo fragmento, igual ao callback do Google."""

    def test_redirect_carries_the_session_in_the_fragment_to_the_frontend(
        self, client, ops_configured, in_memory_db, ops_identity
    ):
        _seed_user(in_memory_db, ops_identity)

        response = _post(client, OPS_KEY, redirect=True)

        assert response.status_code == 303
        target = urlsplit(response.headers["location"])
        assert f"{target.scheme}://{target.netloc}{target.path}" == f"{FRONTEND}/"
        assert target.query == "session=1"
        assert "token=" in target.fragment and "refresh_token=" in target.fragment
        # Query string vai para o log do proxy; fragmento não. Um token em
        # query seria segredo persistido em log.
        assert "token" not in target.query
        assert response.cookies.get("access_token")

    def test_the_default_response_opens_no_redirect(self, client, ops_configured, in_memory_db, ops_identity):
        _seed_user(in_memory_db, ops_identity)

        assert "location" not in _post(client, OPS_KEY).headers
