"""Stable machine-readable HTTP error payloads for browser clients.

Some older route code still raises string ``HTTPException.detail`` values.
The wire contract must not force clients to infer domain meaning from English
messages or status codes, so this adapter upgrades known domain errors at the
FastAPI boundary while preserving every unrelated detail verbatim.
"""

from fastapi import HTTPException


_OWNERSHIP_DETAIL = "Cannot modify another curator's curation"


def http_exception_content(exc: HTTPException) -> dict:
    """Return the JSON body for an HTTPException without broad reclassification."""
    detail = exc.detail
    if exc.status_code == 403 and detail == _OWNERSHIP_DETAIL:
        detail = {
            "code": "curation_owner_mismatch",
            "message": _OWNERSHIP_DETAIL,
        }
    return {"detail": detail}
