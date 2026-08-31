# Collector Offline-First Part 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining offline-first authoring contract: local-first Entity linking, local ownership enforcement, resumable capture processing after reconnect, semantic-safe sync, and AIRPLANE acceptance coverage.

**Architecture:** Keep IndexedDB as the authoritative working state until processing and synchronization succeed. Add focused policy/services instead of embedding more network assumptions in UI modules: local Entity search selects already-cached Entities without API calls; ownership policy decides edit/takeover/create-own before entering a mutable editor; an OfflineCaptureProcessor consumes persisted raw captures after reconnect and materializes transcripts directly into local Curations. SyncManager only transports durable state and never derives linkage, authorship, or audio provenance.

**Tech Stack:** Browser JavaScript, Dexie/IndexedDB, Service Worker/Cache Storage, Vitest + fake-indexeddb/jsdom, existing ApiService/SourceUtils/SyncManagerV3.

**Spec:** `docs/superpowers/specs/2026-08-30-collector-offline-first-durability-design.md`

## Global Constraints

- Local durable state is authoritative until synchronization succeeds.
- Raw voice capture is authoritative until a durable transcript representation exists.
- `entity_id` is the only linkage truth; `status` is workflow only.
- `curator_type` + curator ownership decide editability; another human's Curation is never overwritten.
- Offline authoring must not require Google Places, AI, or server availability.
- Reconnect processing must be restart-safe and idempotent.
- Quota pressure may block new large captures but must never delete required content.
- No merge until verification evidence exists.

---

### Task 1: Local-first Entity selection

**Files:**
- Create: `scripts/services/localEntitySearch.js`
- Create: `scripts/modules/offlineLinkingModule.js`
- Test: `tests/test_offlineEntityLinking.test.js`

**Interfaces:**
- `LocalEntitySearch.search(query, filters) -> Promise<Entity[]>`
- `OfflineLinkingModule.install()` patches FindEntityModal selection mode only.
- Local results carry `__localEntity: true`; selecting one calls the existing `onEntitySelected(entity)` without Google import.

- [ ] Write failing tests proving cached Entity search works with no ApiService and that selection of a local Entity never calls Places/createEntity.
- [ ] Implement local search over `DataStore.db.entities` with normalized name/city/type matching and bounded results.
- [ ] Integrate FindEntityModal selection mode: show local matches first; if offline, stop there with an explicit local-only state; if online, merge remote results after local results without duplicates.
- [ ] Preserve current link persistence path (`uiManager.linkReviewToEntity`) so linkage remains `entity_id` + local pending sync.
- [ ] Run `npm run test:collector -- tests/test_offlineEntityLinking.test.js` and commit.

### Task 2: Ownership guard before mutable editing

**Files:**
- Create: `scripts/services/curationOwnershipPolicy.js`
- Modify: `scripts/modules/offlineDurabilityModule.js`
- Test: `tests/test_curationOwnershipOffline.test.js`

**Interfaces:**
- `CurationOwnershipPolicy.decide(curation, editorId) -> { action: 'edit'|'takeover'|'create-own', ownerId }`
- Human same-owner -> edit.
- Synthetic -> takeover.
- Human different-owner -> create-own; mutable edit is blocked locally before checkout/draft creation.

- [ ] Write failing pure-policy tests for same human, other human, synthetic, and legacy human fallback.
- [ ] Add an editor guard around `uiManager.editCuration` before the existing draft-restore wrapper.
- [ ] For `create-own`, resolve linked Entity locally and offer/create a new blank Curation authoring session linked to that Entity; never mutate the other curator's record.
- [ ] Keep direct/deep-link entry protected by the same guard.
- [ ] Run targeted tests and commit.

### Task 3: Stable source identity + reconnect capture processor

**Files:**
- Create: `scripts/services/offlineCaptureProcessor.js`
- Modify: `scripts/modules/pendingAudioManager.js`
- Modify: `scripts/modules/offlineDurabilityModule.js`
- Test: `tests/test_offlineCaptureProcessor.test.js`

**Interfaces:**
- Pending audio keeps Dexie numeric `id` as local blob locator and stable `sourceId` as provenance identity.
- `OfflineCaptureProcessor.processPending()` processes eligible rows serially.
- Eligible: `pending|failed|retrying|processing` with raw blob and `disposable !== true`.
- Processor calls `ApiService.transcribeAudio`, materializes only that capture's text under `sources.audio[source_id=sourceId]`, updates aggregate Curation transcript, persists locally, then marks raw row `disposable=true`.

- [ ] Write failing tests for stable source id, crash/restart from `processing`, no duplicate source on replay, and saved-offline Curation gaining transcript without editor DOM.
- [ ] Add PendingAudioManager helpers `getBySourceId`, `claimForProcessing`, `markProcessingFailed`, and `markTranscriptPersisted` using stable `sourceId` while retaining numeric blob id.
- [ ] Implement processor that first resolves `curationId`; if no saved Curation exists yet, keep transcript on the draft and retain raw until that text is durably persisted.
- [ ] For multiple recordings, append source-local text independently; aggregate Curation transcript is derived without writing A+B into source B.
- [ ] Install processor at startup and on `online`; one in-flight run at a time.
- [ ] Replace timer-only retry dependence for offline/restart recovery; timer retry may remain as an optimization but the durable processor is authoritative.
- [ ] Run targeted tests and commit.

### Task 4: Sync is transport, not semantic inference

**Files:**
- Modify: `scripts/sync/syncManagerV3.js`
- Test: `tests/test_syncSemanticOfflineContract.test.js`

**Interfaces:**
- `cleanCurationForSync` preserves workflow status (`linked` legacy normalizes to `draft`) and does not derive status from `entity_id`.
- `sanitizeCurationPatchPayload` never injects `linked`.
- Transcript alone never creates audio provenance.
- Existing explicit `sources` is preserved.

- [ ] Write failing tests for linked Entity + draft status, transcript-only web/manual content, and explicit audio source preservation.
- [ ] Remove `entity_id -> status=linked` normalization from create and patch payload paths.
- [ ] Remove transcript->audio inference from sync fallback; source creation must require explicit provenance.
- [ ] Run targeted tests and commit.

### Task 5: AIRPLANE acceptance harness

**Files:**
- Create: `tests/test_airplaneOfflineAuthoring.test.js`
- Modify as required only when a failing acceptance test exposes a contract violation.

**Acceptance scenarios:**
- AIRPLANE-01: create 50 offline Curations with raw voice captures; restart state retains all 50 Curations/captures.
- AIRPLANE-02: edit multiple existing Curations offline; last flushed text/notes survive manager recreation.
- AIRPLANE-03: Save with unprocessed audio/photo retains raw material.
- AIRPLANE-04: reconnect processor interrupted after item N resumes without duplicate sources and without losing N/N+1.
- AIRPLANE-05: critical quota blocks new media but leaves existing rows unchanged.
- AIRPLANE-06: after transcript materialization, raw audio becomes disposable while Curation/source transcript remains.

- [ ] Build a fake-indexeddb integration harness using the production managers/services.
- [ ] Add AIRPLANE-01..06 as executable tests.
- [ ] Fix only contract failures exposed by these tests.
- [ ] Run targeted AIRPLANE suite and commit.

### Task 6: Verification and PR gate

**Files:**
- Update: `docs/superpowers/plans/2026-08-30-collector-offline-first-part-2.md` checkboxes/status only after evidence.
- Update PR #5 description with offline-first behavior and verification status.

- [ ] Run `npm run build:collector:check`.
- [ ] Run `npm run lint:collector`.
- [ ] Run `npm run test:collector`.
- [ ] Run relevant API tests if any server contract changes were required.
- [ ] Inspect GitHub Actions for the final head.
- [ ] Do not merge if any required verification is unavailable or failing; report exact blocker.
