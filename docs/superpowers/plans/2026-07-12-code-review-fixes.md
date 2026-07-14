# Code Review — 2026-07-12 (max effort)

**Scope:** 6 commits, 7 files. Security fixes + error handling improvements.
**Review mode:** max (10 angles × up to 8 candidates → 1-vote verify → sweep)

---

## Findings (ranked by severity)

### CRITICAL — User Journey Breaking

#### 1. Regex injection in `hybrid_search` — `request.location` unescaped in `$regex`
- **File:** `concierge-api-v3/app/api/curations.py:592-595`
- **Summary:** `request.location` is interpolated directly into MongoDB `$regex` without `re.escape()`. This exact bug was fixed in `_match_entities` (capture.py) and `search_curations` (curations.py) in this same PR, but `hybrid_search` was overlooked.
- **Failure scenario:** User sends `POST /hybrid-search` with `{"location": ".*"}` → matches all cities indiscriminately. `{"location": "(.){1,100}(.){1,100}"}` → catastrophic backtracking (ReDoS), MongoDB CPU spike.
- **User journey:** Hybrid search with location filter returns incorrect results or hangs.

#### 2. `/v1/models` remains public while `/v1/chat/completions` requires auth — broken LM Studio UX
- **File:** `concierge-api-v3/app/api/openai_compat.py:322`
- **Summary:** Auth added to `/v1/functions` (line 342) and `/v1/chat/completions` (line 359) but NOT `/v1/models` (line 322). LM Studio flow: discover model (200 OK) → call chat completions → 401 with no auth instructions.
- **Failure scenario:** Client discovers model successfully, then gets 401 on the very next call. Confusing UX.

### HIGH — Correctness Bugs

#### 3. Cache-before-persist ordering in `capture()` — stale cache on MongoDB failure
- **File:** `concierge-api-v3/app/api/capture.py:396-426`
- **Summary:** In-memory cache set at line 396, MongoDB write at line 420. If MongoDB fails (raises 503), stale cache entry survives. On retry, line 364 hits cache → 200, but session not persisted. Confirm endpoint can't find it.
- **Failure scenario:** MongoDB down → 503 → retry → 200 (cache hit) → confirm → 404 "not found".

#### 4. Confirm endpoint `find_one` not wrapped — cache fallback unreachable
- **File:** `concierge-api-v3/app/api/capture.py:465`
- **Summary:** `col.find_one()` not in try-except. When MongoDB is down, raises `ServerSelectionTimeoutError` → 500. The cache fallback at lines 468-470 is dead code during outages.

#### 5. Bare `except:` in `verify_auth` — silently swallows RuntimeError
- **File:** `concierge-api-v3/app/api/openai_compat.py:59` (also curations.py:66)
- **Summary:** `except: pass` catches `RuntimeError` from `get_api_secret_key()`. API key auth silently skipped → every request hits JWT check then gets misleading 401 "Missing auth token" (actual problem: server misconfiguration).

### MEDIUM — Robustness

#### 6. Hardcoded `trusted_origins` — new frontends require code deploy
- **File:** `concierge-api-v3/app/api/auth.py:243-251`
- **Summary:** Adding a new frontend URL requires source code edit + deploy. Should be a configurable list in settings. Fallback on untrusted URL silently redirects to default instead of returning 400.

#### 7. `settings.frontend_url_production` could be `None` in `trusted_origins`
- **File:** `concierge-api-v3/app/api/auth.py:244`
- **Summary:** If both frontend_url and frontend_url_production are None, fallback sets `frontend_redirect_url = None` → broken redirect.

#### 8. `verify_auth` duplicated 5× across codebase
- **Files:** `openai_compat.py:49`, `capture.py:37`, `curations.py:55`, `ai.py:24`, `entities.py:26`
- **Summary:** Five copies with slight drift (role key missing in 3, bare except in 4). This PR adds the 5th copy.

### LOW — Quality & Efficiency

#### 9. `re.escape()` called twice for same input
- **File:** `concierge-api-v3/app/api/capture.py:199,210`

#### 10. Dead assignment `capture_id = None`
- **File:** `concierge-api-v3/app/api/capture.py:396`

#### 11. Unused import `hashlib`
- **File:** `concierge-api-v3/app/api/capture.py:9`

#### 12. TTL index created on every request
- **File:** `concierge-api-v3/app/api/capture.py:123`

#### 13. Inline import `ALGORITHM`
- **File:** `concierge-api-v3/app/api/openai_compat.py:63`

#### 14. `async def verify_auth` blocks event loop
- **File:** `concierge-api-v3/app/api/openai_compat.py:49`

#### 15. No `.limit()` on `get_entity_curations`
- **File:** `concierge-api-v3/app/api/curations.py:221`

---

## User Journey Assessment

| Journey | Status | Risk |
|---------|--------|------|
| Google OAuth → Capture → Confirm → Curation | ⚠️ | New frontend URLs blocked by hardcoded allowlist (#6). MongoDB outage changes graceful degradation to hard 503 (#3, #4). |
| LM Studio → discover model → chat → function results | ❌ | Model discovery (200) works; chat/functions (401) breaks (#2). |
| API key → create curation → search | ✅ | 500→409 semantic improvement; fallback limits prevent OOM. |
| Hybrid search with location filter | ❌ | Regex injection returns incorrect results or hangs (#1). |
| Curator bulk import | ✅ | Correctly handles duplicates via upsert. |
