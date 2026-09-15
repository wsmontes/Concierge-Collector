"""Media contract for the Entity image on the CMS boundary.

The bytes of an Entity thumbnail already exist: ``app/api/entities.py`` resolves
the source chain and ``og_image_service`` downloads it under the SSRF guard and
reencodes it to JPEG. What the Admin lacked was a way to reach those bytes with
the credential it actually holds (the CMS service key, not a curator session),
so this payload publishes exactly two things per image — the rank that
addresses it and the path ON THIS BOUNDARY that serves it. Never an origin URL,
never the Google Places key.

The gallery is bounded by the collector's own ceiling, published here so the
boundary and the UI agree on it instead of discovering it through a rejection.
"""

from pydantic import BaseModel, Field

# Mirrors ``og_image_service.COLLECTOR_MAX_IMAGES`` (8) and the rank ceiling of
# the curator-facing route (``entities.get_entity_image`` Query(le=7)).
ENTITY_IMAGE_MAX_RANK = 7
ENTITY_IMAGES_MAX_ITEMS = ENTITY_IMAGE_MAX_RANK + 1

# A thumbnail is a convenience render of an image the source site owns and may
# swap at any time, so the cache TTL is short. ``private`` because the response
# only exists behind the CMS service credential — a shared cache must not
# replay it to an unauthenticated caller.
ENTITY_IMAGE_CACHE_TTL_SECONDS = 300


class EntityImageItem(BaseModel):
    """One ranked Entity image and the boundary path that serves its bytes."""

    rank: int = Field(ge=0, le=ENTITY_IMAGE_MAX_RANK)
    source: str
    url: str


class EntityImagesResponse(BaseModel):
    """The ranked images of one Entity, ascending by rank, never past the ceiling."""

    items: list[EntityImageItem]
