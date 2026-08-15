"""Tests for shared verify_auth dependency."""

import pytest
from unittest.mock import patch
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
        """Missing API_SECRET_KEY returns 500 with diagnostic, not silent skip."""
        from app.core.security import verify_auth

        with patch("app.core.security.get_api_secret_key", side_effect=RuntimeError("not set")):
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
        with patch("app.core.security.get_api_secret_key", side_effect=RuntimeError("not set")):
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

    async def test_verify_refresh_token_roundtrip(self):
        from app.core.security import create_refresh_token, verify_refresh_token

        token = create_refresh_token(data={"sub": "refresh@example.com"})
        payload = await verify_refresh_token(token)
        assert payload["sub"] == "refresh@example.com"
        assert payload["type"] == "refresh"

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


class TestRequireRole:
    """Dependency de role mínima (auditoria ago/2026): viewer não escreve."""

    def test_viewer_rejected(self):
        from app.core.security import require_role

        dep = require_role("curator")
        with pytest.raises(HTTPException) as exc:
            dep(auth={"method": "jwt", "user": "v@x.com", "role": "viewer", "authenticated": True})
        assert exc.value.status_code == 403

    def test_curator_admin_apikey_pass(self):
        from app.core.security import require_role

        dep = require_role("curator")
        for auth in (
            {"method": "jwt", "role": "curator"},
            {"method": "jwt", "role": "admin"},
            {"method": "api_key"},
        ):
            result = dep(auth=auth)
            assert result is auth

    def test_role_ausente_tratado_como_viewer(self):
        from app.core.security import require_role

        dep = require_role("curator")
        with pytest.raises(HTTPException):
            dep(auth={"method": "jwt", "user": "x@x.com"})
