"""
Capture endpoints — voice-to-curation pipeline.

POST /capture           Upload audio, get back transcription + entity matches.
POST /capture/{id}/confirm  Confirm the match, create the curation.
"""

import base64
import json
import logging
import os
import re
import tempfile
import time
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError

from app.core.database import get_database
from app.core.security import verify_auth
from app.services.curation_denorm import denormalize_curation_location

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/capture", tags=["Capture"])


# ── Pydantic models ─────────────────────────────────────────────────────────

class CaptureRequest(BaseModel):
    audio: str = Field(..., description="Base64-encoded audio (webm/mp3)")
    idempotency_key: str = Field(..., description="Client-generated UUID for dedup")
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
    idempotency_key: str = Field(..., description="Client-generated UUID for dedup")


class CaptureConfirmResponse(BaseModel):
    curation_id: str
    entity_id: str
    status: str = "created"


# ── In-memory idempotency cache (bounded LRU via dict, ~1000 entries) ───────

class _LRUDict:
    """Simple LRU dict for idempotency cache — bounded at maxsize."""

    def __init__(self, maxsize: int = 1000):
        self._data: Dict[str, Any] = {}
        self._maxsize = maxsize

    def get(self, key: str, default=None):
        return self._data.get(key, default)

    def set(self, key: str, value: Any):
        if len(self._data) >= self._maxsize:
            # Evict oldest (first inserted)
            oldest = next(iter(self._data))
            del self._data[oldest]
        self._data[key] = value


_idempotency_cache = _LRUDict(maxsize=2000)

# ── Capture state store (MongoDB) ────────────────────────────────────────────

def _capture_collection(db: Database):
    """Get the capture_sessions collection."""
    return db["capture_sessions"]


# ── AI helpers ───────────────────────────────────────────────────────────────

def _transcribe(audio_base64: str, language: str = "pt-BR") -> str:
    """Transcribe audio using OpenAI Whisper. Returns text."""
    import openai

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")

    client = openai.OpenAI(api_key=api_key)

    # Write base64 to temp file
    audio_bytes = base64.b64decode(audio_base64)
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(audio_bytes)
        tmp_path = f.name

    try:
        with open(tmp_path, "rb") as audio_file:
            transcript = client.audio.transcriptions.create(
                model="whisper-1", file=audio_file, language=language,
            )
        return transcript.text.strip()
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _extract_restaurant_name(text: str) -> Optional[str]:
    """Extract restaurant name from transcription using OpenAI."""
    import openai

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None  # non-critical, fall through

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
    except Exception as e:
        logger.warning(f"Failed to extract restaurant name: {e}")
        return None


def _match_entities(db: Database, restaurant_name: Optional[str]) -> List[Dict[str, Any]]:
    """Search for matching entities in MongoDB, fall back to Google Places if needed."""
    entities: List[Dict[str, Any]] = []

    if restaurant_name:
        escaped_name = re.escape(restaurant_name)
        # 1. Exact match
        exact = list(
            db.entities.find(
                {"name": {"$regex": f"^{escaped_name}$", "$options": "i"}},
                {"name": 1, "type": 1, "data.location": 1, "data.place_id": 1},
            ).limit(5)
        )
        entities.extend(exact)

    if not entities and restaurant_name:
        # escaped_name already computed above
        # 2. Partial match
        partial = list(
            db.entities.find(
                {"name": {"$regex": escaped_name, "$options": "i"}},
                {"name": 1, "type": 1, "data.location": 1, "data.place_id": 1},
            ).limit(5)
        )
        entities.extend(partial)

    # 3. If no matches found, try Google Places (only if name was extracted)
    if not entities and restaurant_name and os.getenv("GOOGLE_PLACES_API_KEY"):
        logger.info(f"No entities found for '{restaurant_name}', searching Google Places...")
        try:
            import googlemaps
            gmaps = googlemaps.Client(key=os.getenv("GOOGLE_PLACES_API_KEY"))
            places = gmaps.places(
                restaurant_name, language="pt-BR",
            )
            for place in places.get("results", [])[:5]:
                loc = place.get("geometry", {}).get("location", {})
                entities.append({
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
                })
        except Exception as e:
            logger.warning(f"Google Places search failed: {e}")

    # Format results
    results = []
    for i, ent in enumerate(entities):
        score = 0.97 - (i * 0.1) if ent.get("source") != "google_places" else (ent.get("score", 0.7) - (i * 0.1))
        score = max(0.2, round(score, 2))

        loc_data = ent.get("data", {}).get("location", {}) if isinstance(ent.get("data"), dict) else ent.get("location", {})

        results.append({
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
        })
    return results


def _extract_concepts(text: str, restaurant_name: Optional[str]) -> Dict[str, Any]:
    """Extract curation categories from the transcription using OpenAI."""
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
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1]
            if raw.endswith("```"):
                raw = raw[:-3]
        return json.loads(raw)
    except Exception as e:
        logger.warning(f"Concept extraction failed: {e}")
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
    for t in google_types:
        if t in type_map:
            return type_map[t]
    return "restaurant"


def _extract_city(place: Dict[str, Any]) -> str:
    for comp in place.get("address_components", []):
        if "locality" in comp.get("types", []) or "administrative_area_level_2" in comp.get("types", []):
            return comp.get("long_name", "")
    return ""


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("", response_model=CaptureResponse)
async def capture(
    request: CaptureRequest,
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth),
):
    """
    Upload audio to start a capture session.

    Transcribes the audio, extracts the restaurant name, matches against
    known entities (or searches Google Places), and extracts curation concepts.
    Returns everything needed for the curator to confirm the match.

    Idempotent: re-sending the same idempotency_key returns the cached result.
    Does NOT create a curation — that happens on /capture/{capture_id}/confirm.
    """
    t0 = time.time()

    # ── Idempotency check ──
    cached = _idempotency_cache.get(request.idempotency_key)
    if cached:
        logger.info(f"Capture idempotency hit: {request.idempotency_key}")
        return cached

    # ── 1. Transcribe ──
    logger.info(f"Transcribing audio ({len(request.audio)} chars base64)...")
    try:
        transcription = _transcribe(request.audio, request.language)
        if not transcription:
            raise HTTPException(status_code=422, detail="Could not transcribe audio")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

    logger.info(f"Transcription: {transcription[:200]}...")

    # ── 2. Extract restaurant name ──
    restaurant_name = _extract_restaurant_name(transcription)
    logger.info(f"Extracted name: {restaurant_name}")

    # ── 3. Match entities ──
    entities = _match_entities(db, restaurant_name)
    logger.info(f"Found {len(entities)} entity matches")

    # ── 4. Extract concepts ──
    concepts = _extract_concepts(transcription, restaurant_name)
    logger.info(f"Extracted concepts: {list(concepts.keys())}")

    # ── 5. Store capture session ──
    # Persist to MongoDB FIRST, then cache on success.
    # If MongoDB is down, we return 503 without polluting the cache.
    col = _capture_collection(db)
    session_doc = {
        "_id": request.idempotency_key,
        "capture_id": request.idempotency_key,
        "transcription": transcription,
        "restaurant_name": restaurant_name,
        "entities": entities,
        "concepts": concepts,
        "curator_id": request.curator_id,
        "status": "pending_confirmation",
        "createdAt": datetime.now(timezone.utc),
    }
    try:
        col.replace_one({"_id": request.idempotency_key}, session_doc, upsert=True)
    except Exception as e:
        logger.error(f"Failed to persist capture session: {e}")
        raise HTTPException(
            status_code=503,
            detail="Failed to persist capture session. Please try again.",
        )

    result = CaptureResponse(
        capture_id=request.idempotency_key,
        transcription=transcription,
        restaurant_name=restaurant_name,
        entities=entities,
        concepts=concepts,
    )

    # Now that MongoDB succeeded, populate the idempotency cache
    # Include curator_id so cache fallback in confirm preserves provenance
    cache_entry = result.model_dump()
    cache_entry["curator_id"] = request.curator_id
    _idempotency_cache.set(request.idempotency_key, cache_entry)

    elapsed_ms = int((time.time() - t0) * 1000)
    logger.info(f"Capture {request.idempotency_key} completed in {elapsed_ms}ms")
    return result


@router.post("/{capture_id}/confirm", response_model=CaptureConfirmResponse)
async def confirm_capture(
    capture_id: str,
    request: CaptureConfirmRequest,
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth),
):
    """
    Confirm a capture session and create the curation.

    Retrieves the stored capture state (transcription + concepts), resolves the
    chosen entity (creates if from Google Places), creates the curation, and
    returns the curation ID.
    """
    # ── Idempotency check ──
    confirm_key = f"confirm:{request.idempotency_key}"
    cached_confirm = _idempotency_cache.get(confirm_key)
    if cached_confirm:
        return cached_confirm

    # ── Retrieve capture session ──
    col = _capture_collection(db)
    try:
        session = col.find_one({"_id": capture_id})
    except Exception as e:
        logger.warning(f"MongoDB unavailable during confirm, trying cache: {e}")
        session = None
    if not session:
        # Try cache fallback
        cached = _idempotency_cache.get(capture_id)
        if cached:
            session = cached
        else:
            raise HTTPException(status_code=404, detail="Capture session not found")

    transcription = session.get("transcription", "")
    entities = session.get("entities", [])
    concepts = session.get("concepts", {})
    curator_id = session.get("curator_id", "unknown")

    # ── Resolve entity ──
    matched_entity = None
    for e in entities:
        if e.get("entity_id") == request.entity_id:
            matched_entity = e
            break

    if not matched_entity:
        raise HTTPException(status_code=422, detail="Entity not in capture matches")

    # Ensure entity exists in the entities collection
    entity_doc = db.entities.find_one({"_id": request.entity_id})
    if not entity_doc:
        # Create from Google Places match
        if matched_entity.get("source") == "google_places" and matched_entity.get("place_id"):
            # Fetch full place details from Google
            new_entity = _create_entity_from_place(matched_entity, db)
            if new_entity:
                entity_doc = new_entity
            else:
                logger.warning(
                    f"Google Places enrichment failed for {matched_entity.get('name')} "
                    f"(place_id={matched_entity.get('place_id')}), "
                    f"creating skeleton entity with minimal data"
                )

        if not entity_doc:
            # Last resort: create a minimal entity
            entity_doc = {
                "_id": request.entity_id,
                "entity_id": request.entity_id,
                "name": matched_entity.get("name", "Unknown"),
                "type": matched_entity.get("type", "restaurant"),
                "data": {"location": matched_entity.get("location", {})},
                "status": "active",
                "createdBy": curator_id,
                "createdAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc),
            }
            try:
                db.entities.insert_one(entity_doc)
            except DuplicateKeyError:
                # Another parallel confirm already created this entity
                entity_doc = db.entities.find_one({"_id": request.entity_id})
                logger.info(f"Entity {request.entity_id} already exists (race), reusing")

    # ── Create curation ──
    now = datetime.now(timezone.utc)
    curation_id = f"cur_{capture_id[:16]}"

    curation_doc = {
        "_id": curation_id,
        "curation_id": curation_id,
        "entity_id": request.entity_id,
        "curator_id": curator_id,
        "curator": {"id": curator_id, "name": curator_id},
        "status": "linked",
        "restaurant_name": matched_entity.get("name") or session.get("restaurant_name"),
        "categories": concepts if isinstance(concepts, dict) else {},
        "notes": {"public": transcription},
        "transcript": transcription,
        "sources": {"audio": [{"created_at": now.isoformat()}]},
        "createdBy": curator_id,
        "updatedBy": curator_id,
        "createdAt": now,
        "updatedAt": now,
        "version": 1,
    }

    # Denormalize city/type
    denorm = denormalize_curation_location(entity_doc)
    curation_doc.update(denorm)

    try:
        db.curations.insert_one(curation_doc)
    except DuplicateKeyError:
        # Race: another confirm request created this curation between
        # our existence check and insert. Update with our data, preserving
        # the original createdAt from whoever won the race.
        logger.warning(f"Curation {curation_id} already exists (race), updating")
        update_fields = {k: v for k, v in curation_doc.items() if k not in ("_id", "createdAt")}
        db.curations.update_one({"_id": curation_id}, {"$set": update_fields})

    # ── Mark session as done ──
    try:
        col.update_one({"_id": capture_id}, {"$set": {"status": "confirmed"}})
    except Exception as e:
        # Curation already created — don't fail the request over status update
        logger.warning(f"Failed to update session status to confirmed: {e}")

    result = CaptureConfirmResponse(
        curation_id=curation_id,
        entity_id=request.entity_id,
        status="created",
    )

    _idempotency_cache.set(confirm_key, result.model_dump())

    logger.info(f"Capture {capture_id} confirmed → curation {curation_id}")
    return result


def _create_entity_from_place(match: Dict[str, Any], db: Database) -> Optional[Dict[str, Any]]:
    """Fetch full place details from Google and create an entity."""
    import googlemaps

    api_key = os.getenv("GOOGLE_PLACES_API_KEY")
    if not api_key:
        return None

    try:
        gmaps = googlemaps.Client(key=api_key)
        details = gmaps.place(match["place_id"], language="pt-BR")
        place = details.get("result", {})

        entity_id = match["entity_id"]
        entity_doc = {
            "_id": entity_id,
            "entity_id": entity_id,
            "name": place.get("name") or match.get("name", "Unknown"),
            "type": _guess_entity_type(place.get("types", [])),
            "data": {
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
            "status": "active",
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
        }
        try:
            db.entities.insert_one(entity_doc)
        except DuplicateKeyError:
            logger.info(f"Entity {entity_id} already exists (race), reusing existing")
            entity_doc = db.entities.find_one({"_id": entity_id})
        logger.info(f"Created entity from Google Places: {entity_id}")
        return entity_doc
    except Exception as e:
        logger.warning(f"Failed to create entity from place: {e}")
        return None
