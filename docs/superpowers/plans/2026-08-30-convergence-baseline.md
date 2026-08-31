# Architecture Baseline 1 — Implementation Plan

> Execute on `chore/local-release-gate`. Preserve current Aug 29–30 Curation/Capture semantics; port behavior and tests from PR #4, not stale history.

## Task 1 — Converge authentication/session hardening

- Add regression tests for live RBAC, atomic refresh rotation, OAuth state binding, cross-site logout/fallback, stable paid-provider rate buckets and credential logging.
- Add server-backed OAuth state service and indexes.
- Make refresh rotation a single-use atomic consume at the session boundary.
- Revalidate live user authorization/role in `require_role`.
- Stop persisting Google refresh credentials; add dry-run audit/purge/index tools.
- Harden frontend refresh/logout/retry behavior.

## Task 2 — Converge paid-provider/error boundaries

- Require live authorization before paid AI/Places/semantic work.
- Bound restaurant-name extraction request size and rate.
- Keep rate identity stable across token rotation/transports.
- Redact unexpected provider/database details, including partial-success Places payloads.
- Add legacy no-version Curation CAS protection.

## Task 3 — Preserve Capture semantics while adding paid-work durability

- Add durable Capture processing claim/lease/heartbeat service.
- Claim before Whisper/GPT/Places calls and fail duplicate processing fast.
- Move blocking provider calls off the event loop.
- Route Entity/Curation confirmation writes through canonical services.
- Preserve current human Curation semantics: `curator_type=human`, workflow `status=draft`, linkage by `entity_id`, Capture `source_id` provenance.
- Add rate limits and lease/write-boundary regressions.

## Task 4 — Remove semantic-search recency bias

- Add a regression where the best semantic match is older than the previous fallback window.
- Keep Atlas `$vectorSearch` as configured fast path.
- Replace recency-bounded fallback with exhaustive eligible-candidate scanning.
- Keep result ranking bounded-memory or bounded-result and expose fallback diagnostics.

## Task 5 — Strengthen full-stack qualification

- Add an explicit local-stack preflight to `verify:full` where useful.
- Add worker/publish recovery/lease regression coverage using existing Admin integration harnesses.
- Document expected stack, seed assumptions and evidence to capture.

## Task 6 — Introduce one Curation authoring entry controller

- Characterize existing edit wrapper order in tests.
- Expose explicit durability/ownership collaborators.
- Introduce `CurationAuthoringController` as the single outer `editCuration` interceptor.
- Preserve legacy UI manager API and offline behavior.
- Remove the double-wrapper installation-order dependency.

## Task 7 — Establish repository baseline documentation

- Rewrite root README for Collector + FastAPI + Payload/Admin + workers + contracts + Collections/distribution.
- Add Architecture Baseline 1 document with component ownership and invariants.
- Record synthetic-Curation modeling as deferred.
- Update PR #6 description to the convergence scope.
- Close stale PR #3/#4 only after supersession is documented.

## Task 8 — Qualification handoff

The branch remains draft. Final operator runs from a complete checkout:

```bash
npm ci --legacy-peer-deps
python3 -m pip install -r concierge-api-v3/requirements.txt -r concierge-api-v3/requirements-dev.txt
npm run verify
npm run verify:full
```

Then run the documented user-identity audit/purge/index migration dry runs and applicable production smoke checks. Any failure is fixed on this branch before merge/tagging Architecture Baseline 1.
