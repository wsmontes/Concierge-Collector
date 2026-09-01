"""Paid-provider rate limit keys must be stable across token rotation."""

from datetime import timedelta

from starlette.requests import Request


def _request(*, authorization: str | None = None, api_key: str | None = None, cookie: str | None = None):
    headers = []
    if authorization:
        headers.append((b"authorization", authorization.encode()))
    if api_key:
        headers.append((b"x-api-key", api_key.encode()))
    if cookie:
        headers.append((b"cookie", cookie.encode()))
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "https",
            "path": "/paid",
            "raw_path": b"/paid",
            "query_string": b"",
            "headers": headers,
            "client": ("203.0.113.10", 12345),
            "server": ("api.test", 443),
        }
    )


def test_two_rotated_access_tokens_for_same_user_share_rate_bucket():
    from app.core.rate_limit import auth_header_key
    from app.core.security import create_access_token

    first = create_access_token({"sub": "alice@example.com", "role": "viewer"}, timedelta(minutes=10))
    second = create_access_token({"sub": "alice@example.com", "role": "viewer"}, timedelta(minutes=11))
    assert first != second

    first_key = auth_header_key(_request(authorization=f"Bearer {first}"))
    second_key = auth_header_key(_request(authorization=f"Bearer {second}"))

    assert first_key == second_key
    assert "alice@example.com" not in first_key
    assert first not in first_key


def test_bearer_and_cookie_session_for_same_user_share_rate_bucket():
    from app.core.rate_limit import auth_header_key
    from app.core.security import create_access_token

    token = create_access_token({"sub": "cookie@example.com", "role": "viewer"})
    bearer_key = auth_header_key(_request(authorization=f"Bearer {token}"))
    cookie_key = auth_header_key(_request(cookie=f"access_token={token}"))

    assert bearer_key == cookie_key


def test_api_key_bucket_is_stable_and_never_contains_secret():
    from app.core.rate_limit import auth_header_key

    secret = "test-admin-api-key"
    first = auth_header_key(_request(api_key=secret))
    second = auth_header_key(_request(api_key=secret, authorization=None))

    assert first == second
    assert secret not in first
