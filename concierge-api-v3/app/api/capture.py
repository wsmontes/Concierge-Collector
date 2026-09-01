"""
Capture endpoints — voice-to-curation pipeline.

POST /capture           Upload audio, get back transcription + entity matches.
POST /capture/{id}/confirm  Confirm the match, create the curation.
"""

import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import tempfile
import time
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError

from app.core.database import get_database
from app.core.rate_limit import limiter, auth_header_key
from app.core.security import require_role, is_admin_auth
from app.models.schemas import CurationCreate, EntityCreate
from app.services.capture_session_service import (
    CAPTURE_LEASE_HEARTBEAT_SECONDS,
    abandon_capture_session,
    claim_capture_session,
    complete_capture_session,
    renew_capture_session,
)
from app.services.curation_service import create_curation_doc, find_curation
from app.services.entity_service import upsert_entity

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/capture", tags=["Capture"])


class CaptureRequest(BaseModel):
    audio: str = Field(
        ...,
        max_length=35_000_000,
        description="Base64-encoded audio (webm/mp3), up to ~25 MiB",
    )
    idempotency_key: str = Field(..., max_length=128, description="Client-generated UUID for dedup")
    curator_id: str = Field(..., description="Curator ID")
    language: str = Field("pt-BR", description="Language for transcription")


class EntityMatch(BaseModel):
    entity_id: str
    name: Optional[str] = None
    type: Optional[str] = None
    location: Optional[Dict[str, Any]] = None
    score: float
    source: str = "mongo"


class CaptureResponse(BaseModel):
    capture_id: str
    transcription: str
    restaurant_name: Optional[str] = None
    entities: List[Dict[str, Any]]
    concepts: Dict[str, Any]


class CaptureConfirmRequest(BaseModel):
    entity_id: str = Field(..., description="Entity ID to link the curation to")
    idempotency_key: str = Field(..., max_length=128, description="Client-generated UUID for dedup")


class CaptureConfirmResponse(BaseModel):
    curation_id: str
    entity_id: str
    status: str = "created"


class _LRUDict:
    """Simple bounded in-process retry cache; Mongo remains authoritative."""

    def __init__(self, maxsize: int = 1000):
        self._data: Dict[str, Any] = {}
        self._maxsize = maxsize

    def get(self, key: str, default=None):
        return self._data.get(key, default)

    def set(self, key: str, value: Any):
        if len(self._data) >= self._maxsize:
            oldest = next(iter(self._data))
            del self._data[oldest]
        self._data[key] = value


_idempotency_cache = _LRUDict(maxsize=2000)


def _capture_collection(db: Database):
    return db["capture_sessions"]


def _capture_session_id(curator_id: str, idempotency_key: str) -> str:
    """Stable owner-scoped identity so client keys cannot collide across curators."""
    digest = hashlib.sha256(f"{curator_id}\0{idempotency_key}".encode("utf-8")).hexdigest()
    return f"cap_{digest}"


def _capture_cache_key(capture_id: str) -> str:
    return f"capture:{capture_id}"


def _confirm_cache_key(capture_id: str, idempotency_key: str) -> str:
    return f"confirm:{capture_id}:{idempotency_key}"


def _curation_id_for_capture(capture_id: str) -> str:
    if not capture_id.startswith("cap_"):
        return f"cur_{capture_id[:16]}"
    digest = hashlib.sha256(capture_id.encode("utf-8")).hexdigest()
    return f"cur_{digest[:24]}"


def _response_from_session(session: Dict[str, Any]) -> CaptureResponse:
    return CaptureResponse(
        capture_id=str(session.get("capture_id") or session.get("_id")),
        transcription=session.get("transcription", ""),
        restaurant_name=session.get("restaurant_name"),
        entities=session.get("entities", []),
        concepts=session.get("concepts", {}),
    )


async def _capture_lease_heartbeat(
    db: Database,
    *,
    capture_id: str,
    curator_id: str,
    processing_token: str,
    stop: asyncio.Event,
    errors: list[Exception],
) -> None:
    """Renew the paid-work lease while blocking providers run in worker threads."""
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=CAPTURE_LEASE_HEARTBEAT_SECONDS)
            return
        except asyncio.TimeoutError:
            try:
                await asyncio.to_thread(
                    renew_capture_session,
                    db,
                    capture_id=capture_id,
                    curator_id=curator_id,
                    processing_token=processing_token,
                )
            except Exception as exc:
                errors.append(exc)
                return


def _raise_capture_heartbeat_error(errors: list[Exception]) -> None:
    if not errors:
        return
    error = errors[0]
    if isinstance(error, HTTPException):
        raise error
    raise HTTPException(status_code=503, detail="Capture processing lease renewal failed")


def _transcribe(audio_base64: str, language: str = "pt-BR") -> str:
    import openai

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")
    client = openai.OpenAI(api_key=api_key)
    audio_bytes = base64.b64decode(audio_base64)
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(audio_bytes)
        tmp_path = f.name
    try:
        with open(tmp_path, "rb") as audio_file:
            transcript = client.audio.transcriptions.create(model="whisper-1", file=audio_file, language=language)
        return transcript.text.strip()
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _extract_restaurant_name(text: str) -> Optional[str]:
    import openai

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    client = openai.OpenAI(api_key=api_key, timeout=15)
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Extraia apenas o nome do restaurante, bar ou café mencionado no texto. "
                        "Responda SOMENTE com o nome, nada mais. Se não conseguir identificar, responda vazio."
                    ),
                },
                {"role": "user", "content": text},
            ],
            temperature=0,
            max_tokens=50,
        )
        name = resp.choices[0].message.content.strip().strip('"').strip("'")
        return name if name else None
    except Exception as exc:
        logger.warning("Failed to extract restaurant name: %s", exc.__class__.__name__)
        return None


def _match_entities(db: Database, restaurant_name: Optional[str]) -> List[Dict[str, Any]]:
    entities: List[Dict[str, Any]] = []
    if restaurant_name:
        escaped_name = re.escape(restaurant_name)
        entities.extend(
            list(
                db.entities.find(
                    {"name": {"$regex": f"^{escaped_name}$", "$options": "i"}},
                    {"name": 1, "type": 1, "data.location": 1, "data.place_id": 1},
                ).limit(5)
            )
        )
    if not entities and restaurant_name:
        entities.extend(
            list(
                db.entities.find(
                    {"name": {"$regex": escaped_name, "$options": "i"}},
                    {"name": 1, "type": 1, "data.location": 1, "data.place_id": 1},
                ).limit(5)
            )
        )
    if not entities and restaurant_name and os.getenv("GOOGLE_PLACES_API_KEY"):
        logger.info("No local entity found; querying Google Places")
        try:
            import googlemaps

            gmaps = googlemaps.Client(key=os.getenv("GOOGLE_PLACES_API_KEY"))
            places = gmaps.places(restaurant_name, language="pt-BR")
            for place in places.get("results", [])[:5]:
                loc = place.get("geometry", {}).get("location", {})
                entities.append(
                    {
                        "entity_id": f"gp_{place.get('place_id')}",
                        "name": place.get("name"),
                        "type": _guess_entity_type(place.get("types", [])),
                        "location": {
                            "address": place.get("vicinity", ""),
                            "city": _extract_city(place),
                            "latitude": loc.get("lat"),
                            "longitude": loc.get("lng"),
                        },
                        "score": 0.7,
                        "source": "google_places",
                        "place_id": place.get("place_id"),
                    }
                )
        except Exception as exc:
            logger.warning("Google Places search failed: %s", exc.__class__.__name__)

    results = []
    for i, ent in enumerate(entities):
        score = 0.97 - (i * 0.1) if ent.get("source") != "google_places" else ent.get("score", 0.7) - (i * 0.1)
        score = max(0.2, round(score, 2))
        loc_data = (
            ent.get("data", {}).get("location", {}) if isinstance(ent.get("data"), dict) else ent.get("location", {})
        )
        results.append(
            {
                "entity_id": ent.get("entity_id") or ent.get("_id"),
                "name": ent.get("name"),
                "type": ent.get("type"),
                "location": {
                    "address": loc_data.get("address") or ent.get("location", {}).get("address", ""),
                    "city": loc_data.get("city") or ent.get("location", {}).get("city", ""),
                    "neighborhood": loc_data.get("neighborhood", ""),
                    "latitude": loc_data.get("latitude") or ent.get("location", {}).get("latitude"),
                    "longitude": loc_data.get("longitude") or ent.get("location", {}).get("longitude"),
                },
                "score": score,
                "source": ent.get("source", "mongo"),
                "place_id": ent.get("place_id") if ent.get("source") == "google_places" else None,
            }
        )
    return results


def _extract_concepts(text: str, restaurant_name: Optional[str]) -> Dict[str, Any]:
    import openai

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return {}
    client = openai.OpenAI(api_key=api_key, timeout=20)
    name_context = f" sobre {restaurant_name}" if restaurant_name else ""
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Você é um assistente que extrai categorias de restaurantes a partir de avaliações. "
                        "Analise o texto sobre um restaurante e retorne APENAS um objeto JSON com as seguintes "
                        "chaves (use listas apenas para cuisine, mood, suitable_for, special_features):\n"
                        '- cuisine: lista de tipos de cozinha (ex: ["italian", "japanese"])\n'
                        '- price_range: "unexpensive", "mid-range" ou "expensive"\n'
                        '- mood: lista de atmosferas (ex: ["romantic", "elegant"])\n'
                        '- suitable_for: lista (ex: ["business_lunch", "date_night"])\n'
                        '- special_features: lista (ex: ["outdoor_seating", "live_music"])\n'
                        "Se não tiver informação suficiente para uma chave, omita a chave. "
                        "Responda SOMENTE o JSON, sem markdown, sem explicação."
                    ),
                },
                {"role": "user", "content": f"Texto{name_context}:\n\n{text}"},
            ],
            temperature=0.3,
            max_tokens=300,
        )
        raw = resp.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1]
            if raw.endswith("```"):
                raw = raw[:-3]
        return json.loads(raw)
    except Exception as exc:
        logger.warning("Concept extraction failed: %s", exc.__class__.__name__)
        return {}


def _guess_entity_type(google_types: List[str]) -> str:
    type_map = {
        "restaurant": "restaurant",
        "bar": "bar",
        "cafe": "cafe",
        "lodging": "hotel",
        "night_club": "bar",
        "bakery": "cafe",
    }
    for entity_type in google_types:
        if entity_type in type_map:
            return type_map[entity_type]
    return "restaurant"


def _extract_city(place: Dict[str, Any]) -> str:
    for comp in place.get("address_components", []):
        if "locality" in comp.get("types", []) or "administrative_area_level_2" in comp.get("types", []):
            return comp.get("long_name", "")
    return ""


@router.post("", response_model=CaptureResponse)
@limiter.limit("10/minute", key_func=auth_header_key)
async def capture(
    request: Request,
    payload: CaptureRequest,
    db: Database = Depends(get_database),
    auth: dict = Depends(require_role("curator")),
):
    t0 = time.time()
    if not is_admin_auth(auth) and payload.curator_id != auth.get("user"):
        raise HTTPException(status_code=403, detail="curator_id must match the authenticated user")

    capture_id = _capture_session_id(payload.curator_id, payload.idempotency_key)
    cache_key = _capture_cache_key(capture_id)
    cached = _idempotency_cache.get(cache_key)
    if cached:
        return cached

    try:
        claim = claim_capture_session(
            db,
            capture_id=capture_id,
            curator_id=payload.curator_id,
            idempotency_key=payload.idempotency_key,
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to claim capture session")
        raise HTTPException(status_code=503, detail="Failed to claim capture session. Please try again.")

    if not claim.acquired:
        result = _response_from_session(claim.existing_session or {})
        cache_entry = result.model_dump()
        cache_entry["curator_id"] = payload.curator_id
        _idempotency_cache.set(cache_key, cache_entry)
        return result

    processing_token = claim.processing_token
    if not processing_token:
        raise HTTPException(status_code=503, detail="Capture processing claim unavailable")

    heartbeat_stop = asyncio.Event()
    heartbeat_errors: list[Exception] = []
    heartbeat_task = asyncio.create_task(
        _capture_lease_heartbeat(
            db,
            capture_id=capture_id,
            curator_id=payload.curator_id,
            processing_token=processing_token,
            stop=heartbeat_stop,
            errors=heartbeat_errors,
        )
    )

    try:
        transcription = await asyncio.to_thread(_transcribe, payload.audio, payload.language)
        _raise_capture_heartbeat_error(heartbeat_errors)
        if not transcription:
            raise HTTPException(status_code=422, detail="Could not transcribe audio")

        restaurant_name = await asyncio.to_thread(_extract_restaurant_name, transcription)
        _raise_capture_heartbeat_error(heartbeat_errors)
        entities = await asyncio.to_thread(_match_entities, db, restaurant_name)
        _raise_capture_heartbeat_error(heartbeat_errors)
        concepts = await asyncio.to_thread(_extract_concepts, transcription, restaurant_name)
        _raise_capture_heartbeat_error(heartbeat_errors)

        heartbeat_stop.set()
        await heartbeat_task
        _raise_capture_heartbeat_error(heartbeat_errors)
        completed_session = complete_capture_session(
            db,
            capture_id=capture_id,
            curator_id=payload.curator_id,
            processing_token=processing_token,
            result_fields={
                "transcription": transcription,
                "restaurant_name": restaurant_name,
                "entities": entities,
                "concepts": concepts,
            },
        )
    except HTTPException:
        abandon_capture_session(
            db,
            capture_id=capture_id,
            curator_id=payload.curator_id,
            processing_token=processing_token,
        )
        raise
    except Exception:
        abandon_capture_session(
            db,
            capture_id=capture_id,
            curator_id=payload.curator_id,
            processing_token=processing_token,
        )
        logger.exception("Capture processing failed")
        raise HTTPException(status_code=500, detail="Capture processing failed")
    finally:
        heartbeat_stop.set()
        if not heartbeat_task.done():
            await heartbeat_task

    result = _response_from_session(completed_session)
    cache_entry = result.model_dump()
    cache_entry["curator_id"] = payload.curator_id
    _idempotency_cache.set(cache_key, cache_entry)
    logger.info("Capture %s completed in %dms", capture_id, int((time.time() - t0) * 1000))
    return result


@router.post("/{capture_id}/confirm", response_model=CaptureConfirmResponse)
@limiter.limit("20/minute", key_func=auth_header_key)
async def confirm_capture(
    request: Request,
    capture_id: str,
    payload: CaptureConfirmRequest,
    db: Database = Depends(get_database),
    auth: dict = Depends(require_role("curator")),
):
    col = _capture_collection(db)
    try:
        session = col.find_one({"_id": capture_id})
    except Exception:
        logger.warning("MongoDB unavailable during confirm, trying in-process cache")
        session = None
    if not session:
        session = _idempotency_cache.get(_capture_cache_key(capture_id)) or _idempotency_cache.get(capture_id)
        if not session:
            raise HTTPException(status_code=404, detail="Capture session not found")

    if not is_admin_auth(auth):
        from app.services.curation_service import _is_placeholder_identity

        session_owner = session.get("curator_id") or (session.get("curator") or {}).get("id")
        if not _is_placeholder_identity(session_owner) and session_owner != auth.get("user"):
            raise HTTPException(status_code=403, detail="capture session does not belong to the authenticated user")

    confirm_key = _confirm_cache_key(capture_id, payload.idempotency_key)
    cached_confirm = _idempotency_cache.get(confirm_key)
    if cached_confirm:
        return cached_confirm

    transcription = session.get("transcription", "")
    entities = session.get("entities", [])
    concepts = session.get("concepts", {})
    curator_id = session.get("curator_id", "unknown")
    matched_entity = next((entity for entity in entities if entity.get("entity_id") == payload.entity_id), None)
    if not matched_entity:
        raise HTTPException(status_code=422, detail="Entity not in capture matches")

    entity_doc = db.entities.find_one({"_id": payload.entity_id})
    if not entity_doc:
        if matched_entity.get("source") == "google_places" and matched_entity.get("place_id"):
            entity_doc = await asyncio.to_thread(_create_entity_from_place, matched_entity, db)
        if not entity_doc:
            try:
                entity = upsert_entity(
                    db,
                    EntityCreate(
                        entity_id=payload.entity_id,
                        name=matched_entity.get("name", "Unknown"),
                        type=matched_entity.get("type", "restaurant"),
                        data={"location": matched_entity.get("location", {})},
                        status="active",
                        createdBy=curator_id,
                    ),
                )
                entity_doc = db.entities.find_one({"_id": entity.id})
            except DuplicateKeyError:
                entity_doc = db.entities.find_one({"_id": payload.entity_id})
                if not entity_doc:
                    raise

    now = datetime.now(timezone.utc)
    curation_id = _curation_id_for_capture(capture_id)
    session_curator = session.get("curator") if isinstance(session.get("curator"), dict) else None
    curator = session_curator or {"id": curator_id, "name": curator_id}
    if not curator.get("id"):
        curator["id"] = curator_id
    if not curator.get("name"):
        curator["name"] = curator_id

    # Capture creates a human-authored draft. Linkage is represented solely by
    # entity_id; workflow status is never overloaded with linkage state.
    curation = CurationCreate(
        curation_id=curation_id,
        entity_id=payload.entity_id,
        curator_id=curator_id,
        curator=curator,
        curator_type="human",
        status="draft",
        restaurant_name=matched_entity.get("name") or session.get("restaurant_name"),
        categories=concepts if isinstance(concepts, dict) else {},
        notes={"public": transcription},
        transcript=transcription,
        sources={"audio": [{"source_id": capture_id, "created_at": now.isoformat()}]},
        createdBy=curator_id,
    )

    try:
        created = create_curation_doc(db, curation, auth)
        confirmed_entity_id = created.entity_id or payload.entity_id
    except HTTPException as exc:
        if exc.status_code != 409:
            raise
        existing = find_curation(db, curation_id)
        if not existing:
            raise
        confirmed_entity_id = existing.get("entity_id") or payload.entity_id
        logger.info("Curation %s already exists; preserving stored version", curation_id)

    try:
        col.update_one(
            {"_id": capture_id},
            {"$set": {"status": "confirmed", "curation_id": curation_id}},
        )
    except Exception:
        logger.warning("Failed to update capture session status after successful confirmation")

    result = CaptureConfirmResponse(curation_id=curation_id, entity_id=confirmed_entity_id, status="created")
    _idempotency_cache.set(confirm_key, result.model_dump())
    logger.info("Capture %s confirmed → curation %s", capture_id, curation_id)
    return result


def _create_entity_from_place(match: Dict[str, Any], db: Database) -> Optional[Dict[str, Any]]:
    """Fetch Google details, then delegate the mutation to entity_service."""
    import googlemaps

    api_key = os.getenv("GOOGLE_PLACES_API_KEY")
    if not api_key:
        return None
    try:
        gmaps = googlemaps.Client(key=api_key)
        details = gmaps.place(match["place_id"], language="pt-BR")
        place = details.get("result", {})
        entity_id = match["entity_id"]
        entity = upsert_entity(
            db,
            EntityCreate(
                entity_id=entity_id,
                name=place.get("name") or match.get("name", "Unknown"),
                type=_guess_entity_type(place.get("types", [])),
                data={
                    "place_id": match["place_id"],
                    "location": {
                        "address": place.get("formatted_address", ""),
                        "city": _extract_city(place),
                        "latitude": place.get("geometry", {}).get("location", {}).get("lat"),
                        "longitude": place.get("geometry", {}).get("location", {}).get("lng"),
                    },
                    "contact": {
                        "phone": place.get("formatted_phone_number", ""),
                        "website": place.get("website", ""),
                    },
                    "rating": place.get("rating"),
                },
                status="active",
            ),
        )
        return db.entities.find_one({"_id": entity.id})
    except DuplicateKeyError:
        entity_doc = db.entities.find_one({"_id": match.get("entity_id")})
        if entity_doc:
            return entity_doc
        raise
    except Exception as exc:
        logger.warning("Failed to create entity from place: %s", exc.__class__.__name__)
        return None
