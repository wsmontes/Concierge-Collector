"""Tests for shared verify_auth dependency."""
import pytest
from unittest.mock import patch, MagicMock
from fastapi import HTTPException


class TestVerifyAuth:
    """Test the shared verify_auth function in security.py."""

    def test_api_key_valid(self):
        """Valid API key returns authenticated dict."""
        from app.core.security import verify_auth
        from app.core.config import settings

        result = verify_auth(api_key=settings.api_secret_key, bearer=None)
        assert result["authenticated"] is True
        assert result["method"] == "api_key"

    def test_api_key_invalid_then_no_bearer_raises_401(self):
        """Invalid API key and no bearer raises 401."""
        from app.core.security import verify_auth

        with pytest.raises(HTTPException) as exc:
            verify_auth(api_key="bad-key", bearer=None)
        assert exc.value.status_code == 401

    def test_no_credentials_raises_401(self):
        """Neither API key nor bearer raises 401."""
        from app.core.security import verify_auth

        with pytest.raises(HTTPException) as exc:
            verify_auth(api_key=None, bearer=None)
        assert exc.value.status_code == 401

    def test_bearer_missing_role_defaults_to_curator(self):
        """JWT without role claim defaults to 'curator'."""
        from app.core.security import verify_auth, create_access_token

        token = create_access_token(data={"sub": "test@example.com"})
        from fastapi.security import HTTPAuthorizationCredentials
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        result = verify_auth(api_key=None, bearer=creds)
        assert result["authenticated"] is True
        assert result["method"] == "jwt"
        assert result["role"] == "curator"

    def test_bearer_invalid_raises_401(self):
        """Invalid JWT raises 401."""
        from app.core.security import verify_auth
        from fastapi.security import HTTPAuthorizationCredentials

        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="not.a.jwt")
        with pytest.raises(HTTPException) as exc:
            verify_auth(api_key=None, bearer=creds)
        assert exc.value.status_code == 401

    def test_api_key_misconfigured_returns_500(self):
        """Missing API_SECRET_KEY returns 500 with diagnostic, not silent skip."""
        from app.core.security import verify_auth
        with patch("app.core.security.get_api_secret_key", side_effect=RuntimeError("not set")):
            with pytest.raises(HTTPException) as exc:
                verify_auth(api_key="anything", bearer=None)
            assert exc.value.status_code == 500

    def test_api_key_invalid_jwt_valid(self):
        """Invalid API key + valid JWT bearer succeeds via JWT path."""
        from app.core.security import verify_auth, create_access_token
        from fastapi.security import HTTPAuthorizationCredentials

        token = create_access_token(data={"sub": "jwt-user@example.com"})
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        result = verify_auth(api_key="bad-key", bearer=creds)
        assert result["authenticated"] is True
        assert result["method"] == "jwt"
        assert result["user"] == "jwt-user@example.com"

    def test_jwt_with_explicit_role(self):
        """JWT payload with explicit role='admin' propagates the value."""
        from app.core.security import verify_auth, create_access_token
        from fastapi.security import HTTPAuthorizationCredentials

        token = create_access_token(data={"sub": "admin@example.com", "role": "admin"})
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        result = verify_auth(api_key=None, bearer=creds)
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
                verify_auth(api_key=None, bearer=creds)
            assert exc.value.status_code == 500
            assert "not configured" in str(exc.value.detail)
