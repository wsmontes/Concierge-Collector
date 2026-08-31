"""Tests for shared verify_auth dependency."""

import pytest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException
from starlette.requests import Request


def _req():
    """Request mínimo para chamadas DIRETAS do verify_auth (o cookie
    ausente é o caso padrão dos testes)."""
    return Request({"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b""})


class TestVerifyAuth:
    """Test the shared verify_auth function in security.py."""

    def test_api_key_valid(self):
        """Valid API key returns authenticated dict."""
        from app.core.security import verify_auth
        from app.core.config import settings

        result = verify_auth(_req(), api_key=settings.api_secret_key, bearer=None)
        assert result["authenticated"] is True
        assert result["method"] == "api_key"

    def test_api_key_invalid_then_no_bearer_raises_401(self):
        """Invalid API key and no bearer raises 401."""
        from app.core.security import verify_auth

        with pytest.raises(HTTPException) as exc:
            verify_auth(_req(), api_key="bad-key", bearer=None)
        assert exc.value.status_code == 401

    def test_no_credentials_raises_401(self):
        """Neither API key nor bearer raises 401."""
        from app.core.security import verify_auth

        with pytest.raises(HTTPException) as exc:
            verify_auth(_req(), api_key=None, bearer=None)
        assert exc.value.status_code == 401

    def test_bearer_missing_role_defaults_to_viewer(self):
        """JWT sem role claim vira 'viewer' (nunca curator — refresh de
        viewer sem role era aceito como curator: escalation)."""
        from app.core.security import verify_auth, create_access_token

        token = create_access_token(data={"sub": "test@example.com"})
        from fastapi.security import HTTPAuthorizationCredentials

        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        result = verify_auth(_req(), api_key=None, bearer=creds)
        assert result["authenticated"] is True
        assert result["method"] == "jwt"
        assert result["role"] == "viewer"

    def test_bearer_invalid_raises_401(self):
        """Invalid JWT raises 401."""
        from app.core.security import verify_auth
        from fastapi.security import HTTPAuthorizationCredentials

        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="not.a.jwt")
        with pytest.raises(HTTPException) as exc:
            verify_auth(_req(), api_key=None, bearer=creds)
        assert exc.value.status_code == 401

    def test_api_key_misconfigured_returns_500(self):
        """Missing ADMIN_API_KEYS/API_SECRET_KEY returns 500 with diagnostic, not silent skip."""
        from app.core.security import verify_auth

        with patch("app.core.security.get_admin_api_keys", side_effect=RuntimeError("not set")):
            with pytest.raises(HTTPException) as exc:
                verify_auth(_req(), api_key="anything", bearer=None)
            assert exc.value.status_code == 500

    def test_api_key_invalid_jwt_valid(self):
        """Invalid API key + valid JWT bearer succeeds via JWT path."""
        from app.core.security import verify_auth, create_access_token
        from fastapi.security import HTTPAuthorizationCredentials

        token = create_access_token(data={"sub": "jwt-user@example.com"})
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        result = verify_auth(_req(), api_key="bad-key", bearer=creds)
        assert result["authenticated"] is True
        assert result["method"] == "jwt"
        assert result["user"] == "jwt-user@example.com"

    def test_jwt_with_explicit_role(self):
        """JWT payload with explicit role='admin' propagates the value."""
        from app.core.security import verify_auth, create_access_token
        from fastapi.security import HTTPAuthorizationCredentials

        token = create_access_token(data={"sub": "admin@example.com", "role": "admin"})
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        result = verify_auth(_req(), api_key=None, bearer=creds)
        assert result["authenticated"] is True
        assert result["method"] == "jwt"
        assert result["role"] == "admin"

    def test_bearer_misconfigured_server_returns_500(self):
        """RuntimeError during JWT decode path returns 500."""
        from app.core.security import verify_auth
        from fastapi.security import HTTPAuthorizationCredentials

        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="some.jwt.here")
        with patch("app.core.security.get_jwt_secret", side_effect=RuntimeError("not set")):
            with pytest.raises(HTTPException) as exc:
                verify_auth(_req(), api_key=None, bearer=creds)
            assert exc.value.status_code == 500
            assert "not configured" in str(exc.value.detail)


class TestJwtHelpers:
    """Round-trip dos helpers JWT (access/refresh) e caminhos de erro."""

    def test_generate_api_key_unique_and_urlsafe(self):
        from app.core.security import generate_api_key

        key1 = generate_api_key()
        key2 = generate_api_key()
        assert key1 != key2
        assert len(key1) >= 43  # 32 bytes urlsafe
        assert "/" not in key1 and "+" not in key1

    def test_create_access_token_with_custom_expiry(self):
        from datetime import timedelta
        from app.core.security import create_access_token

        token = create_access_token(data={"sub": "x@example.com"}, expires_delta=timedelta(minutes=5))
        assert isinstance(token, str)
        assert token.count(".") == 2

    async def test_verify_access_token_roundtrip(self):
        from app.core.security import create_access_token, verify_access_token
        from fastapi.security import HTTPAuthorizationCredentials

        token = create_access_token(data={"sub": "roundtrip@example.com"})
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        payload = await verify_access_token(credentials=creds)
        assert payload["sub"] == "roundtrip@example.com"

    async def test_verify_access_token_missing_credentials(self):
        from app.core.security import verify_access_token

        with pytest.raises(HTTPException) as exc:
            await verify_access_token(credentials=None)
        assert exc.value.status_code == 401

    async def test_verify_access_token_invalid(self):
        from app.core.security import verify_access_token
        from fastapi.security import HTTPAuthorizationCredentials

        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="lixo")
        with pytest.raises(HTTPException) as exc:
            await verify_access_token(credentials=creds)
        assert exc.value.status_code == 401

    async def test_verify_access_token_expired(self):
        from datetime import timedelta
        from app.core.security import create_access_token, verify_access_token
        from fastapi.security import HTTPAuthorizationCredentials

        token = create_access_token(data={"sub": "expired@example.com"}, expires_delta=timedelta(seconds=-10))
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        with pytest.raises(HTTPException) as exc:
            await verify_access_token(credentials=creds)
        assert exc.value.status_code == 401

    async def test_verify_access_token_testing_bypass_development_only(self, monkeypatch):
        from app.core.security import verify_access_token

        monkeypatch.setenv("TESTING", "true")
        from app.core.config import settings

        if settings.environment != "development":
            pytest.skip("bypass só existe em development")
        payload = await verify_access_token(credentials=None)
        assert payload["email"] == "test@example.com"

    async def test_verify_refresh_token_roundtrip(self, in_memory_db):
        from app.core.security import ALGORITHM, create_refresh_token, get_jwt_secret, verify_refresh_token
        from app.services.session_service import register_session
        from jose import jwt

        token = create_refresh_token(data={"sub": "refresh@example.com"})
        # Token novo carrega jti → exige sessão registrada em auth_sessions
        # (rotação 2026-08-15). Sem sessão o verify é fail-closed 401.
        jti = jwt.decode(token, get_jwt_secret(), algorithms=[ALGORITHM])["jti"]
        register_session(in_memory_db, jti, "refresh@example.com")
        try:
            payload = await verify_refresh_token(token, db=in_memory_db)
        finally:
            in_memory_db.auth_sessions.delete_many({"jti": jti})
        assert payload["sub"] == "refresh@example.com"
        assert payload["type"] == "refresh"

    async def test_verify_refresh_token_jti_sem_db_recusado(self):
        """Token com jti verificado SEM db → 401 (fail-closed, rotação)."""
        from app.core.security import create_refresh_token, verify_refresh_token

        token = create_refresh_token(data={"sub": "refresh@example.com"})
        with pytest.raises(HTTPException) as exc:
            await verify_refresh_token(token)
        assert exc.value.status_code == 401

    async def test_verify_refresh_token_rejects_access_token(self):
        from app.core.security import create_access_token, verify_refresh_token

        access = create_access_token(data={"sub": "x@example.com"})
        with pytest.raises(HTTPException) as exc:
            await verify_refresh_token(access)
        assert exc.value.status_code == 401
        assert "token type" in str(exc.value.detail).lower()

    async def test_verify_refresh_token_rejects_garbage(self):
        from app.core.security import verify_refresh_token

        with pytest.raises(HTTPException) as exc:
            await verify_refresh_token("not.a.token")
        assert exc.value.status_code == 401

    async def test_create_access_token_includes_type_access(self):
        from app.core.security import create_access_token, ALGORITHM, get_api_secret_key
        from jose import jwt

        token = create_access_token(data={"sub": "x@example.com"})
        payload = jwt.decode(token, get_api_secret_key(), algorithms=[ALGORITHM])
        assert payload["type"] == "access"

    async def test_verify_access_token_rejects_refresh_token(self):
        from app.core.security import create_refresh_token, verify_access_token
        from fastapi.security import HTTPAuthorizationCredentials

        refresh = create_refresh_token(data={"sub": "refresh@example.com"})
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=refresh)
        with pytest.raises(HTTPException) as exc:
            await verify_access_token(credentials=creds)
        assert exc.value.status_code == 401
        assert "token type" in str(exc.value.detail).lower()

    async def test_verify_auth_rejects_refresh_token(self):
        from app.core.security import create_refresh_token, verify_auth
        from fastapi.security import HTTPAuthorizationCredentials

        refresh = create_refresh_token(data={"sub": "viewer@example.com"})
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=refresh)
        with pytest.raises(HTTPException) as exc:
            verify_auth(_req(), api_key=None, bearer=creds)
        assert exc.value.status_code == 401

    async def test_verify_auth_role_absent_defaults_to_viewer(self):
        """Access token sem role NUNCA vira curator (era o default antigo)."""
        from app.core.security import verify_auth
        from fastapi.security import HTTPAuthorizationCredentials
        from jose import jwt as _jwt

        # token access sem role, forjado direto (simula emissor externo)
        from app.core.security import ALGORITHM, get_api_secret_key
        from datetime import datetime, timedelta, timezone

        payload = {
            "sub": "semrole@example.com",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
            "iat": datetime.now(timezone.utc),
            "type": "access",
        }
        token = _jwt.encode(payload, get_api_secret_key(), algorithm=ALGORITHM)
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        auth = verify_auth(_req(), api_key=None, bearer=creds)
        assert auth["role"] == "viewer"
        assert auth["user"] == "semrole@example.com"

    async def test_verify_auth_role_unknown_falls_back_to_viewer(self):
        from app.core.security import create_access_token, verify_auth
        from fastapi.security import HTTPAuthorizationCredentials

        token = create_access_token(data={"sub": "estranho@example.com", "role": "superuser"})
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        auth = verify_auth(_req(), api_key=None, bearer=creds)
        assert auth["role"] == "viewer"


class TestSecretSeparation:
    """Separação de segredos (2026-08-15, achado #11 do code review).

    Antes, API_SECRET_KEY fazia papel duplo: chave do X-API-Key E segredo
    HS256 dos JWTs — quem tinha a API key podia forjar token de admin.
    Agora: JWT_SIGNING_SECRET assina tokens; ADMIN_API_KEYS valida o header;
    ADMIN_EMAILS substitui a regra automática @lotier.com → admin.
    Transição com fallback legado (API_SECRET_KEY) para zero downtime.
    """

    def test_access_token_signed_with_jwt_signing_secret(self, monkeypatch):
        """Com JWT_SIGNING_SECRET setado, o token é assinado com ELE (não a API key)."""
        from app.core.config import settings
        from app.core.security import create_access_token, ALGORITHM
        from jose import jwt as _jwt

        monkeypatch.setattr(settings, "jwt_signing_secret", "jwt-secret-xyz")
        token = create_access_token(data={"sub": "x@example.com"})
        payload = _jwt.decode(token, "jwt-secret-xyz", algorithms=[ALGORITHM])
        assert payload["sub"] == "x@example.com"
        assert payload["type"] == "access"

    def test_x_api_key_validated_against_admin_list(self, monkeypatch):
        """X-API-Key valida contra a LISTA ADMIN_API_KEYS, não o segredo JWT."""
        from app.core.config import settings
        from app.core.security import verify_auth

        monkeypatch.setattr(settings, "admin_api_keys", "key-a,key-b")
        result = verify_auth(_req(), api_key="key-b", bearer=None)
        assert result["authenticated"] is True
        assert result["method"] == "api_key"

        with pytest.raises(HTTPException) as exc:
            verify_auth(_req(), api_key="key-c", bearer=None)
        assert exc.value.status_code == 401

    def test_is_admin_email_uses_allowlist(self, monkeypatch):
        """ADMIN_EMAILS substitui a regra legada @lotier.com (boundary explícita)."""
        from app.core.config import settings

        monkeypatch.setattr(settings, "admin_emails", "boss@x.com, chief@x.com")
        assert settings.is_admin_email("boss@x.com") is True
        assert settings.is_admin_email("chief@x.com") is True
        # allowlist setada → domínio @lotier.com NÃO promove mais sozinho
        assert settings.is_admin_email("someone@lotier.com") is False

    def test_jwt_secret_falls_back_to_api_secret_key(self):
        """Sem JWT_SIGNING_SECRET, o fallback legado mantém tudo funcionando
        (em development — o .env de dev não tem a var nova)."""
        from app.core.config import settings

        assert settings.jwt_secret == settings.api_secret_key

    def test_admin_api_key_list_falls_back_to_api_secret_key(self):
        """Sem ADMIN_API_KEYS, a lista é [API_SECRET_KEY] (comportamento legado,
        development)."""
        from app.core.config import settings

        assert settings.admin_api_key_list[0] == settings.api_secret_key

    def test_jwt_secret_fail_closed_em_producao(self, monkeypatch):
        """Achado #7 (auditoria 2026-08-18): em PRODUÇÃO, sem
        JWT_SIGNING_SECRET o fallback deixa de existir — RuntimeError
        (500 fail-closed) em vez de poder duplo com a API key."""
        import pytest
        from app.core.config import settings

        monkeypatch.setattr(settings, "jwt_signing_secret", "")
        monkeypatch.setattr(settings, "environment", "production")
        with pytest.raises(RuntimeError):
            _ = settings.jwt_secret

    def test_jwt_secret_fallback_segue_em_development(self, monkeypatch):
        from app.core.config import settings

        monkeypatch.setattr(settings, "jwt_signing_secret", "")
        monkeypatch.setattr(settings, "environment", "development")
        assert settings.jwt_secret == settings.api_secret_key

    def test_admin_key_list_fail_closed_em_producao(self, monkeypatch):
        """Sem ADMIN_API_KEYS em produção → lista vazia (get_admin_api_keys
        devolve 500 em vez de aceitar a chave legada)."""
        from app.core.config import settings

        monkeypatch.setattr(settings, "admin_api_keys", "")
        monkeypatch.setattr(settings, "environment", "production")
        assert settings.admin_api_key_list == []

    def test_is_admin_email_fail_closed_em_producao_sem_allowlist(self, monkeypatch):
        """Sem ADMIN_EMAILS em produção, NINGUÉM é admin por domínio —
        a regra @lotier.com é só legado de development."""
        from app.core.config import settings

        monkeypatch.setattr(settings, "admin_emails", "")
        monkeypatch.setattr(settings, "environment", "production")
        assert settings.is_admin_email("anyone@lotier.com") is False
        assert settings.is_admin_email("wagner@lotier.com") is False

    def test_is_admin_email_legado_lotier_so_em_development(self, monkeypatch):
        from app.core.config import settings

        monkeypatch.setattr(settings, "admin_emails", "")
        monkeypatch.setattr(settings, "environment", "development")
        assert settings.is_admin_email("anyone@lotier.com") is True
        assert settings.is_admin_email("outsider@x.com") is False


class TestRequireRole:
    """Dependency de role mínima (auditoria ago/2026): viewer não escreve."""

    @staticmethod
    def _live_db(role, authorized=True):
        """require_role revalida o usuário VIVO no Mongo — o db fake precisa
        devolver o doc em db.users.find_one (revogação ao vivo, Baseline 1)."""
        db = MagicMock()
        db.users.find_one.return_value = {
            "email": "v@x.com",
            "authorized": authorized,
            "role": role,
        }
        return db

    def test_viewer_rejected(self):
        from app.core.security import require_role

        dep = require_role("curator")
        with pytest.raises(HTTPException) as exc:
            dep(
                auth={"method": "jwt", "user": "v@x.com", "role": "viewer", "authenticated": True},
                db=self._live_db("viewer"),
            )
        assert exc.value.status_code == 403

    def test_curator_admin_apikey_pass(self):
        from app.core.security import require_role

        dep = require_role("curator")
        # API key segue credencial administrativa (não revalida usuário).
        assert dep(auth={"method": "api_key"})["method"] == "api_key"
        for role in ("curator", "admin"):
            result = dep(auth={"method": "jwt", "user": "v@x.com", "role": role}, db=self._live_db(role))
            assert result["method"] == "jwt"
            assert result["role"] == role

    def test_role_ausente_tratado_como_viewer(self):
        from app.core.security import require_role

        dep = require_role("curator")
        with pytest.raises(HTTPException):
            dep(auth={"method": "jwt", "user": "x@x.com"}, db=self._live_db(None))
