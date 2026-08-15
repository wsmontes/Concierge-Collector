"""
Sessões de refresh token — coleção auth_sessions.

Rotação com detecção de replay (2026-08-15): cada refresh token carrega um
jti; ao ser USADO, o jti é revogado e um novo par é emitido com jti novo.
Um refresh token roubado re-usado após a rotação bate em sessão inexistente
e é rejeitado (antes: JWT stateless valia até os 30 dias, sem revogação).

A coleção tem TTL (index_specs.auth_sessions → expiresAt) — sessões expiram
sozinhas no Mongo, alinhadas aos REFRESH_TOKEN_EXPIRE_DAYS.
"""

from datetime import datetime, timedelta, timezone

from pymongo.database import Database

from app.core.config import settings


def register_session(db: Database, jti: str, sub: str, issued_at: datetime = None) -> dict:
    """Registra a sessão de um refresh token recém-emitido."""
    issued = issued_at or datetime.now(timezone.utc)
    doc = {
        "jti": jti,
        "sub": sub,
        "issuedAt": issued,
        "expiresAt": issued + timedelta(days=settings.refresh_token_expire_days),
    }
    db.auth_sessions.insert_one(doc)
    return doc


def revoke_session(db: Database, jti: str) -> None:
    """Revoga a sessão do jti (rotação/logout). Idempotente."""
    db.auth_sessions.delete_one({"jti": jti})
