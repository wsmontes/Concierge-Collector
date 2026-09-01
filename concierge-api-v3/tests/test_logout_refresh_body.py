"""Cross-site logout must be able to revoke the localStorage refresh session."""


def test_logout_accepts_refresh_body_when_cookie_is_unavailable(client):
    """Legacy/cross-site clients authenticate with access JWT and send refresh in JSON."""
    login = client.get("/api/v3/auth/dev-login").json()
    access = login["access_token"]
    refresh = login["refresh_token"]

    logout = client.post(
        "/api/v3/auth/logout",
        json={"refresh_token": refresh},
        headers={"Authorization": f"Bearer {access}"},
        cookies={"refresh_token": ""},
    )
    assert logout.status_code == 200, logout.text

    replay = client.post(
        "/api/v3/auth/refresh",
        json={"refresh_token": refresh},
        cookies={"refresh_token": ""},
    )
    assert replay.status_code == 401


def test_logout_does_not_revoke_another_users_refresh(client, in_memory_db):
    """A refresh token in the body may only revoke the authenticated subject."""
    from app.api.auth import _issue_refresh
    from app.core.security import create_access_token

    victim = "logout-victim@example.com"
    attacker = "logout-attacker@example.com"
    in_memory_db.users.delete_many({"email": {"$in": [victim, attacker]}})
    for email in (victim, attacker):
        in_memory_db.users.insert_one(
            {
                "_id": f"user-{email}",
                "email": email,
                "google_id": f"google-{email}",
                "name": email,
                "authorized": True,
                "role": "curator",
            }
        )
    victim_refresh = _issue_refresh(in_memory_db, victim)
    attacker_access = create_access_token(data={"sub": attacker, "role": "curator"})

    try:
        response = client.post(
            "/api/v3/auth/logout",
            json={"refresh_token": victim_refresh},
            headers={"Authorization": f"Bearer {attacker_access}"},
            cookies={"refresh_token": ""},
        )
        assert response.status_code == 200

        still_valid = client.post(
            "/api/v3/auth/refresh",
            json={"refresh_token": victim_refresh},
            cookies={"refresh_token": ""},
        )
        assert still_valid.status_code == 200
    finally:
        in_memory_db.users.delete_many({"email": {"$in": [victim, attacker]}})
        in_memory_db.auth_sessions.delete_many({"sub": {"$in": [victim, attacker]}})
