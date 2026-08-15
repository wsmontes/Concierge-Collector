"""
Test authentication endpoints
"""


class TestAuthEndpoints:
    """Test OAuth and authentication"""

    def test_google_oauth_login(self, client):
        """Test initiating Google OAuth login"""
        response = client.get("/api/v3/auth/google")

        # Expect 404 if not configured
        assert response.status_code == 404

    def test_google_oauth_callback_missing_code(self, client):
        """Test OAuth callback without code"""
        response = client.get("/api/v3/auth/callback")

        # Current API returns explicit bad request for missing parameters
        assert response.status_code in [400, 422]

    def test_google_oauth_callback_invalid_code(self, client):
        """Test OAuth callback with invalid code"""
        response = client.get("/api/v3/auth/callback?code=invalid_code&state=test")

        # Should fail with invalid code
        assert response.status_code == 400

    def test_logout(self, client):
        """Test logout endpoint"""
        response = client.post("/api/v3/auth/logout")

        # Depending on auth policy, logout may require a token
        assert response.status_code in [200, 401]

    def test_verify_token_without_auth(self, client):
        """Test verifying token without authentication"""
        response = client.get("/api/v3/auth/verify")

        # Should fail without auth
        assert response.status_code == 401

    def test_refresh_token_without_data(self, client):
        """Test refreshing token without refresh token"""
        response = client.post("/api/v3/auth/refresh", json={})

        # Should fail without refresh token
        assert response.status_code == 422


class TestAuthValidation:
    """Test authentication validation"""

    def test_protected_endpoint_without_token(self, client):
        """Test accessing protected endpoint without token"""
        response = client.post(
            "/api/v3/entities",
            json={"entity_id": "test", "type": "restaurant", "name": "Test"},
        )

        # Should fail without auth
        assert response.status_code == 401

    def test_protected_endpoint_invalid_token(self, client):
        """Test accessing protected endpoint with invalid token"""
        headers = {"Authorization": "Bearer invalid_token"}
        response = client.post(
            "/api/v3/entities",
            json={"entity_id": "test", "type": "restaurant", "name": "Test"},
            headers=headers,
        )

        # Should fail with invalid token
        assert response.status_code == 401


import os  # noqa: E402  (import localizado — depende de setup acima)
from unittest.mock import patch  # noqa: E402


def test_oauth_callback_error_never_echoes_raw_param():
    """O query param `error` do callback NUNCA volta cru ao frontend — o valor
    ecoaria via redirect na tela de login do collector (XSS no origin)."""
    from unittest.mock import MagicMock
    from app.api.auth import google_oauth_callback

    resp = google_oauth_callback(
        code=None,
        state=None,
        error="<script>alert(1)</script>",
        db=MagicMock(),
    )
    url = resp.headers.get("location", "")
    assert "<script" not in url
    assert "Login%20failed" in url


def test_oauth_callback_access_denied_friendly_message():
    from unittest.mock import MagicMock
    from app.api.auth import google_oauth_callback

    resp = google_oauth_callback(code=None, state=None, error="access_denied", db=MagicMock())
    url = resp.headers.get("location", "")
    assert "Login%20cancelled%20by%20user" in url


def test_testing_bypass_only_works_in_development():
    """TESTING=true só deve bypassar auth quando ENVIRONMENT=development."""
    from app.core.security import verify_access_token
    from app.core.config import settings

    # Salva valores originais
    orig_testing = os.environ.get("TESTING")
    settings.environment

    try:
        os.environ["TESTING"] = "true"

        # Caso 1: development deve permitir bypass
        with patch.object(settings, "environment", "development"):
            # Não deve lançar exceção
            import asyncio

            result = asyncio.run(verify_access_token(credentials=None))
            assert result["sub"] == "test@example.com"

        # Caso 2: production NÃO deve permitir bypass
        with patch.object(settings, "environment", "production"):
            from fastapi import HTTPException

            try:
                asyncio.run(verify_access_token(credentials=None))
                assert False, "Deveria ter lançado HTTPException 401"
            except HTTPException as e:
                assert e.status_code == 401
    finally:
        if orig_testing is not None:
            os.environ["TESTING"] = orig_testing
        else:
            os.environ.pop("TESTING", None)


def test_oauth_init_rejects_untrusted_callback_url(client):
    """callback_url deve ser validado contra allowlist de origens confiáveis."""

    # URL maliciosa deve ser rejeitada ou ignorada (usar default)
    response = client.get(
        "/api/v3/auth/google?callback_url=https://evil.com/steal",
        follow_redirects=False,
    )

    # Deve rejeitar com 400 (não redirecionar silenciosamente)
    assert response.status_code == 400
    data = response.json()
    assert "Untrusted callback URL" in data.get("detail", "")


def test_oauth_init_accepts_trusted_callback_url():
    """callback_url de origens confiáveis deve ser aceito."""
    from fastapi.testclient import TestClient
    from main import app
    from app.core.config import settings
    from urllib.parse import urlparse, parse_qs
    from jose import jwt

    client = TestClient(app)

    trusted = settings.frontend_url
    response = client.get(
        f"/api/v3/auth/google?callback_url={trusted}",
        follow_redirects=False,
    )

    # Deve redirecionar para o Google (não erro)
    assert response.status_code == 307  # RedirectResponse

    # Verificar que a URL confiável está presente no state
    location = response.headers.get("location", "")
    parsed = urlparse(location)
    params = parse_qs(parsed.query)
    state_encoded = params.get("state", [""])[0]
    assert state_encoded, "State deveria estar presente"
    decoded = jwt.decode(state_encoded, settings.api_secret_key, algorithms=["HS256"])
    sd = decoded.get("sd", "")
    assert trusted in sd, f"State deveria conter a URL confiável: {sd}"


# --- Cookie HttpOnly (aditivo, ago/2026) ------------------------------------


def _dev_login_cookie(client):
    """Faz dev-login e devolve o valor do cookie access_token (ou None)."""
    resp = client.get("/api/v3/auth/dev-login")
    assert resp.status_code == 200, resp.text
    set_cookie = resp.headers.get("set-cookie", "")
    for part in set_cookie.split(";"):
        part = part.strip()
        if part.startswith("access_token="):
            return part[len("access_token=") :]
    return None


def test_dev_login_define_cookie_httponly(client):
    cookie = _dev_login_cookie(client)
    assert cookie, "dev-login deveria definir o cookie access_token"
    set_cookie = client.get("/api/v3/auth/dev-login").headers.get("set-cookie", "")
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie or "samesite=lax" in set_cookie.lower()


def test_cookie_autentica_sem_bearer(client):
    cookie = _dev_login_cookie(client)
    assert cookie
    # /og-image/stats exige JWT (verify_auth) — só o cookie autentica
    resp = client.get("/api/v3/og-image/stats", headers={"Cookie": f"access_token={cookie}"})
    assert resp.status_code == 200, resp.text


def test_cookie_invalido_e_rejeitado(client):
    resp = client.get("/api/v3/og-image/stats", headers={"Cookie": "access_token=nao-e-jwt"})
    assert resp.status_code == 401


def test_logout_limpa_o_cookie(client):
    login = client.get("/api/v3/auth/dev-login").json()
    bearer = login.get("access_token")
    assert bearer
    resp = client.post("/api/v3/auth/logout", headers={"Authorization": f"Bearer {bearer}"})
    set_cookie = resp.headers.get("set-cookie", "")
    assert "access_token=" in set_cookie  # clear: valor vazio/expiração
    lowered = set_cookie.lower().replace(" ", "")
    assert "max-age=0" in lowered or 'access_token="";' in lowered or "access_token=;" in lowered
