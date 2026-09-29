# Concierge — Project-wide Technical Closeout Plan

**Date:** 2026-09-28  
**Scope:** Collector, Capture, FastAPI, Payload/Admin, MongoDB/Atlas, contracts, workers, security, deployment, UX, observability and documentation.  
**Authority:** current `main` (`10b1fa4b0559b8b0bf8563d6b844fbd157bcb0d4`) plus current reviews/runbooks. Historical plans are evidence, not current truth.

## P0 — before any merge/deploy

- [x] **Do not merge `feat/cms-record-access-mainline-20260928`.** It is an investigation/recovery branch. Compared with current main it is 16 commits ahead but unintentionally removes/reverts large portions of the modern Admin. Salvage only reviewed atomic changes onto a fresh branch from main.
- [x] Reconcile editorial/whole-record work additively against modern `main`; the active closeout branch hardens the existing record stack rather than porting the stale branch.
- [ ] Run `npm run verify` on desktop before reconstructed code is mergeable.
- [ ] Run `npm run verify:full` on the final candidate with disposable `*-test` DBs and replica-set Mongo. Baseline 1 was qualified at its historical snapshot; the current candidate needs a new qualification.
- [ ] Regenerate OpenAPI + `@concierge/fastapi-client`; never copy generated artifacts from an old commit.

## Work possible through repository/GitHub

### Admin/CMS
- [ ] Reconcile the modern main implementation with useful Sep-14 universal-record work; do not replace current Entity/Curation/search/UI wholesale.
- [x] Unknown/legacy keys remain visible; existing whole-record serialization keeps embedding vectors summarized/redacted.
- [x] **Unknown fields default read-only.** Registry metadata is now the edit allowlist; API models also forbid undeclared roots. Tests pin visible-but-read-only behavior.
- [ ] Curation PATCH: mandatory `If-Match`, CAS conflict, live actor authorization, explicit editable paths; block ids, version, timestamps/audit, `catalog_sequence`, embeddings and Entity-derived projections.
- [x] Browser BFF derives actor from live Admin auth; browser never supplies trusted actor identity.
- [x] Preserve route invariant: no native custom `/admin/collections` route was reintroduced; Collection detail remains the Payload collection route.
- [ ] Conflict UX preserves draft on 409/412 and never implies a failed save landed.
- [x] `draftSelectedCount` explicit-operation drift was already fixed on current `main`: apply-draft recomputes the count from draft membership instead of incrementing blindly.
- [ ] Keep Curation history snapshots, Entity Collections join/filter and curator reassignment explicitly deferred until their domain/API support exists.

### FastAPI / contracts
- [ ] Re-review router inventory against `docs/API_ENDPOINT_REVIEW.md`.
- [ ] Whole-record serialization must be total for BSON and redact/summarize binary/vector payloads.
- [x] CMS record mutation models now forbid undeclared roots; system/derived field guards and live actor authorization remain in the existing boundary.
- [ ] Standardize 409/412 semantics across API, generated client, BFF and UI.
- [x] Existing 5xx redaction preserved; closeout adds end-to-end Admin→FastAPI request-ID propagation for authenticated BFF reads/writes.
- [ ] If catalog rows still transport full transcript only to derive `has_transcript`, replace with a safe server-side derived boolean and validate against real Mongo.
- [ ] Instrument exhaustive semantic fallback latency/candidate count while preserving recall correctness.
- [ ] Remove deprecated compatibility code only after caller search proves it dead.

### Collector / Capture
- [x] Replaced destructive `cleanupBrowserData()` policy with explicit obsolete-key migration; future unknown localStorage keys survive and tests pin the behavior.
- [x] Wrapper installation no longer gives up after 30s: fast 100ms boot retry transitions to 5s slow retry; source-level guard covers all compatibility wrappers.
- [x] Added late-install catch-up: if the Curation editor opened before durability wrapper installation, its draft is restored when the wrapper attaches. Desktop Playwright deep-link qualification remains.
- [x] Existing authoring E2E already covers create → save → reload → edit → unsaved draft restore → save → Entity link; final desktop batch must rerun it.
- [ ] Pin repeated `ids` encoding/chunk behavior with tests, including comma-containing Entity IDs.
- [ ] Audit/remove active deprecated API-key/sync/card compatibility paths only with caller evidence.
- [ ] Retire legacy CSS incrementally with rendered coverage.
- [ ] Resolve semantic brand token divergence (`--cms-olive-500` vs `--color-primary`).
- [ ] Keep real audio/photo capture as device qualification; add deterministic lifecycle/error tests where possible.

### Security
- [ ] Inventory OAuth, refresh, cookie/Bearer, ops-login, CMS handoff, consumer credentials and service-key trust boundaries.
- [ ] Confirm live-role revalidation on every paid/write/admin boundary.
- [ ] Keep `OPS_LOGIN_*` fail-closed; disable/rotate when qualification no longer needs it.
- [x] Added tracked secret-pattern audit as the first `npm run verify` step, with tests and no matched-value echo.
- [ ] Audit exact CORS/CSRF/callback origins and CSP; static-site `frame-ancestors` remains a hosting-header task.
- [x] Reviewed provider rate identity; authenticated Places and LLM Gateway routes now use the existing stable authenticated bucket. Anonymous `<img>` photo proxy intentionally remains IP-keyed.
- [x] Reviewed SSRF defenses: scheme/userinfo/DNS/IP/private-network/redirect hooks and byte/time bounds already exist with tests. DNS-rebinding/TOCTOU remains a documented residual risk; no transport rewrite without runtime qualification.
- [ ] Verify audit events for CMS writes, Collections lifecycle, credentials and destructive/operator actions.

### Database / data model
- [x] Current API already pins every allowlisted Curation sort to a declared index with a regression test; live index existence remains a desktop/Atlas verification.
- [ ] Verify Payload indexes remain migration-owned (`autoIndex=false`) and migrations match live collections.
- [ ] Verify `catalog_sequence` integrity and counter position.
- [ ] Audit cross-DB ownership: operational Entity/Curation in FastAPI DB; Collection/publication/CMS state in CMS DB.
- [ ] Document packed Binary float32 vectors and threshold for replacing exhaustive fallback.
- [ ] Prepare dry-run reports for `entity_curation_test_*` and dangling/orphan relations; deletion requires backup + operator approval.
- [ ] Review TTL/retention for capture sessions, manifests, exports, sessions, audit and failed jobs.

### UX / accessibility
- [ ] Static a11y pass: labels, keyboard, focus traps/restoration, modal semantics, alerts/status and contrast.
- [ ] Preserve measured responsive breakpoints and zero-horizontal-overflow Admin behavior.
- [ ] Visually qualify a real Entity thumbnail.
- [ ] Distinguish authorization/database/feature-disabled/no-results states.
- [ ] Review iOS Safari auth, IndexedDB, offline restore, touch and media paths separately.

### Observability / operations
- [ ] Health surfaces distinguish API DB, CMS DB, worker/queue, storage and feature readiness without secrets.
- [x] Admin requests now normalize one safe request ID, use it for live auth introspection, and propagate it through record/catalog/media BFF calls to FastAPI. Worker-only flows continue with their own job/audit IDs.
- [ ] Metrics: image states, catalog latency, semantic fallback, queue age, job retries/failures, publish duration, memory.
- [ ] Update stale topology docs: jobs runner is in-process with Next by default; local gate is quality authority.
- [ ] Evaluate Render build filters so docs-only changes do not restart the fused service unnecessarily.

## Implemented during this closeout branch

- CMS policy hardened to **universal read, curated write**; generated OpenAPI/client regeneration is intentionally deferred to the desktop gate instead of hand-editing generated files.
- Collector startup localStorage cleanup is migration-driven rather than destructive-by-default.
- Authoring wrappers remain recoverable after cold starts longer than 30 seconds, and early-opened Curation editors get late draft restoration.
- Authenticated Google Places/LLM Gateway provider quotas use stable authenticated identity; public image proxy remains IP-keyed by design.
- The local release gate now scans tracked files for live-shaped secrets before other checks.
- Admin request correlation now survives the Payload→FastAPI hop across auth, record/editorial, Explorer, dashboard, Collection summary, curator and media paths.

**Not executed here:** none of these changes are being claimed green. Contract generation, typecheck, unit/integration tests, browser E2E and runtime validation are part of the desktop batch below.

## Desktop/runtime qualification batch

### Deterministic local gates
1. Clean checkout of final candidate.
2. Install JS/Python dependencies.
3. `npm run verify`.
4. Start disposable replica-set Mongo + both `*-test` DBs.
5. Start FastAPI + Admin/in-process worker.
6. `npm run verify:full`.
7. Run opt-in `CMS_E2E_BULK=1`, `CMS_E2E_CREDENTIALS=1`, `COLLECTOR_E2E=1`.
8. Run `npm run test:e2e:authoring`.
9. Regenerate contracts/types/import map and require clean git diff.
10. Re-run the known `security-config.test.ts` flake repeatedly; fix only if diagnosed.

### Browser/device
- Fresh-profile Collector; offline/online, IndexedDB degraded mode, draft interruption/restore and sync conflict.
- iOS Safari OAuth/refresh/logout + service-worker upgrade.
- Real microphone + interruption/resume + PendingAudioManager + transcription.
- Real phone camera/file capture.
- Admin 390/768/1024/1440/1920, keyboard-only, search, record edit/conflict.
- Real served Entity image.

### Mongo/Atlas operator work
- Audit dedicated/scoped DB users and network access.
- Identity duplicate audit + legacy Google refresh-token purge dry-run.
- Index migration dry-run then apply only when clean.
- Orphan/test-junk report → backup → explicit cleanup approval.
- CMS backup→restore smoke to `*-restore-test`.
- Verify storage headroom.

### Secrets/hosting operator work
- **Rotate the previously exposed Google OAuth client credentials/secret.** Update secret stores; never commit replacements.
- Verify production env/feature flags by name/presence without printing values.
- Configure/verify static-site `frame-ancestors` and security headers.
- Decide whether production ops-login remains enabled; remove its key/subject if no longer required.

### Production/load
- Controlled simultaneous Collector media + Admin SSR + worker load. The historical 512 MB service had proven OOMs; post-runner-consolidation headroom still needs measurement.
- If insufficient, choose Render 2 GB tier vs topology reduction from measurements.
- Read-only production smoke + auth/CMS handoff smoke.
- Verify both static and fused services actually serve the candidate SHA.
- Collections rollout only after backup/restore, staging evidence and the 20-criterion acceptance gate.

## Deferred product decisions
- Synthetic knowledge as first-class Curation vs enrichment candidate.
- Native vector/index representation.
- Framework rewrite of vanilla Collector.
- Curation field-level historical snapshots.
- Curator reassignment directory/UX.
- Entity Collections join/filter.
- GitHub Actions restoration; issue #12 can remain open while local gates are authoritative.

## Definition of done
- Recovery branch never merged wholesale.
- Standard + full + high-value opt-in E2Es green from clean checkout.
- Generated contracts/types reproducible and clean.
- No unresolved P0/P1 security/data-integrity issue.
- Destructive changes have dry-run, backup and explicit operator approval.
- External secrets/headers/Atlas tasks completed or recorded as blockers.
- Browser/device qualification evidenced.
- Controlled load proves acceptable memory headroom or triggers planned capacity/topology change.
- Current docs describe current topology and date historical qualification claims.
