"""Bounded selection resolution against the operational Curation database."""

from fastapi import HTTPException, status
from bson import ObjectId
from pymongo.database import Database

from app.models.catalog import RejectedCuration, ResolveCurationsResponse

SELECTABLE_STATUSES = frozenset({"active", "draft", "linked"})


def _distinct_in_order(curation_ids: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for curation_id in curation_ids:
        if curation_id not in seen:
            seen.add(curation_id)
            result.append(curation_id)
    return result


def require_current_cms_admin(db: Database, actor_subject: str) -> None:
    """Re-read the worker's asserted actor, accepting only a live admin.

    Payload forwards the opaque ``user_id`` obtained during CMS introspection,
    while service callers may use the stable email subject. Neither value is
    trusted until the operational user record is loaded again.
    """

    actor_ids: list[object] = [actor_subject]
    if ObjectId.is_valid(actor_subject):
        actor_ids.append(ObjectId(actor_subject))
    actor = db.users.find_one({"$or": [{"_id": {"$in": actor_ids}}, {"email": actor_subject}]})
    if actor is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="CMS actor was not found")
    if actor.get("authorized") is not True or actor.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CMS admin access is required")


def resolve_curations(
    db: Database,
    curation_ids: list[str],
    actor_subject: str,
) -> ResolveCurationsResponse:
    """Resolve a selection without ever treating catalog eligibility as public availability."""

    require_current_cms_admin(db, actor_subject)
    requested_ids = _distinct_in_order(curation_ids)
    records = {
        record["curation_id"]: record
        for record in db.curations.find(
            {"curation_id": {"$in": requested_ids}},
            {"_id": 0, "curation_id": 1, "status": 1},
        )
    }

    eligible_ids: list[str] = []
    rejected: list[RejectedCuration] = []
    for curation_id in requested_ids:
        record = records.get(curation_id)
        if record is None:
            rejected.append(RejectedCuration(curation_id=curation_id, reason="not_found"))
        elif record.get("status") in SELECTABLE_STATUSES:
            eligible_ids.append(curation_id)
        else:
            rejected.append(RejectedCuration(curation_id=curation_id, reason="ineligible_status"))

    return ResolveCurationsResponse(eligible_ids=eligible_ids, rejected=rejected)
