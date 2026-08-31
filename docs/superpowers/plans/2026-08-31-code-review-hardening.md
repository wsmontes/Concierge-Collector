# Code Review Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the integration races and durability gaps found in the 100-commit review while preserving the Collector's current offline-first product behavior.

**Architecture:** Keep the existing semantic/domain model, but strengthen the temporal boundaries around it: content-addressed Service Worker generations, one outer save coordinator per tab, persistent IndexedDB media leases across tabs, and machine-readable authorization classification. Smaller durability fixes are implemented after the four release blockers.

**Tech Stack:** Browser JavaScript, Dexie/IndexedDB, Service Worker Cache Storage, Node 22 build scripts, Vitest/jsdom/fake-indexeddb, FastAPI/Python tests.

**Spec:** `docs/superpowers/specs/2026-08-31-code-review-hardening-design.md`

## Global Constraints

- Do not add GitHub Actions or any paid CI dependency.
- Preserve raw audio until durable textual provenance has been committed.
- Canonical durable transcript text remains English; spoken-language provenance is separate metadata.
- Linkage truth remains `entity_id`; workflow status must not manufacture linkage.
- Server authorization remains authoritative; the browser may only classify machine-readable server errors.
- Existing offline drafts/media must never be deleted as a recovery shortcut.

---

### Task 1: Make Service Worker generations content-addressed

**Files:**
- Modify: `scripts/build/cacheBustLocalAssets.mjs`
- Modify: `scripts/build-collector.mjs`
- Modify: `service-worker.js`
- Modify: `scripts/modules/offlinePart2Bootstrap.js`
- Modify: `scripts/storage/storageDurability.js`
- Test: `tests/test_collectorBuildCacheBusting.test.js`
- Test: `tests/test_offlineAppShell.test.js`

**Interfaces:**
- Produces: `stampDynamicLocalAssetVersions(directory, htmlOrJsPath)` or equivalent build helper that rewrites dynamic same-origin script URLs.
- Produces: deterministic `__COLLECTOR_SHELL_VERSION__` replacement in built `service-worker.js`.
- Service Worker cache lookup is exact for versioned local assets.

- [ ] **Step 1: Write failing tests** proving dynamic Part 2 URLs receive file-content hashes, a changed asset changes the built SW cache generation, and `cacheFirst` no longer uses `ignoreSearch: true` as a version fallback.
- [ ] **Step 2: Run targeted Vitest tests**: `npm test -- tests/test_collectorBuildCacheBusting.test.js tests/test_offlineAppShell.test.js`. Expected: new tests fail against the current implementation.
- [ ] **Step 3: Implement build stamping** so both `index.html` and dynamic local module URLs are content-addressed and the built SW receives a deterministic manifest-derived generation.
- [ ] **Step 4: Remove query-insensitive local cache fallback** from `service-worker.js`; keep exact cache-first and network fallback.
- [ ] **Step 5: Re-run targeted tests and `npm run build:collector:check`**. Expected: pass.
- [ ] **Step 6: Commit** with `fix: make offline shell content addressed`.

### Task 2: Serialize the complete legacy save chain

**Files:**
- Create: `scripts/services/offlineSaveCoordinator.js`
- Modify: `scripts/modules/offlinePart2Bootstrap.js`
- Test: `tests/test_offlineSaveCoordinator.test.js`
- Test: `tests/test_offlinePart2ProductionWiring.test.js`

**Interfaces:**
- `OfflineSaveCoordinator.runExclusive(fn: () => Promise<T>): Promise<T>` serializes operations FIFO.
- The runtime instance installs one outer wrapper around the fully composed `conceptModule.saveRestaurant` chain.

- [ ] **Step 1: Write failing tests** that launch two controlled concurrent saves and assert the second does not enter the wrapped save chain until the first resolves; assert rejection of the first still releases the queue.
- [ ] **Step 2: Run** `npm test -- tests/test_offlineSaveCoordinator.test.js tests/test_offlinePart2ProductionWiring.test.js`. Expected: fail because the coordinator does not exist.
- [ ] **Step 3: Implement the minimal FIFO coordinator** and load it last in Offline Part 2 so it is the outermost save boundary.
- [ ] **Step 4: Re-run tests** and the save/source suites: `npm test -- tests/test_offlineSaveCoordinator.test.js tests/test_curationSaveContract.test.js tests/test_offlineSourceIdentityBridge.test.js tests/test_offlineCaptureProcessor.test.js`.
- [ ] **Step 5: Commit** with `fix: serialize offline curation saves`.

### Task 3: Add atomic multi-tab audio leases

**Files:**
- Modify: `scripts/modules/pendingAudioManager.js`
- Modify: `scripts/services/offlineCaptureProcessor.js`
- Modify: `scripts/storage/databaseManager.js` only if schema/index support is required
- Test: `tests/test_pendingAudioDurability.test.js`
- Test: `tests/test_offlineCaptureProcessor.test.js`

**Interfaces:**
- `claimForProcessing(idOrSourceId, options?) -> claimedRow|null` returns a `processingLeaseToken` on success.
- `storeTranscript(..., metadata)` and `markProcessingFailed(..., error, options?)` reject stale lease tokens when one is supplied.
- Lease expiry is reclaimable.

- [ ] **Step 1: Write failing shared-IndexedDB tests** with two manager/processor instances; only one claim may succeed before lease expiry and stale completion must fail.
- [ ] **Step 2: Run targeted tests** and confirm the current read-then-update claim allows both workers.
- [ ] **Step 3: Implement atomic claim in a Dexie RW transaction** with token, owner, and expiry; propagate token through the capture processor.
- [ ] **Step 4: Re-run audio durability/capture tests**.
- [ ] **Step 5: Commit** with `fix: lease pending audio across tabs`.

### Task 4: Add transactional multi-tab photo leases

**Files:**
- Modify: `scripts/services/offlinePhotoProcessor.js`
- Test: `tests/test_offlinePhotoProcessor.test.js`

**Interfaces:**
- Per-source `photoProcessing[sourceId]` state carries lease token/owner/expiry.
- `_updatePhotoProcessing` mutates the latest persisted draft inside a Dexie transaction.

- [ ] **Step 1: Write failing tests** for two processor instances sharing one DB: a source can be claimed once, and independent source updates cannot overwrite one another.
- [ ] **Step 2: Run** `npm test -- tests/test_offlinePhotoProcessor.test.js`. Expected: fail on duplicate claim/lost-update behavior.
- [ ] **Step 3: Implement transactional state mutation and leases**, including expired-lease recovery and token-checked completion.
- [ ] **Step 4: Re-run photo tests**.
- [ ] **Step 5: Commit** with `fix: lease offline photo processing across tabs`.

### Task 5: Classify ownership failures by server code, not HTTP 403

**Files:**
- Modify: `scripts/services/syncOwnershipFailureGuard.js`
- Test: `tests/test_syncOwnershipFailureGuard.test.js`

**Interfaces:**
- `isOwnershipFailure(value)` returns true only for explicit ownership-domain codes/details.

- [ ] **Step 1: Write failing tests**: `{status:403}` and `{status:403, detail:'Forbidden'}` are false; `{status:403, code:'curation_owner_mismatch'}` is true.
- [ ] **Step 2: Run** `npm test -- tests/test_syncOwnershipFailureGuard.test.js`. Expected: generic 403 test fails.
- [ ] **Step 3: Implement strict code extraction** across common payload shapes (`code`, `errorCode`, nested `detail.code`).
- [ ] **Step 4: Re-run sync guard and sync semantic suites**.
- [ ] **Step 5: Commit** with `fix: require ownership error codes`.

### Task 6: Preserve spoken language separately from canonical language

**Files:**
- Modify: `scripts/modules/pendingAudioManager.js`
- Modify: `scripts/services/offlineCaptureProcessor.js`
- Test: `tests/test_voiceTranscriptSourceShape.test.js`
- Test: `tests/test_pendingAudioDurability.test.js`

**Interfaces:**
- Pending audio stores `sourceLanguage` from capture options.
- Canonical transcript metadata stores `language: 'en'` and retains `source_language` from the pending row.

- [ ] **Step 1: Write failing test** capturing `pt-BR`, storing translated English text, and asserting final source has `language='en'` plus `source_language='pt-BR'`.
- [ ] **Step 2: Run targeted tests** and confirm source language is currently lost.
- [ ] **Step 3: Implement separate fields** without overloading `language`.
- [ ] **Step 4: Re-run tests**.
- [ ] **Step 5: Commit** with `fix: preserve spoken audio language provenance`.

### Task 7: Make photo acceptance and quota preflight durable

**Files:**
- Modify: `scripts/services/offlinePhotoProcessor.js`
- Modify: `scripts/storage/storageDurability.js`
- Test: `tests/test_offlinePhotoProcessor.test.js`
- Test: `tests/test_storageDurability.test.js`

**Interfaces:**
- Photo acceptance wrapper awaits `autoSaveDraft`/flush before reporting success from the durable wrapper path.
- `assertCaptureCapacity(kind, expectedBytes=0)` checks current free bytes against expected bytes plus a reserve.

- [ ] **Step 1: Write failing tests** for autosave rejection propagation and expected-byte quota rejection below the percentage threshold.
- [ ] **Step 2: Run targeted tests**.
- [ ] **Step 3: Implement awaited photo durability and byte-aware quota policy** while preserving the existing percentage critical threshold.
- [ ] **Step 4: Re-run tests**.
- [ ] **Step 5: Commit** with `fix: harden media capture durability`.

### Task 8: Correct Collections terminal-status messaging

**Files:**
- Modify: `scripts/ui/collectionsModal.js`
- Modify: `tests/test_collectionsModal.test.js`

**Interfaces:**
- `completed` means success.
- `completed_with_skips` reloads options and reports a skip/partial result rather than `Draft updated.`

- [ ] **Step 1: Write failing mutation test** returning `completed_with_skips` and asserting unconditional success text is absent.
- [ ] **Step 2: Run** `npm test -- tests/test_collectionsModal.test.js`.
- [ ] **Step 3: Implement status distinction and authoritative reload**.
- [ ] **Step 4: Re-run test**.
- [ ] **Step 5: Commit** with `fix: report skipped collection mutations`.

### Task 9: Key draft autosaves by draft and scope explicit discard cleanup

**Files:**
- Modify: `scripts/modules/draftRestaurantManager.js`
- Modify: `scripts/modules/conceptModule.js`
- Modify: `scripts/modules/offlineExplicitDiscardGuard.js`
- Modify: `tests/test_offlineExplicitDiscard.test.js`
- Add or modify: draft manager durability tests

**Interfaces:**
- Pending autosaves are keyed by `draftId` and `flushPendingSave(draftId?)` can flush one or all.
- `discardRestaurant` returns an outcome object distinguishing Curation discard from Entity-edit cancellation.

- [ ] **Step 1: Write failing tests** proving two draft autosaves survive independently and Entity-edit cancellation does not force-delete audio.
- [ ] **Step 2: Run targeted tests**.
- [ ] **Step 3: Implement keyed pending saves and typed discard outcomes**; update the guard to clean only on `discardedCuration`.
- [ ] **Step 4: Re-run draft/discard/offline authoring tests**.
- [ ] **Step 5: Commit** with `fix: isolate draft autosave and discard cleanup`.

### Task 10: Full verification and review

**Files:**
- No production file changes unless verification finds a regression.

- [ ] **Step 1: Run Collector tests**: `npm test`.
- [ ] **Step 2: Run lint**: `npm run lint`.
- [ ] **Step 3: Run deterministic build**: `npm run build:collector:check`.
- [ ] **Step 4: Run API canonical-English tests**: `cd concierge-api-v3 && venv/bin/python -m pytest tests/test_openai_audio_english_contract.py -q` (or the repository's available Python environment equivalent).
- [ ] **Step 5: Review branch diff against this spec** and verify no GitHub Actions workflow was added.
- [ ] **Step 6: Open a PR with findings, verification evidence, and any environment limitation explicitly documented.**