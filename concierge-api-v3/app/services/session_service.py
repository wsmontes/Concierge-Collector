"""
Sessões de refresh token — coleção auth_sessions.

Rotação com detecção de replay (2026-08-15): cada refresh token carrega um
jti; ao ser USADO, o jti é consumido atomicamente e um novo par é emitido com
jti novo. Duas requests concorrentes para o mesmo token têm exatamente um
vencedor; a outra encontra a sessão já consumida e é rejeitada.

A coleção tem TTL (index_specs.auth_sessions → expiresAt) — sessões expiram
sozinhas no Mongo, alinhadas aos REFRESH_TOKEN_EXPIRE_DAYS.
"""

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
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


def _find_one_and_delete(collection, query: dict) -> dict | None:
    """Use Mongo's atomic primitive; keep a narrow fallback for test doubles.

    Real PyMongo collections always provide ``find_one_and_delete``. The
    fallback exists only because the repository's hermetic InMemoryCollection
    intentionally implements a smaller surface. It is not concurrency-safe and
    must never be the production path.
    """
    atomic_delete = getattr(collection, "find_one_and_delete", None)
    if callable(atomic_delete):
        return atomic_delete(query)
    document = collection.find_one(query)
    if document is None:
        return None
    collection.delete_one({"_id": document["_id"]})
    return document


def consume_session(db: Database, jti: str, sub: str) -> dict | None:
    """Consome um refresh jti uma única vez, com CAS atômica por subject."""
    return _find_one_and_delete(db.auth_sessions, {"jti": jti, "sub": sub})


def revoke_session(db: Database, jti: str) -> None:
    """Revoga um jti uma única vez e rejeita replay concorrente.

    O endpoint de refresh chama esta função imediatamente antes de emitir o
    novo par. ``find_one_and_delete`` torna esse ponto a CAS efetiva mesmo que
    duas requests tenham terminado a validação JWT ao mesmo tempo. O logout
    trata revogação ausente como best-effort e continua idempotente no boundary
    HTTP.
    """
    consumed = _find_one_and_delete(db.auth_sessions, {"jti": jti})
    if consumed is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )
