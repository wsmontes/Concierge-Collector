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
        """Test refreshing token without refresh token (nem cookie)"""
        response = client.post("/api/v3/auth/refresh", json={}, cookies={"refresh_token": ""})

        # Should fail without refresh token
        assert response.status_code == 401


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


# --- Refresh com ROTAÇÃO + cookie (2026-08-15) -------------------------------


def test_refresh_rotaciona_e_revoga_jti_antigo(client):
    """Reuso do refresh antigo após rotação → 401 (detecção de replay)."""
    # ATENÇÃO: o TestClient persiste cookies no jar — o dev-login deixa o
    # cookie refresh_token lá; sem o override, o endpoint leria o cookie
    # (caminho preferencial) em vez do body sob teste. cookies={"refresh_token": ""}
    # anula o jar para isolar o body.
    login = client.get("/api/v3/auth/dev-login").json()
    refresh = login.get("refresh_token")
    assert refresh

    r1 = client.post("/api/v3/auth/refresh", json={"refresh_token": refresh}, cookies={"refresh_token": ""})
    assert r1.status_code == 200, r1.text
    new_refresh = r1.json()["refresh_token"]
    assert new_refresh != refresh

    # jti antigo foi revogado server-side
    r2 = client.post("/api/v3/auth/refresh", json={"refresh_token": refresh}, cookies={"refresh_token": ""})
    assert r2.status_code == 401

    # o novo par segue válido
    r3 = client.post("/api/v3/auth/refresh", json={"refresh_token": new_refresh}, cookies={"refresh_token": ""})
    assert r3.status_code == 200


def test_refresh_aceita_cookie_httponly_sem_body(client):
    """Cookie refresh_token substitui o body (migração do localStorage)."""
    login = client.get("/api/v3/auth/dev-login").json()
    refresh = login["refresh_token"]

    r = client.post("/api/v3/auth/refresh", cookies={"refresh_token": refresh})
    assert r.status_code == 200, r.text
    # resposta seta AMBOS os cookies (access + refresh rotacionado)
    set_cookie = r.headers.get("set-cookie", "")
    assert "access_token=" in set_cookie
    assert "refresh_token=" in set_cookie


def test_logout_revoga_sessao_de_refresh(client):
    """Logout revoga o refresh server-side (antes só apagava cookie)."""
    login = client.get("/api/v3/auth/dev-login").json()
    access, refresh = login["access_token"], login["refresh_token"]

    r = client.post("/api/v3/auth/logout", headers={"Authorization": f"Bearer {access}"})
    assert r.status_code == 200

    r2 = client.post("/api/v3/auth/refresh", json={"refresh_token": refresh})
    assert r2.status_code == 401


def test_verify_aceita_so_cookie(client):
    """/auth/verify autentica via cookie HttpOnly (sem Bearer)."""
    cookie = _dev_login_cookie(client)
    resp = client.get("/api/v3/auth/verify", headers={"Cookie": f"access_token={cookie}"})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["email"]


def test_verify_rejeita_api_key(client, auth_headers):
    """API key não tem identidade de usuário — /verify recusa (401)."""
    resp = client.get("/api/v3/auth/verify", headers=auth_headers)
    assert resp.status_code == 401


def test_is_same_site_helper():
    from app.api.auth import _is_same_site

    # Render web → Render API: mesmo site (onrender.com)
    assert _is_same_site(
        "https://concierge-collector-web.onrender.com/",
        "https://concierge-collector.onrender.com/api/v3/auth/callback",
    )
    # GitHub Pages legado → API: cross-site
    assert not _is_same_site(
        "https://wsmontes.github.io/Concierge-Collector",
        "https://concierge-collector.onrender.com/api/v3/auth/callback",
    )
    # IP vs hostname: sites diferentes (dev local — mantém caminho legado)
    assert not _is_same_site("http://127.0.0.1:5500", "http://localhost:8000")
    assert _is_same_site("http://localhost:5500", "http://localhost:8000")


def test_auth_redirect_same_site_tokens_no_fragment():
    """Same-site: tokens NO FRAGMENT (não vazam via query/Referer/logs) +
    ?session=1 mantém o fallback de cookie. iOS Safari descarta Set-Cookie
    de redirect cross-site — o fragment é o caminho que funciona lá."""
    from app.api.auth import _build_auth_redirect_url

    url = _build_auth_redirect_url(
        frontend_url="https://concierge-collector-web.onrender.com",
        access_token="acc",
        refresh_token="ref",
        user_email="a@x.com",
        user_name="A",
        same_site=True,
    )
    base, fragment = url.split("#")
    assert base == "https://concierge-collector-web.onrender.com/?session=1"
    assert "token=acc" in fragment
    assert "refresh_token=ref" in fragment
    # nada de token na QUERY (log de request/Referer não vêem)
    assert "token=acc" not in url.split("#")[0]


def test_auth_redirect_cross_site_mantem_tokens_na_url():
    """Cross-site legado (GitHub Pages): tokens na URL como antes."""
    from app.api.auth import _build_auth_redirect_url

    url = _build_auth_redirect_url(
        frontend_url="https://wsmontes.github.io/Concierge-Collector",
        access_token="acc",
        refresh_token="ref",
        user_email="a@x.com",
        user_name="A",
        same_site=False,
    )
    assert "token=acc" in url
    assert "refresh_token=ref" in url


# ============================================================================
# Redirect pós-login: fragment same-site (Safari descarta cookie de redirect)
# ============================================================================
