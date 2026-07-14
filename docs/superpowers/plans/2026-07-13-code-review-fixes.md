# Code Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply all 15+ findings from the 2026-07-12 max-effort code review: fix regex injection, harden capture/confirm flow, extract shared auth, config-drive OAuth origins, and clean up low-severity issues.

**Architecture:** Extract the 5× duplicated `verify_auth` into a single synchronous function in `app/core/security.py` (fixing bare except, missing role, async event-loop blocking, and RuntimeError handling in one change). Harden the capture→confirm pipeline against MongoDB degradation by reordering cache writes, wrapping MongoDB calls, and handling entity-insert races. Drive OAuth trusted origins from a Pydantic Settings field instead of a hardcoded set. Patch the overlooked regex injection in hybrid_search.

**Tech Stack:** Python 3.11+, FastAPI, PyMongo (MongoDB), python-jose (JWT), Pydantic Settings

## Global Constraints

- All changes must maintain backward compatibility — existing clients (API key, JWT Bearer, OAuth flow) continue working
- Bare `except:` → `except Exception:` everywhere touched
- Module-level imports preferred over inline imports (ALGORITHM is a constant, no circular-dependency risk)
- TDD: write failing test → implement → verify pass → commit

---

### Task 1: Extract shared `verify_auth` to `security.py` and update all 5 consumers

**Files:**
- Modify: `concierge-api-v3/app/core/security.py` (add `verify_auth`, update exports)
- Modify: `concierge-api-v3/app/api/openai_compat.py:24,49-68` (remove local copy, import shared)
- Modify: `concierge-api-v3/app/api/capture.py:24,37-55` (remove local copy, import shared)
- Modify: `concierge-api-v3/app/api/curations.py:24,28,55-83` (remove local copy, import shared)
- Modify: `concierge-api-v3/app/api/entities.py:26-55` (remove local copy, import shared)
- Modify: `concierge-api-v3/app/api/ai.py:24-46` (remove local copy, import shared)

**Interfaces:**
- Produces: `verify_auth(api_key, bearer) -> dict` in `app.core.security` — sync function, returns `{"authenticated": True, "method": "api_key"|"jwt", "user": str, "role": str}`, raises HTTPException(401) or HTTPException(500)
- Consumes: `api_key_header`, `bearer_scheme`, `get_api_secret_key`, `ALGORITHM` (all already in security.py)

- [ ] **Step 1: Add shared `verify_auth` to `security.py`**

Insert after the `verify_access_token` function (before `__all__` at line 334):

```python
def verify_auth(
    api_key: Optional[str] = Security(api_key_header),
    bearer: Optional[HTTPAuthorizationCredentials] = Security(bearer_scheme),
) -> dict:
    """Verify either API key (X-API-Key header) or JWT Bearer token.

    Returns a dict with authentication metadata. Use as a FastAPI dependency:
        auth: dict = Depends(verify_auth)

    Raises HTTPException(401) if neither credential is valid.
    Raises HTTPException(500) if API_SECRET_KEY is not configured.
    """
    import logging
    logger = logging.getLogger(__name__)

    # Try API key first
    if api_key:
        try:
            expected_key = get_api_secret_key()
            if secrets.compare_digest(api_key, expected_key):
                return {"authenticated": True, "method": "api_key"}
        except RuntimeError:
            # API_SECRET_KEY not configured — surface to operators
            logger.error("API_SECRET_KEY not configured — rejecting API key auth")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Server authentication not configured (missing API_SECRET_KEY)",
            )
        except Exception:
            pass

    # Try JWT Bearer token
    if bearer:
        try:
            payload = jwt.decode(bearer.credentials, get_api_secret_key(), algorithms=[ALGORITHM])
            return {
                "authenticated": True,
                "method": "jwt",
                "user": payload.get("sub"),
                "role": payload.get("role", "curator"),
            }
        except RuntimeError:
            logger.error("API_SECRET_KEY not configured — cannot decode JWT")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Server authentication not configured (missing API_SECRET_KEY)",
            )
        except JWTError:
            pass

    raise HTTPException(status_code=401, detail="Missing authorization token")
```

Update `__all__` at line 336-341 to include `verify_auth`:

```python
__all__ = [
    "verify_api_key",
    "optional_api_key",
    "generate_api_key",
    "api_key_header",
    "verify_auth",
]
```

- [ ] **Step 2: Write test for shared `verify_auth`**

Create `concierge-api-v3/tests/test_verify_auth.py`:

```python
"""Tests for shared verify_auth dependency."""
import pytest
from unittest.mock import patch, MagicMock
from fastapi import HTTPException


class TestVerifyAuth:
    """Test the shared verify_auth function in security.py."""

    def test_api_key_valid(self):
        """Valid API key returns authenticated dict."""
        from app.core.security import verify_auth
        from app.core.config import settings

        result = verify_auth(api_key=settings.api_secret_key, bearer=None)
        assert result["authenticated"] is True
        assert result["method"] == "api_key"

    def test_api_key_invalid_then_no_bearer_raises_401(self):
        """Invalid API key and no bearer raises 401."""
        from app.core.security import verify_auth

        with pytest.raises(HTTPException) as exc:
            verify_auth(api_key="bad-key", bearer=None)
        assert exc.value.status_code == 401

    def test_no_credentials_raises_401(self):
        """Neither API key nor bearer raises 401."""
        from app.core.security import verify_auth

        with pytest.raises(HTTPException) as exc:
            verify_auth(api_key=None, bearer=None)
        assert exc.value.status_code == 401

    def test_bearer_missing_role_defaults_to_curator(self):
        """JWT without role claim defaults to 'curator'."""
        from app.core.security import verify_auth, create_access_token

        token = create_access_token(data={"sub": "test@example.com"})
        from fastapi.security import HTTPAuthorizationCredentials
        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        result = verify_auth(api_key=None, bearer=creds)
        assert result["authenticated"] is True
        assert result["method"] == "jwt"
        assert result["role"] == "curator"

    def test_bearer_invalid_raises_401(self):
        """Invalid JWT raises 401."""
        from app.core.security import verify_auth
        from fastapi.security import HTTPAuthorizationCredentials

        creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials="not.a.jwt")
        with pytest.raises(HTTPException) as exc:
            verify_auth(api_key=None, bearer=creds)
        assert exc.value.status_code == 401

    def test_api_key_misconfigured_returns_500(self):
        """Missing API_SECRET_KEY returns 500 with diagnostic, not silent skip."""
        from app.core.security import verify_auth
        with patch("app.core.security.get_api_secret_key", side_effect=RuntimeError("not set")):
            with pytest.raises(HTTPException) as exc:
                verify_auth(api_key="anything", bearer=None)
            assert exc.value.status_code == 500
```

- [ ] **Step 3: Run tests to verify they fail (shared verify_auth not yet used)**

Run: `pytest tests/test_verify_auth.py -v`
Expected: PASS (shared function works independently of consumers)

- [ ] **Step 4: Update `openai_compat.py` to use shared `verify_auth`**

Remove local `verify_auth` (lines 49-68). Replace module-level imports at line 24:

Old:
```python
from app.core.security import api_key_header, bearer_scheme, get_api_secret_key
```

New:
```python
from app.core.security import api_key_header, bearer_scheme, get_api_secret_key, verify_auth
```

Also remove unused imports that were only needed by local verify_auth:
- Remove `from fastapi.security import HTTPAuthorizationCredentials` (line 13) if no other usage
- Remove `from jose import jwt, JWTError` (line 22) if no other usage — check: `jwt` and `JWTError` are only used in the local verify_auth, so remove line 22.
- Remove `import secrets` (line 20) if no other usage — check: `secrets` is not used elsewhere in openai_compat.py, so remove line 20.

- [ ] **Step 5: Update `capture.py` to use shared `verify_auth`**

Remove local `verify_auth` (lines 37-55). Update imports at line 26:

Old:
```python
from app.core.security import api_key_header, bearer_scheme, get_api_secret_key
```

New:
```python
from app.core.security import verify_auth
```

Remove now-unused imports:
- `from fastapi.security import HTTPAuthorizationCredentials` (line 20) — no longer needed
- `from jose import jwt, JWTError` (line 28) — no longer needed
- `import secrets` (line 23) — not used elsewhere in capture.py

- [ ] **Step 6: Update `curations.py` to use shared `verify_auth`**

Remove local `verify_auth` (lines 55-83). Update imports at line 24,28:

Old (line 24):
```python
from app.core.security import verify_access_token, api_key_header, bearer_scheme, get_api_secret_key
```

Old (line 28):
```python
from jose import jwt, JWTError
```

New (line 24):
```python
from app.core.security import verify_access_token, verify_auth
```

Remove:
- `from jose import jwt, JWTError` (line 28) — no longer needed
- `import secrets` (line 12) — check: `secrets` is not used elsewhere in curations.py, remove.

- [ ] **Step 7: Update `entities.py` to use shared `verify_auth`**

Read `concierge-api-v3/app/api/entities.py` first to find exact import lines, then:
- Remove local `verify_auth` (lines 26-55)
- Add `verify_auth` to existing import from `app.core.security`
- Remove unused `from jose import jwt, JWTError` and `import secrets` if only used by local verify_auth

- [ ] **Step 8: Update `ai.py` to use shared `verify_auth`**

Read `concierge-api-v3/app/api/ai.py` first to find exact import lines, then:
- Remove local `verify_auth` (lines 24-46)
- Add `verify_auth` to existing import from `app.core.security`
- Remove unused `from jose import jwt, JWTError` and `import secrets` if only used by local verify_auth

- [ ] **Step 9: Run full test suite**

Run: `pytest concierge-api-v3/tests/ -v --tb=short`
Expected: All existing tests pass (auth should behave identically)

- [ ] **Step 10: Commit**

```bash
git add concierge-api-v3/app/core/security.py \
        concierge-api-v3/app/api/openai_compat.py \
        concierge-api-v3/app/api/capture.py \
        concierge-api-v3/app/api/curations.py \
        concierge-api-v3/app/api/entities.py \
        concierge-api-v3/app/api/ai.py \
        concierge-api-v3/tests/test_verify_auth.py
git commit -m "refactor: extract shared verify_auth to security.py, fix bare except and missing role

- Consolidate 5 duplicate verify_auth implementations into one sync function
- Fix bare 'except:' → 'except Exception:' (prevent swallowing KeyboardInterrupt)
- Catch RuntimeError from get_api_secret_key() → 500 with diagnostic
- Always include 'role' in JWT return dict (defaults to 'curator')
- Change async def → def (no awaits; blocking calls now run in threadpool)
- Remove unused imports (jose, secrets) from 5 consumer modules"
```

---

### Task 2: Fix regex injection in `hybrid_search`

**Files:**
- Modify: `concierge-api-v3/app/api/curations.py:591-596`
- Test: `concierge-api-v3/tests/test_curations.py` (create if not exists)

**Interfaces:**
- Consumes: `request.location` (str from HybridSearchRequest body)
- Produces: escaped location string used in MongoDB `$regex`

- [ ] **Step 1: Write the failing test**

Create or append to `concierge-api-v3/tests/test_curations.py`:

```python
def test_hybrid_search_escapes_location_regex():
    """Location parameter with regex metacharacters must be escaped."""
    from app.api.curations import hybrid_search
    from app.models.schemas import HybridSearchRequest
    from unittest.mock import MagicMock, patch
    import numpy as np

    mock_db = MagicMock()
    # Return empty for entity find
    mock_db.entities.find.return_value.limit.return_value = []
    # Return empty for curation find
    mock_db.curations.find.return_value.limit.return_value = []

    request = HybridSearchRequest(
        query="pizza",
        location=".*",  # regex metacharacter — should be escaped
    )

    with patch("app.api.curations.OpenAI") as mock_openai:
        mock_client = MagicMock()
        mock_emb = MagicMock()
        mock_emb.data = [MagicMock(embedding=[0.1] * 1536)]
        mock_client.embeddings.create.return_value = mock_emb
        mock_openai.return_value = mock_client

        with patch("app.api.curations.np.linalg.norm", return_value=1.0):
            with patch("app.api.curations.np.asarray", return_value=np.array([0.1] * 1536)):
                response = hybrid_search(request, mock_db)

    # Should complete without error (no regex injection crash)
    assert response.total_results >= 0

    # Verify that find was called with escaped location (literal \\.\\*)
    # The call should have re.escape applied
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_curations.py::test_hybrid_search_escapes_location_regex -v`
Expected: The test should reveal that the call to entities.find receives unescaped `.*`

- [ ] **Step 3: Apply the fix**

In `curations.py`, change lines 591-596:

Old:
```python
    # Location filter
    if request.location:
        entity_filter["$or"] = [
            {"location.city": {"$regex": request.location, "$options": "i"}},
            {"location.neighborhood": {"$regex": request.location, "$options": "i"}},
            {"location.address": {"$regex": request.location, "$options": "i"}}
        ]
```

New:
```python
    # Location filter
    if request.location:
        escaped_location = re.escape(request.location)
        entity_filter["$or"] = [
            {"location.city": {"$regex": escaped_location, "$options": "i"}},
            {"location.neighborhood": {"$regex": escaped_location, "$options": "i"}},
            {"location.address": {"$regex": escaped_location, "$options": "i"}}
        ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_curations.py::test_hybrid_search_escapes_location_regex -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add concierge-api-v3/app/api/curations.py concierge-api-v3/tests/test_curations.py
git commit -m "fix: escape regex metacharacters in hybrid_search location parameter

request.location was interpolated directly into MongoDB $regex without
re.escape(), allowing regex injection. This is the same bug that was fixed
in _match_entities (capture.py) and search_curations (curations.py) but
was overlooked in hybrid_search."
```

---

### Task 3: Fix capture flow — cache ordering, curator_id, confirm resilience

**Files:**
- Modify: `concierge-api-v3/app/api/capture.py:395-550`
- Test: `concierge-api-v3/tests/test_capture.py` (extend existing)

**Interfaces:**
- Modifies: `capture()` — cache ordering and curator_id inclusion
- Modifies: `confirm_capture()` — wrap find_one, entity insert race handling, session status update, Google Places warning

- [ ] **Step 1: Fix cache ordering — write to cache AFTER MongoDB success**

In `capture()`, lines 395-436. Move the first `_idempotency_cache.set()` to after the MongoDB write, and include `curator_id`:

Old (lines 395-436):
```python
    # ── 5. Store capture session ──
    capture_id = _idempotency_cache.set(
        request.idempotency_key,
        {
            "capture_id": request.idempotency_key,
            "transcription": transcription,
            "restaurant_name": restaurant_name,
            "entities": entities,
            "concepts": concepts,
        },
    )
    # Also store in MongoDB for durability (confirmation endpoint needs it)
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

    _idempotency_cache.set(request.idempotency_key, result.model_dump())
```

New:
```python
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
```

- [ ] **Step 2: Wrap confirm `find_one` in try-except for MongoDB outages**

In `confirm_capture()`, line 465. Wrap the MongoDB find_one so cache fallback is reachable during outages:

Old:
```python
    # ── Retrieve capture session ──
    col = _capture_collection(db)
    session = col.find_one({"_id": capture_id})
    if not session:
        # Try cache fallback
        cached = _idempotency_cache.get(capture_id)
        if cached:
            session = cached
        else:
            raise HTTPException(status_code=404, detail="Capture session not found")
```

New:
```python
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
```

- [ ] **Step 3: Handle DuplicateKeyError on entity insert_one**

In `confirm_capture()`, wrap both entity `insert_one` calls (line 512 and line 600 in `_create_entity_from_place`):

For line 512 (minimal entity fallback), old:
```python
            db.entities.insert_one(entity_doc)
```

New:
```python
            try:
                db.entities.insert_one(entity_doc)
            except DuplicateKeyError:
                # Another parallel confirm already created this entity
                entity_doc = db.entities.find_one({"_id": request.entity_id})
                logger.info(f"Entity {request.entity_id} already exists (race), reusing")
```

For `_create_entity_from_place` (line 600), old:
```python
        db.entities.insert_one(entity_doc)
```

New:
```python
        try:
            db.entities.insert_one(entity_doc)
        except DuplicateKeyError:
            logger.info(f"Entity {entity_id} already exists (race), reusing existing")
            entity_doc = db.entities.find_one({"_id": entity_id})
```

Add `from pymongo.errors import DuplicateKeyError` to capture.py imports if not already present. (Check: it's NOT imported currently. Add at line 11 area.)

- [ ] **Step 4: Add warning when Google Places enrichment silently degrades**

In `confirm_capture()`, after the Google Places attempt at lines 493-497:

Old:
```python
        if matched_entity.get("source") == "google_places" and matched_entity.get("place_id"):
            # Fetch full place details from Google
            new_entity = _create_entity_from_place(matched_entity, db)
            if new_entity:
                entity_doc = new_entity

        if not entity_doc:
            # Last resort: create a minimal entity
```

New:
```python
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
```

- [ ] **Step 5: Wrap session status update with try-except**

In `confirm_capture()`, line 549. If the status update fails after curation creation, at least log it instead of crashing:

Old:
```python
    # ── Mark session as done ──
    col.update_one({"_id": capture_id}, {"$set": {"status": "confirmed"}})
```

New:
```python
    # ── Mark session as done ──
    try:
        col.update_one({"_id": capture_id}, {"$set": {"status": "confirmed"}})
    except Exception as e:
        # Curation already created — don't fail the request over status update
        logger.warning(f"Failed to update session status to confirmed: {e}")
```

- [ ] **Step 6: Fix confirm DuplicateKeyError handler — use $set not replace_one**

In `confirm_capture()`, line 544-546. `replace_one` overwrites `createdAt`. Use `$set` instead:

Old:
```python
    except Exception as e:
        # DuplicateKeyError — already exists
        logger.warning(f"Insert curation failed (may be duplicate): {e}")
        db.curations.replace_one({"_id": curation_id}, curation_doc, upsert=True)
```

New:
```python
    except DuplicateKeyError:
        # Race: another confirm request created this curation between
        # our existence check and insert. Update with our data, preserving
        # the original createdAt from whoever won the race.
        logger.warning(f"Curation {curation_id} already exists (race), updating")
        update_fields = {k: v for k, v in curation_doc.items() if k not in ("_id", "createdAt")}
        db.curations.update_one({"_id": curation_id}, {"$set": update_fields})
```

- [ ] **Step 7: Update tests and run suite**

Extend `concierge-api-v3/tests/test_capture.py`:

```python
def test_capture_cache_includes_curator_id():
    """Cache entry must include curator_id for confirm fallback."""
    from app.api.capture import _idempotency_cache
    # Populate cache via capture (mocked) and verify curator_id presence
    # ... (implementation uses mock_db that succeeds on replace_one)

def test_confirm_falls_back_to_cache_when_mongo_down():
    """Confirm endpoint uses cache when MongoDB find_one raises."""
    # Mock find_one to raise ServerSelectionTimeoutError
    # Verify cache.get is called and session is reconstructed

def test_confirm_handles_entity_duplicate_key_race():
    """Parallel entity inserts don't crash with 500."""
    # Mock insert_one to raise DuplicateKeyError on first call
    # Verify find_one is called to recover the existing entity
```

Run: `pytest tests/test_capture.py -v`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add concierge-api-v3/app/api/capture.py concierge-api-v3/tests/test_capture.py
git commit -m "fix: harden capture→confirm flow against MongoDB degradation

- Reorder cache write to AFTER MongoDB success (prevent stale cache on 503)
- Include curator_id in cache entry (fixes 'unknown' provenance on fallback)
- Wrap confirm find_one in try-except (cache fallback now reachable during outages)
- Handle DuplicateKeyError on entity insert_one (parallel confirms no longer 500)
- Log warning when Google Places enrichment degrades to skeleton entity
- Wrap session status update with try-except (don't fail after curation created)
- Use $set instead of replace_one on race retry (preserve original createdAt)"
```

---

### Task 4: Fix `bulk_upsert` DuplicateKeyError handler

**Files:**
- Modify: `concierge-api-v3/app/api/curations.py:903-910`

**Interfaces:**
- Modifies: `bulk_upsert_curations()` DuplicateKeyError except block

- [ ] **Step 1: Fix the handler — don't corrupt createdAt, don't silently discard errors**

In `curations.py`, lines 903-910:

Old:
```python
        except DuplicateKeyError:
            # Race: another request inserted between our find_one and insert_one.
            # Update the existing document with our data instead of silently losing it.
            try:
                db.curations.update_one({"_id": curation.curation_id}, {"$set": doc})
            except Exception:
                pass
            updated += 1
```

New:
```python
        except DuplicateKeyError:
            # Race: another request inserted between our find_one and insert_one.
            # Update the existing document with our data (preserve createdAt).
            try:
                update_doc = {k: v for k, v in doc.items() if k not in ("_id", "createdAt")}
                db.curations.update_one({"_id": curation.curation_id}, {"$set": update_doc})
                updated += 1
            except Exception as update_exc:
                errors.append(BulkItemError(
                    index=idx,
                    id=curation.curation_id,
                    error=f"Race recovery failed after DuplicateKeyError: {str(update_exc)}"
                ))
```

- [ ] **Step 2: Write test**

In `concierge-api-v3/tests/test_curations.py`:

```python
def test_bulk_upsert_duplicate_key_preserves_created_at():
    """DuplicateKeyError recovery must not overwrite original createdAt."""
    from app.api.curations import bulk_upsert_curations
    from unittest.mock import MagicMock, patch

    # Mock insert_one to raise DuplicateKeyError
    # Verify update_one is called with $set that excludes createdAt
```

- [ ] **Step 3: Run tests**

Run: `pytest tests/test_curations.py -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add concierge-api-v3/app/api/curations.py concierge-api-v3/tests/test_curations.py
git commit -m "fix: bulk_upsert DuplicateKeyError handler preserves createdAt, reports errors

- Strip createdAt from $set doc on race recovery (preserve original timestamp)
- Report recovery update_one failures as BulkItemError instead of silent pass
- Fixes double defect: timestamp corruption + invisible error swallowing"
```

---

### Task 5: Config-driven `trusted_origins` for OAuth

**Files:**
- Modify: `concierge-api-v3/app/core/config.py:46-47` (add `trusted_callback_origins` field)
- Modify: `concierge-api-v3/app/api/auth.py:229-254` (use settings field, fix bare except, return 400 on untrusted)
- Test: `concierge-api-v3/tests/test_auth.py` (extend existing)

**Interfaces:**
- Produces: `settings.trusted_callback_origins_list` → `List[str]`
- Modifies: `google_oauth_init()` — validated against config-driven list

- [ ] **Step 1: Add `trusted_callback_origins` setting**

In `config.py`, add after `frontend_url_production` (line 47):

```python
    # OAuth callback URL allowlist (JSON list of trusted frontend origins)
    trusted_callback_origins: str = '[]'
```

Add a property to parse it (after `cors_origins_list` at line 83):

```python
    @property
    def trusted_callback_origins_list(self) -> List[str]:
        """Parse trusted callback origins from JSON string, merge with frontend URLs."""
        try:
            explicit = json.loads(self.trusted_callback_origins)
        except (json.JSONDecodeError, TypeError):
            explicit = []
        # Always include the configured frontend URLs
        merged = set(explicit)
        if self.frontend_url:
            merged.add(self.frontend_url)
        if self.frontend_url_production:
            merged.add(self.frontend_url_production)
        return sorted(merged)
```

- [ ] **Step 2: Update `google_oauth_init` to use settings**

In `auth.py`, replace lines 228-254:

Old:
```python
    frontend_redirect_url = callback_url
    if not frontend_redirect_url and request:
        # Extract origin from Referer header
        referer = request.headers.get('referer', '')
        if referer:
            try:
                from urllib.parse import urlparse
                parsed = urlparse(referer)
                frontend_redirect_url = f"{parsed.scheme}://{parsed.netloc}"
            except Exception:
                pass
    if not frontend_redirect_url:
        frontend_redirect_url = settings.frontend_url

    # Validate frontend_redirect_url against trusted origins
    trusted_origins = {
        settings.frontend_url,
        settings.frontend_url_production,
        "http://localhost:3000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://127.0.0.1:5501",
        "http://localhost:8080",
    }
    if frontend_redirect_url not in trusted_origins:
        logger.warning(f"[OAuth] Untrusted callback_url rejected: {frontend_redirect_url}")
        frontend_redirect_url = settings.frontend_url
```

New:
```python
    frontend_redirect_url = callback_url
    if not frontend_redirect_url and request:
        # Extract origin from Referer header (works for any domain: Render, localhost, custom)
        referer = request.headers.get('referer', '')
        if referer:
            try:
                from urllib.parse import urlparse
                parsed = urlparse(referer)
                frontend_redirect_url = f"{parsed.scheme}://{parsed.netloc}"
            except Exception:
                pass
    if not frontend_redirect_url:
        frontend_redirect_url = settings.frontend_url

    # Validate frontend_redirect_url against config-driven trusted origins
    trusted_origins = set(settings.trusted_callback_origins_list)
    # Also accept localhost dev URLs (not stored in production config)
    trusted_origins.update({
        "http://localhost:3000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://127.0.0.1:5501",
        "http://localhost:8080",
    })
    if frontend_redirect_url not in trusted_origins:
        logger.warning(f"[OAuth] Untrusted callback_url rejected: {frontend_redirect_url}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Untrusted callback URL: {frontend_redirect_url}"
        )
```

- [ ] **Step 3: Update .env with default trusted_origins**

In `concierge-api-v3/.env`, add (or document the setting):

```
TRUSTED_CALLBACK_ORIGINS=["http://localhost:3000","http://localhost:5500","http://127.0.0.1:5500","http://127.0.0.1:5501","http://localhost:8080"]
```

- [ ] **Step 4: Update tests for 400 response on untrusted URL**

In `tests/test_auth.py`, update `test_oauth_init_rejects_untrusted_callback_url`:

Old assertion:
```python
    assert response.status_code == 307
    # Decodificar state JWT e verificar que evil.com NÃO está no payload
```

New assertion:
```python
    # Deve rejeitar com 400 (não redirecionar silenciosamente)
    assert response.status_code == 400
    data = response.json()
    assert "Untrusted callback URL" in data.get("detail", "")
```

- [ ] **Step 5: Run tests**

Run: `pytest tests/test_auth.py -v`
Expected: Updated tests pass

- [ ] **Step 6: Commit**

```bash
git add concierge-api-v3/app/core/config.py \
        concierge-api-v3/app/api/auth.py \
        concierge-api-v3/tests/test_auth.py \
        concierge-api-v3/.env
git commit -m "refactor: config-driven OAuth callback URL allowlist

- Add trusted_callback_origins Pydantic setting (JSON list)
- Merge frontend_url + frontend_url_production into allowlist automatically
- Return 400 Bad Request on untrusted callback URL (was silent fallback)
- Keep localhost dev URLs as hardcoded safe defaults
- Fix bare 'except Exception:' in referer parsing (was already correct)"
```

---

### Task 6: OpenAI endpoints auth consistency

**Files:**
- Modify: `concierge-api-v3/app/api/openai_compat.py:322-323`

- [ ] **Step 1: Add auth to `/v1/models` for consistency**

In `openai_compat.py`, line 322-323:

Old:
```python
@router.get("/v1/models", response_model=ModelsResponse)
async def list_models():
```

New:
```python
@router.get("/v1/models", response_model=ModelsResponse)
async def list_models(
    auth: dict = Depends(verify_auth),
):
```

- [ ] **Step 2: Update system tests**

In `tests/test_system.py`, add to `test_openai_endpoints_require_auth`:

```python
        # GET /v1/models sem auth
        response = client.get("/api/v3/openai/v1/models")
        assert response.status_code == 401
```

And in `test_openai_endpoints_with_auth`:

```python
        # GET /v1/models com auth
        response = client.get("/api/v3/openai/v1/models", headers=auth_headers)
        assert response.status_code != 401
```

- [ ] **Step 3: Run tests**

Run: `pytest tests/test_system.py::TestSystemEndpoints -v`
Expected: Updated tests pass

- [ ] **Step 4: Commit**

```bash
git add concierge-api-v3/app/api/openai_compat.py concierge-api-v3/tests/test_system.py
git commit -m "fix: require auth on /v1/models for consistency with other OpenAI endpoints

Previously /v1/models was public while /v1/functions and /v1/chat/completions
required auth, creating a confusing LM Studio UX: model discovery (200) followed
by chat failure (401). Now all OpenAI-compatible endpoints consistently require
authentication."
```

---

### Task 7: Low-severity cleanups

**Files:**
- Modify: `concierge-api-v3/app/api/capture.py:9,123,199,210` (unused import, TTL index, re.escape hoisting)
- Modify: `concierge-api-v3/app/api/curations.py:221-227` (add `.limit()`)
- Modify: `concierge-api-v3/tests/test_system.py:65-75` (fix dead assertion)
- Create: `concierge-api-v3/app/core/lifespan.py` (startup index creation)

**Interfaces:**
- Produces: `lifespan` async context manager for FastAPI app
- Modified: `main.py` to use lifespan for startup index creation

- [ ] **Step 1: Remove unused `import hashlib` and dead assignment**

In `capture.py`:
- Remove line 9: `import hashlib`
- Remove the variable capture at line 396: change `capture_id = _idempotency_cache.set(` to `_idempotency_cache.set(`

- [ ] **Step 2: Hoist `re.escape` in `_match_entities`**

In `capture.py`, lines 198-210:

Old:
```python
    if restaurant_name:
        escaped_name = re.escape(restaurant_name)
        # 1. Exact match
        exact = list(
            db.entities.find(
                {"name": {"$regex": f"^{escaped_name}$", "$options": "i"}},
                ...
            ).limit(5)
        )
        entities.extend(exact)

    if not entities and restaurant_name:
        escaped_name = re.escape(restaurant_name)
        # 2. Partial match
```

New:
```python
    if restaurant_name:
        escaped_name = re.escape(restaurant_name)
        # 1. Exact match
        exact = list(
            db.entities.find(
                {"name": {"$regex": f"^{escaped_name}$", "$options": "i"}},
                ...
            ).limit(5)
        )
        entities.extend(exact)

    if not entities and restaurant_name:
        # escaped_name already computed above
        # 2. Partial match
```

- [ ] **Step 3: Move TTL index creation to startup lifespan**

Create `concierge-api-v3/app/core/lifespan.py`:

```python
"""FastAPI lifespan — startup/shutdown hooks."""
from contextlib import asynccontextmanager
from fastapi import FastAPI
import logging

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create indexes and warm caches on startup."""
    from app.core.database import get_database
    db = get_database()

    # Ensure TTL index on capture_sessions (auto-delete after 48h)
    try:
        db["capture_sessions"].create_index(
            "createdAt", expireAfterSeconds=172800, background=True
        )
        logger.info("capture_sessions TTL index ensured")
    except Exception as e:
        logger.warning(f"Failed to create capture_sessions TTL index: {e}")

    yield  # App runs here

    # Shutdown: nothing to clean up
    logger.info("Shutting down")
```

In `_capture_collection` in `capture.py`, remove the index creation (lines 123-127):

Old:
```python
def _capture_collection(db: Database):
    """Ensure the capture_sessions collection has indexes."""
    col = db["capture_sessions"]
    # Ensure TTL index: auto-delete sessions after 48 hours
    try:
        col.create_index("createdAt", expireAfterSeconds=172800, background=True)
    except Exception:
        pass
    return col
```

New:
```python
def _capture_collection(db: Database):
    """Get the capture_sessions collection."""
    return db["capture_sessions"]
```

Update `main.py` to use the lifespan. Read the current FastAPI app creation and add `lifespan=lifespan`:

```python
from app.core.lifespan import lifespan

app = FastAPI(..., lifespan=lifespan)
```

- [ ] **Step 4: Add `.limit()` to `get_entity_curations`**

In `curations.py`, line 221:

```python
    cursor = db.curations.find({
        "entity_id": entity_id,
        "status": {"$ne": "deleted"}
    }, projection).limit(200)
```

- [ ] **Step 5: Fix dead assertion in system test**

In `tests/test_system.py`, line 65-75. The test queries a nonexistent entity which returns 404, so the 500 guard never fires. Replace with an endpoint that actually triggers 500:

```python
    def test_global_exception_handler_does_not_leak_details(self, client):
        """O exception handler global não deve expor detalhes internos no body."""
        # Trigger a guaranteed 500: pass invalid ObjectId to MongoDB
        response = client.get("/api/v3/curations/" + "x" * 100)
        # If the endpoint returns 500 (unhandled), verify no stack trace leaked
        if response.status_code == 500:
            data = response.json()
            assert "Internal server error" in data.get("detail", "")
            assert "Traceback" not in response.text
```

- [ ] **Step 6: Run full test suite**

Run: `pytest concierge-api-v3/tests/ -v --tb=short`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add concierge-api-v3/app/api/capture.py \
        concierge-api-v3/app/api/curations.py \
        concierge-api-v3/app/core/lifespan.py \
        concierge-api-v3/main.py \
        concierge-api-v3/tests/test_system.py
git commit -m "chore: low-severity cleanups from code review

- Remove unused import hashlib (capture.py)
- Remove dead assignment capture_id = None (capture.py)
- Hoist re.escape to avoid double computation (capture.py)
- Move TTL index creation to FastAPI lifespan startup hook
- Add .limit(200) to get_entity_curations (unbounded query)
- Fix dead assertion in test_global_exception_handler test"
```

---

### Task 8: Integration and regression tests

- [ ] **Step 1: Test full user journey — OAuth → Capture → Confirm**

```python
def test_full_capture_journey_with_auth(client, auth_headers):
    """End-to-end: capture audio → get entities → confirm → curation exists."""
    # 1. POST /capture with a test audio payload
    # 2. Verify transcription + entities returned
    # 3. POST /capture/{id}/confirm with entity_id
    # 4. GET /curations/{curation_id} to verify it was created
```

- [ ] **Step 2: Test LM Studio client journey**

```python
def test_openai_client_journey(client, auth_headers):
    """LM Studio flow: models → functions → chat completion."""
    # 1. GET /v1/models → 401 without auth, 200 with auth
    # 2. GET /v1/functions → 401 without auth, 200 with auth
    # 3. POST /v1/chat/completions → 401 without auth, 200 with auth
```

- [ ] **Step 3: Test hybrid search with special characters**

```python
def test_hybrid_search_special_characters(client):
    """Location with regex metacharacters returns correct results."""
    # POST /hybrid-search with location="São Paulo (Centro) $$$"
    # Verify no 500 error, results are scoped correctly
```

- [ ] **Step 4: Run full suite**

Run: `pytest concierge-api-v3/tests/ -v --tb=short`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add concierge-api-v3/tests/
git commit -m "test: add integration tests for user journeys

- Full capture→confirm→curation lifecycle
- LM Studio client model discovery + chat flow
- Hybrid search with special characters in location"
```

---

### Post-Implementation Verification

After all tasks are complete:

1. **Run full test suite:**
```bash
cd concierge-api-v3 && python -m pytest tests/ -v --tb=short
```

2. **Verify all user journeys:**
   - OAuth login with trusted callback URL → token → capture → confirm → curation created
   - LM Studio: models → functions → chat completions (all require auth, consistent 401 without)
   - Hybrid search with special characters in location (no crash, valid results)
   - Bulk import with duplicate keys (createdAt preserved, errors reported)

3. **Manual check:** Start the dev server and hit each changed endpoint to confirm behavior.
