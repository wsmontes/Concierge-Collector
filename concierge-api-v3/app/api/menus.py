"""
File: menus.py
Purpose: an entity's menu over HTTP — the brief at once (asking for a background refresh when missing or
    stale), excerpts of the raw menu for a question the brief does not answer, refresh now (synchronous,
    for the prefill script and the Admin) and curator review.
Dependencies: app.services.menu_service (all the work), app.api.entities.find_entity (entity lookup),
    app.core.security (verify_auth / require_role), app.core.rate_limit.
Spec: docs/superpowers/specs/2026-11-26-entity-menu-design.md.
"""

# No `from __future__ import annotations`: behind @limiter.limit, FastAPI would read the body as a query.
import asyncio
from typing import Dict, List, Literal, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, HttpUrl
from pymongo.database import Database

from app.api.entities import find_entity
from app.core.database import get_database
from app.core.rate_limit import limiter
from app.core.security import require_role, verify_auth
from app.services import menu_service as service
from app.services.menu_synthesis import PAGE_TOPICS

router = APIRouter(prefix="/entities", tags=["menus"])


def get_menu_deps(request: Request) -> service.MenuDeps:
    """The real network/model/Google dependencies, built once per app (and handed to the background)."""
    deps = getattr(request.app.state, "menu_deps", None)
    if deps is None:
        openai_service = getattr(request.app.state, "openai_service", None)
        if openai_service is None:
            raise HTTPException(status_code=503, detail="Menu extraction is not available")
        deps = service.default_deps(openai_service)
        request.app.state.menu_deps = deps
        service.set_background_deps(deps)
    return deps


def _entity(db: Database, entity_id: str) -> dict:
    entity = find_entity(db, entity_id)
    if not entity:
        raise HTTPException(status_code=404, detail=f"Entity {entity_id} not found")
    return entity


class MenuReview(BaseModel):
    status: Optional[Literal["reviewed", "needs_review", "not_found"]] = None
    overrides: Optional[Dict[str, Union[int, float, None]]] = Field(
        default=None,
        description='Corrections on derived numbers by path, e.g. {"per_person_brl.dinner": 450}.',
    )
    note: Optional[str] = Field(default=None, max_length=1000)
    add_sources: Optional[List[HttpUrl]] = Field(
        default=None,
        max_length=10,
        description="Menu documents the site does not link (read in the next refresh).",
    )


@router.get("/{entity_id}/menu")
@limiter.limit("60/minute")
async def get_menu(
    request: Request,
    entity_id: str,
    max_age_days: float = Query(30, gt=0, le=365),
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth),
):
    """
    The menu brief at once (no raw text: see /menu/text). Missing or older than **max_age_days**:
    `refreshing: true` and a refresh is queued in the background (the next read has it). Never scrapes
    inside the request.

    Async on purpose: the background refresh is scheduled on the app's event loop, which a sync route
    (run in the threadpool) does not have — it would silently never refresh. The reads themselves (two
    find_one, the menu document is tens of KB) run in the threadpool: the server is one process, and a
    synchronous read on the loop stops every other request behind it (the bot's /places/details timed out
    so, and its cards went without photo).

    **Authentication Required:** `Authorization: Bearer <token>` OR `X-API-Key: <key>`
    """
    try:
        get_menu_deps(request)  # makes the background able to refresh
    except HTTPException:
        pass
    service.bind_loop(asyncio.get_running_loop())
    entity = await run_in_threadpool(_entity, db, entity_id)
    return await run_in_threadpool(service.read_menu, db, entity, max_age_days=max_age_days)


@router.get("/{entity_id}/menu/text")
@limiter.limit("60/minute")
async def get_menu_text(
    request: Request,
    entity_id: str,
    q: Optional[str] = Query(
        None,
        max_length=200,
        description="Words to look for (accents and case ignored).",
    ),
    topic: Optional[Literal[PAGE_TOPICS]] = Query(None, description="Only pages tagged with this topic."),
    max_chars: int = Query(6000, ge=500, le=30000),
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth),
):
    """
    Excerpts of the site's useful pages, for a question the brief does not answer ("tem ostra?", "quanto é
    o Barolo?", "aceita cachorro?"). Dining-room menu first; `topic` narrows to pages tagged with it. No
    model and no network inside the request: when nothing is stored yet, a background refresh is asked for
    (`refreshing: true`).

    **Authentication Required:** `Authorization: Bearer <token>` OR `X-API-Key: <key>`
    """
    try:
        get_menu_deps(request)
    except HTTPException:
        pass
    service.bind_loop(asyncio.get_running_loop())  # the reads below run off the loop (see get_menu)
    entity = await run_in_threadpool(_entity, db, entity_id)
    return await run_in_threadpool(service.menu_text, db, entity, q=q, topic=topic, max_chars=max_chars)


@router.post("/{entity_id}/menu/refresh", dependencies=[Depends(require_role("curator"))])
@limiter.limit("10/minute")
async def refresh_menu(
    request: Request,
    entity_id: str,
    force: bool = Query(False, description="Collect again inside the minimum interval."),
    resynthesize: bool = Query(
        False,
        description="Write the brief again from the stored documents (no network).",
    ),
    db: Database = Depends(get_database),
    deps: service.MenuDeps = Depends(get_menu_deps),
):
    """Collect the menu documents and write the brief now (seconds to ~2 min). For the prefill and the Admin."""
    entity = _entity(db, entity_id)
    menu = await service.refresh_menu(db, entity, deps, force=force, resynthesize=resynthesize)
    return service.public_view(menu)


@router.patch("/{entity_id}/menu")
@limiter.limit("30/minute")
def review_menu(
    request: Request,
    entity_id: str,
    body: MenuReview,
    db: Database = Depends(get_database),
    auth: dict = Depends(require_role("curator")),
):
    """Curator review: confirm, correct the brief, add a source the site does not link."""
    entity = _entity(db, entity_id)
    payload = body.model_dump(exclude_none=True)
    if "add_sources" in payload:
        payload["add_sources"] = [str(url) for url in payload["add_sources"]]
    reviewer = str(auth.get("user") or auth.get("method") or "unknown")
    menu = service.review_menu(db, entity["_id"], payload, reviewer)
    if menu is None:
        raise HTTPException(status_code=404, detail="This entity has no menu yet; refresh it first")
    return service.public_view(menu)
