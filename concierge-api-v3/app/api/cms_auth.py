"""Server-to-server CMS handoff endpoints.

The FastAPI service remains the authority for operational users and roles.
Payload receives only an opaque one-shot code, then asks this service for the
current authorization with its own rotating service credential.
"""

from datetime import datetime, timezone
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pymongo.database import Database

from app.core.config import settings
from app.core.database import get_database
from app.core.security import verify_auth, verify_cms_service
from app.models.cms_auth import CmsAuthorization, CmsExchangeRequest, CmsIntrospectionRequest
from app.services.cms_auth_service import consume_handoff_code, issue_handoff_code, load_cms_authorization

router = APIRouter(prefix="/auth/cms", tags=["cms-auth"])


def _human_session_subject(auth: dict) -> str:
    """Accept only an interactive FastAPI session, never an admin API key."""
    if auth.get("method") not in {"jwt", "cookie"}:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="CMS authorization requires a human session",
        )
    subject = auth.get("user")
    if not isinstance(subject, str) or not subject:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="CMS authorization session has no subject",
        )
    return subject


def _configured_callback_url(code: str, state: str) -> str:
    """Build a redirect from the fixed callback only; no caller URL is used."""
    callback_url = settings.cms_admin_callback_url_value
    return f"{callback_url}?{urlencode({'code': code, 'state': state})}"


@router.get("/authorize", status_code=status.HTTP_307_TEMPORARY_REDIRECT)
def authorize(
    state: str = Query(min_length=1, max_length=2048),
    auth: dict = Depends(verify_auth),
    db: Database = Depends(get_database),
) -> RedirectResponse:
    """Issue a one-shot code for a current admin and redirect to the fixed CMS callback."""
    subject = _human_session_subject(auth)
    # The service reloads the user rather than trusting the role carried by a
    # JWT/cookie. It also rejects downgraded or unauthorized users.
    load_cms_authorization(db, subject)
    code = issue_handoff_code(
        db,
        subject=subject,
        state=state,
        target_origin=settings.cms_admin_origin_value,
        now=datetime.now(timezone.utc),
    )
    return RedirectResponse(url=_configured_callback_url(code, state), status_code=status.HTTP_307_TEMPORARY_REDIRECT)


@router.post("/exchange", response_model=CmsAuthorization)
def exchange(
    request: CmsExchangeRequest,
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> CmsAuthorization:
    """Atomically consume a one-shot code on behalf of the CMS server."""
    if request.target_origin != settings.cms_admin_origin_value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unexpected CMS target origin")
    return consume_handoff_code(
        db,
        code=request.code,
        state=request.state,
        target_origin=request.target_origin,
    )


@router.post("/introspect", response_model=CmsAuthorization)
def introspect(
    request: CmsIntrospectionRequest,
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> CmsAuthorization:
    """Return the live authorization for an already-authenticated CMS subject."""
    return load_cms_authorization(db, request.subject)
