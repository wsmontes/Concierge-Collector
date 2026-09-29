# Concierge — Project-wide Technical Closeout Plan

**Date:** 2026-09-28  
**Scope:** Collector, Capture, FastAPI, Payload/Admin, MongoDB/Atlas, contracts, workers, security, deployment, UX, observability and documentation.  
**Authority:** current `main` (`10b1fa4b0559b8b0bf8563d6b844fbd157bcb0d4`) plus current reviews/runbooks. Historical plans are evidence, not current truth.

## P0 — before any merge/deploy

- [ ] **Do not merge `feat/cms-record-access-mainline-20260928`.** It is an investigation/recovery branch. Compared with current main it is 16 commits ahead but unintentionally removes/reverts large portions of the modern Admin. Salvage only reviewed atomic changes onto a fresh branch from main.
- [ ] Rebuild editorial/whole-record work additively on this closeout branch.
- [ ] Run `npm run verify` on desktop before reconstructed code is mergeable.
- [ ] Run `npm run verify:full` on the final candidate with disposable `*-test` DBs and replica-set Mongo. Baseline 1 was qualified at its historical snapshot; the current candidate needs a new qualification.
- [ ] Regenerate OpenAPI + `@concierge/fastapi-client`; never copy generated artifacts from an old commit.

## Work possible through repository/GitHub

### Admin/CMS
- [ ] Reconcile the modern main implementation with useful Sep-14 universal-record work; do not replace current Entity/Curation/search/UI wholesale.
- [ ] Unknown/legacy keys remain visible; embedding vectors never leave the API raw.
- [ ] **Unknown fields default read-only.** Registry metadata is the edit allowlist; visibility does not imply editability.
- [ ] Curation PATCH: mandatory `If-Match`, CAS conflict, live actor authorization, explicit editable paths; block ids, version, timestamps/audit, `catalog_sequence`, embeddings and Entity-derived projections.
- [ ] Browser BFF derives actor from live Admin auth; browser never supplies trusted actor identity.
- [ ] Preserve route invariant: do not resurrect native `/admin/collections`; Collection detail remains the Payload collection route.
- [ ] Conflict UX preserves draft on 409/412 and never implies a failed save landed.
- [ ] Fix known `draftSelectedCount` explicit-operation drift using draft-delta semantics.
- [ ] Keep Curation history snapshots, Entity Collections join/filter and curator reassignment explicitly deferred until their domain/API support exists.

### FastAPI / contracts
- [ ] Re-review router inventory against `docs/API_ENDPOINT_REVIEW.md`.
- [ ] Whole-record serialization must be total for BSON and redact/summarize binary/vector payloads.
- [ ] Every CMS mutation uses a server-side allowlist and live role; arbitrary unknown dotted roots are rejected.
- [ ] Standardize 409/412 semantics across API, generated client, BFF and UI.
- [ ] Preserve redacted 5xx responses while retaining actionable internal codes/request IDs.
- [ ] If catalog rows still transport full transcript only to derive `has_transcript`, replace with a safe server-side derived boolean and validate against real Mongo.
- [ ] Instrument exhaustive semantic fallback latency/candidate count while preserving recall correctness.
- [ ] Remove deprecated compatibility code only after caller search proves it dead.

### Collector / Capture
- [ ] Replace destructive `cleanupBrowserData()` “everything not preserved” policy with explicit obsolete-key migrations + tests.
- [ ] Replace 30-second wrapper installation windows with lifecycle/event-driven or durable slow retry.
- [ ] Fix cold-boot deep-link draft restore for `#/curation/<id>/edit`.
- [ ] Keep authoring E2E contract: create → save → reload → edit → unsaved draft restore → save → Entity link.
- [ ] Pin repeated `ids` encoding/chunk behavior with tests, including comma-containing Entity IDs.
- [ ] Audit/remove active deprecated API-key/sync/card compatibility paths only with caller evidence.
- [ ] Retire legacy CSS incrementally with rendered coverage.
- [ ] Resolve semantic brand token divergence (`--cms-olive-500` vs `--color-primary`).
- [ ] Keep real audio/photo capture as device qualification; add deterministic lifecycle/error tests where possible.

### Security
- [ ] Inventory OAuth, refresh, cookie/Bearer, ops-login, CMS handoff, consumer credentials and service-key trust boundaries.
- [ ] Confirm live-role revalidation on every paid/write/admin boundary.
- [ ] Keep `OPS_LOGIN_*` fail-closed; disable/rotate when qualification no longer needs it.
- [ ] Add a secret-pattern audit to the local gate; no GitHub Actions dependency.
- [ ] Audit exact CORS/CSRF/callback origins and CSP; static-site `frame-ancestors` remains a hosting-header task.
- [ ] Review rate limits and stable identity for AI/Places/capture/auth/media.
- [ ] Review SSRF defenses for media/OG fetches: scheme, DNS/IP, redirects, private networks, byte/time limits.
- [ ] Verify audit events for CMS writes, Collections lifecycle, credentials and destructive/operator actions.

### Database / data model
- [ ] Tie every allowed catalog sort to a declared index.
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
- [ ] Correlate request IDs through nginx → API/Admin → jobs/audit where applicable.
- [ ] Metrics: image states, catalog latency, semantic fallback, queue age, job retries/failures, publish duration, memory.
- [ ] Update stale topology docs: jobs runner is in-process with Next by default; local gate is quality authority.
- [ ] Evaluate Render build filters so docs-only changes do not restart the fused service unnecessarily.

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
