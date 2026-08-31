# Collector Offline-First Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Collector safe for long disconnected authoring sessions without losing audio, photos, drafts, saved Curations, or sync intent across reloads/restarts.

**Architecture:** Keep IndexedDB/Dexie as the durable local authority and strengthen existing stores instead of introducing a second offline database. First remove destructive paths, then make draft/capture lifecycle explicit, then make the app shell restartable offline, and finally harden local-first linking/ownership and reconnect behavior.

**Tech Stack:** Browser JavaScript, Dexie/IndexedDB, Vitest + jsdom/fake-indexeddb, Service Worker Cache API, existing SyncManagerV3.

**Spec:** `docs/superpowers/specs/2026-08-30-collector-offline-first-durability-design.md`

## Global Constraints

- `entity_id = null` remains a valid orphan Curation state.
- A transcript does not prove that audio exists; explicit capture provenance is authoritative.
- `curation.entity_id` is the linkage truth; workflow status never proves linkage.
- `curation.curator_type` is the authorship truth; curator name/id heuristics are not authoritative.
- Raw capture material may be reclaimed only after a durable processed representation exists or by explicit user deletion.
- Network failure must never roll back a successful local save.
- Do not download the full Entity/Curation catalog for offline support.
- Keep work on `design/curation-authoring-workspace`; do not merge before verification.

---

### Task 1: Make pending audio retention lossless

**Files:**
- Modify: `scripts/modules/pendingAudioManager.js`
- Create: `tests/test_pendingAudioDurability.test.js`

**Interfaces:**
- Produces: `PendingAudioManager.canDeleteAudio(record): boolean`
- Produces: `PendingAudioManager.markTranscriptPersisted(id, { curationId }): Promise<void>`
- Produces: `PendingAudioManager.associateWithCuration(filter, curationId): Promise<number>`
- `prune()` and maintenance cleanup delete only records for which `canDeleteAudio()` is true.

- [ ] **Step 1: Write failing tests for lossless retention**

Test behaviors:

```js
it('does not prune an unprocessed recording because it is old or over maxCount', async () => {
  // seed 31 old non-disposable records
  await manager.prune({ maxCount: 30, maxAgeDays: 7 });
  expect(await db.pendingAudio.count()).toBe(31);
});

it('prunes only explicitly disposable recordings', async () => {
  // seed one required + one disposable old record
  await manager.prune({ maxCount: 1, maxAgeDays: 0 });
  expect(await db.pendingAudio.get(requiredId)).toBeTruthy();
  expect(await db.pendingAudio.get(disposableId)).toBeUndefined();
});

it('marks raw audio disposable only after transcript persistence is confirmed', async () => {
  await manager.markTranscriptPersisted(id, { curationId: 'cur_1' });
  const row = await db.pendingAudio.get(id);
  expect(row.transcriptPersisted).toBe(true);
  expect(row.disposable).toBe(true);
  expect(row.curationId).toBe('cur_1');
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
npm run test:collector -- tests/test_pendingAudioDurability.test.js
```

Expected: FAIL because `canDeleteAudio`, `markTranscriptPersisted`, and safe pruning do not exist.

- [ ] **Step 3: Implement minimal lifecycle fields and safe prune**

New records use:

```js
{
  sourceId: crypto.randomUUID?.() || `audio_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  status: 'captured',
  transcriptPersisted: false,
  disposable: false,
  curationId: opts.curationId || null
}
```

`canDeleteAudio(record)` returns `record?.disposable === true` only. `cleanupOldTranscribed()` and `purgeProcessedAudio()` must use the same predicate rather than status names alone.

- [ ] **Step 4: Run GREEN**

```bash
npm run test:collector -- tests/test_pendingAudioDurability.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/modules/pendingAudioManager.js tests/test_pendingAudioDurability.test.js
git commit -m "fix: make pending audio retention lossless"
```

---

### Task 2: Make Curation Save non-destructive to capture sources

**Files:**
- Modify: `scripts/modules/conceptModule.js`
- Modify: `scripts/modules/recordingModule.js`
- Create: `tests/test_curationSaveOfflineMedia.test.js`

**Interfaces:**
- Consumes: `PendingAudioManager.associateWithCuration(...)`
- Consumes: `PendingAudioManager.markTranscriptPersisted(...)`
- Produces: Curation Save that never bulk-deletes raw audio by `draftId`/`restaurantId`.

- [ ] **Step 1: Write failing source-contract tests**

Required assertions:

```js
expect(conceptModuleSource).not.toMatch(/deleteAudios\(\{\s*draftId/);
expect(conceptModuleSource).not.toMatch(/deleteAudios\(\{\s*restaurantId/);
expect(conceptModuleSource).toMatch(/associateWithCuration/);
```

Add a behavioral test with fake IndexedDB proving Save leaves an `awaiting_processing` audio row intact.

- [ ] **Step 2: Run RED**

```bash
npm run test:collector -- tests/test_curationSaveOfflineMedia.test.js
```

Expected: FAIL because current Save deletes pending audio after successful local save.

- [ ] **Step 3: Replace cleanup with association/materialization**

After `db.curations.put(curation)` succeeds:

1. associate pending rows from the active draft/entity with `curationId`;
2. if the recording that produced the current transcript is known and the transcript is now present in the saved Curation, call `markTranscriptPersisted()` for that exact audio row;
3. optionally prune only disposable rows;
4. delete the draft only when its durable fields/media are no longer the sole copy.

Do **not** infer audio provenance from transcript text.

- [ ] **Step 4: Ensure RecordingModule keeps the current source identity**

`processRecording()` stores the successful audio id in an authoring-safe field until Save associates/materializes it. Do not clear the raw row merely on transcription success.

- [ ] **Step 5: Run GREEN**

```bash
npm run test:collector -- tests/test_curationSaveOfflineMedia.test.js tests/test_sourceUtilsProvenance.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/modules/conceptModule.js scripts/modules/recordingModule.js tests/test_curationSaveOfflineMedia.test.js
git commit -m "fix: preserve offline capture sources across curation save"
```

---

### Task 3: Centralize all IndexedDB destruction in DatabaseManager

**Files:**
- Modify: `scripts/storage/databaseManager.js`
- Modify: `scripts/core/main.js`
- Create: `tests/test_databaseRecoveryDurability.test.js`

**Interfaces:**
- Produces: `DatabaseManager.requestRecovery(reason): Promise<boolean>`
- No production code outside `databaseManager.js` may invoke `Dexie.delete('ConciergeCollector')` or `indexedDB.deleteDatabase('ConciergeCollector')`.

- [ ] **Step 1: Write failing tests**

Static contract:

```js
expect(mainSource).not.toMatch(/deleteDatabase\(['"]ConciergeCollector['"]\)/);
expect(mainSource).not.toMatch(/Dexie\.delete\(['"]ConciergeCollector['"]\)/);
```

Behavioral contract: when pending audio/draft/sync work exists, recovery returns false or throws a preservation error and records remain present.

- [ ] **Step 2: Run RED**

```bash
npm run test:collector -- tests/test_databaseRecoveryDurability.test.js
```

Expected: FAIL on direct destructive calls in `main.js`.

- [ ] **Step 3: Implement `requestRecovery()`**

`requestRecovery(reason)` must:

```text
inspect unsaved work -> if present, refuse destruction and keep recovery flag informational -> otherwise use existing backup/recovery/reset path
```

`main.js` delegates to the manager and enters degraded mode / shows recovery guidance rather than deleting directly.

- [ ] **Step 4: Run GREEN**

```bash
npm run test:collector -- tests/test_databaseRecoveryDurability.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/storage/databaseManager.js scripts/core/main.js tests/test_databaseRecoveryDurability.test.js
git commit -m "fix: centralize destructive database recovery"
```

---

### Task 4: Make drafts session-specific and flush on lifecycle boundaries

**Files:**
- Modify: `scripts/modules/draftRestaurantManager.js`
- Modify: `scripts/modules/conceptModule.js`
- Modify: `scripts/core/main.js`
- Create: `tests/test_draftDurability.test.js`

**Interfaces:**
- Produces: `createDraft(curatorId, data, { sessionId? })`
- Produces: `flushPendingSave(): Promise<void>`
- `getOrCreateCurrentDraft()` may reuse only an explicitly active draft id/session, never the newest unrelated draft merely because curator ids match.

- [ ] **Step 1: Write failing tests**

```js
it('creates independent drafts for two authoring sessions owned by the same curator', ...);
it('flushes the debounced write immediately on lifecycle flush', ...);
it('does not adopt the most recent unrelated draft on a new curation flow', ...);
```

- [ ] **Step 2: Run RED**

```bash
npm run test:collector -- tests/test_draftDurability.test.js
```

Expected: FAIL because current manager reuses the most recent curator draft and exposes no flush API.

- [ ] **Step 3: Implement session identity**

Add `sessionId` to draft rows and keep `currentDraftId/currentSessionId` explicit. New Curation entry creates a fresh session; restore flows may explicitly select an existing draft.

- [ ] **Step 4: Implement flush**

Store the latest pending draft payload when scheduling debounce. `flushPendingSave()` clears the timer and calls `updateDraft()` immediately.

Bind:

```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') DraftRestaurantManager.flushPendingSave();
});
window.addEventListener('pagehide', () => DraftRestaurantManager.flushPendingSave());
```

Navigation guard flushes before leaving an authoring route.

- [ ] **Step 5: Run GREEN**

```bash
npm run test:collector -- tests/test_draftDurability.test.js
```

- [ ] **Step 6: Commit**

```bash
git add scripts/modules/draftRestaurantManager.js scripts/modules/conceptModule.js scripts/core/main.js tests/test_draftDurability.test.js
git commit -m "feat: make offline drafts session durable"
```

---

### Task 5: Add persistent-storage and quota capture guard

**Files:**
- Modify: `scripts/storage/dataStore.js`
- Modify: `scripts/modules/recordingModule.js`
- Modify: `scripts/modules/conceptModule.js`
- Create: `tests/test_storageDurability.test.js`

**Interfaces:**
- Produces: `DataStore.requestPersistentStorage(): Promise<boolean|null>`
- Produces: `DataStore.getStorageHealth(): Promise<{ usage, quota, ratio, canCaptureLarge }>`
- Produces: `DataStore.assertCaptureCapacity(kind): Promise<void>`

- [ ] **Step 1: Write failing tests**

Cover supported/unsupported `navigator.storage.persist`, healthy quota, >=95% quota, and `QuotaExceededError` preservation behavior.

- [ ] **Step 2: Run RED**

```bash
npm run test:collector -- tests/test_storageDurability.test.js
```

- [ ] **Step 3: Implement storage health APIs**

`canCaptureLarge` is false at ratio >= 0.95. Recording start and accepted photo batches call `assertCaptureCapacity()` before allocating large new blobs. Text editing/save remains allowed.

- [ ] **Step 4: Surface quota failures without cleanup**

Catch `QuotaExceededError` at capture persistence boundaries, show a clear message, and do not invoke prune/delete as recovery.

- [ ] **Step 5: Run GREEN**

```bash
npm run test:collector -- tests/test_storageDurability.test.js
```

- [ ] **Step 6: Commit**

```bash
git add scripts/storage/dataStore.js scripts/modules/recordingModule.js scripts/modules/conceptModule.js tests/test_storageDurability.test.js
git commit -m "feat: guard offline capture storage capacity"
```

---

### Task 6: Make the authoring app shell restartable offline

**Files:**
- Create: `service-worker.js`
- Modify: `scripts/core/main.js`
- Modify: `scripts/build-collector.mjs`
- Modify: `index.html`
- Create: `tests/test_offlineAppShell.test.js`

**Interfaces:**
- Cache name: `concierge-collector-shell-v1` (bump intentionally when shell contract changes).
- Service Worker caches `index.html`, all same-origin authoring scripts/styles/images required by `index.html`, plus exact external runtime/font URLs already referenced by the shell.
- API routes under `/api/` are network-only.

- [ ] **Step 1: Write failing static tests**

Assert:

```js
expect(indexHtml).toContain('service-worker.js');
expect(buildScript).toContain('service-worker.js');
expect(serviceWorker).toContain('concierge-collector-shell-v1');
expect(serviceWorker).toMatch(/\/api\//);
```

- [ ] **Step 2: Run RED**

```bash
npm run test:collector -- tests/test_offlineAppShell.test.js
```

- [ ] **Step 3: Add Service Worker**

Install pre-caches critical shell; activate removes old Collector shell caches; fetch strategy:

```text
navigation: network first -> cached index fallback
same-origin static: cache first -> network and cache
known external shell assets: cache first -> network and cache
/api/: network only
```

- [ ] **Step 4: Register after boot**

Registration failures are non-fatal. Expose an `offline-ready` log/status only after `navigator.serviceWorker.ready` resolves.

- [ ] **Step 5: Build inclusion**

`build-collector.mjs` copies/checks `service-worker.js` so Render deployment contains it.

- [ ] **Step 6: Run GREEN + build check**

```bash
npm run test:collector -- tests/test_offlineAppShell.test.js
npm run build:collector:check
```

- [ ] **Step 7: Commit**

```bash
git add service-worker.js index.html scripts/core/main.js scripts/build-collector.mjs tests/test_offlineAppShell.test.js
git commit -m "feat: cache Collector authoring shell for offline restart"
```

---

### Task 7: Make Entity linking local-first and prevent impossible offline edits

**Files:**
- Modify: `scripts/services/findEntityModal.js`
- Modify: `scripts/ui-core/uiManager.js`
- Modify: `scripts/modules/curationWorkspaceModule.js`
- Create: `tests/test_offlineAuthoringGuards.test.js`

**Interfaces:**
- `FindEntityModal.searchLocalEntities(query, filters): Promise<Entity[]>`
- `UIManager.getCurationEditPermission(curation, currentCurator): 'edit' | 'synthetic-takeover' | 'read-only'`

- [ ] **Step 1: Write failing tests**

Cover local Entity results while `navigator.onLine === false`, own-human edit, synthetic edit/takeover, and other-human read-only.

- [ ] **Step 2: Run RED**

```bash
npm run test:collector -- tests/test_offlineAuthoringGuards.test.js
```

- [ ] **Step 3: Implement local Entity search**

Search IndexedDB first. When online, merge/dedupe remote results; when offline, render local results and an explicit offline note instead of an API error.

- [ ] **Step 4: Implement ownership guard before mutable editor state**

Use explicit `curator_type` and owner identity. Other-human Curations open read-only and offer creating a separate Curation for the same Entity; do not wait for backend 403.

- [ ] **Step 5: Run GREEN**

```bash
npm run test:collector -- tests/test_offlineAuthoringGuards.test.js
```

- [ ] **Step 6: Commit**

```bash
git add scripts/services/findEntityModal.js scripts/ui-core/uiManager.js scripts/modules/curationWorkspaceModule.js tests/test_offlineAuthoringGuards.test.js
git commit -m "feat: enforce local-first offline authoring guards"
```

---

### Task 8: Make reconnect processing resumable and idempotent

**Files:**
- Modify: `scripts/modules/pendingAudioManager.js`
- Modify: `scripts/modules/recordingModule.js`
- Modify: `scripts/sync/syncManagerV3.js`
- Create: `tests/test_offlineReconnect.test.js`

**Interfaces:**
- `PendingAudioManager.getProcessableAudios()` returns required raw rows in `captured|awaiting_processing|failed` states that are not disposable.
- `RecordingModule.retryPendingAudio(id)` processes one source idempotently.
- Online event/background sync schedules processing before or alongside normal sync without duplicate workers per source.

- [ ] **Step 1: Write failing tests**

Cover restart with a `processing` row (normalize to `awaiting_processing`), duplicate reconnect events, successful transcript persistence, and interruption/resume.

- [ ] **Step 2: Run RED**

```bash
npm run test:collector -- tests/test_offlineReconnect.test.js
```

- [ ] **Step 3: Normalize interrupted states on initialization**

A row left `processing` across restart is not proof of an active worker; normalize it to `awaiting_processing` unless disposable.

- [ ] **Step 4: Add single-flight reconnect processing**

Maintain an in-memory Set keyed by stable `sourceId`/row id so multiple online/sync events cannot transcribe the same source concurrently.

- [ ] **Step 5: Run GREEN**

```bash
npm run test:collector -- tests/test_offlineReconnect.test.js
```

- [ ] **Step 6: Commit**

```bash
git add scripts/modules/pendingAudioManager.js scripts/modules/recordingModule.js scripts/sync/syncManagerV3.js tests/test_offlineReconnect.test.js
git commit -m "feat: resume offline capture processing on reconnect"
```

---

### Task 9: Airplane-mode acceptance and full regression gate

**Files:**
- Create: `tests/test_offlineDurabilityContracts.test.js`
- Modify: `docs/superpowers/plans/2026-08-30-collector-offline-first-durability.md` (mark completed items/results)

**Interfaces:**
- No new production API; this task verifies the cross-component contract.

- [ ] **Step 1: Add cross-component durability contract tests**

At minimum assert:

- no direct DB destruction outside DatabaseManager;
- no Save cleanup of required pending media;
- pending raw audio is not age/count-pruned;
- Service Worker shell is deployed by build;
- draft lifecycle flush listeners exist;
- ownership/linkage/provenance explicit-truth invariants remain intact.

- [ ] **Step 2: Run focused offline suite**

```bash
npm run test:collector -- \
  tests/test_pendingAudioDurability.test.js \
  tests/test_curationSaveOfflineMedia.test.js \
  tests/test_databaseRecoveryDurability.test.js \
  tests/test_draftDurability.test.js \
  tests/test_storageDurability.test.js \
  tests/test_offlineAppShell.test.js \
  tests/test_offlineAuthoringGuards.test.js \
  tests/test_offlineReconnect.test.js \
  tests/test_offlineDurabilityContracts.test.js
```

- [ ] **Step 3: Run Collector gate**

```bash
npm run build:collector:check
npm run lint:collector
npm run test:collector
```

Expected: all pass. If environment/CI prevents execution, record that explicitly; do not claim green.

- [ ] **Step 4: Manual browser smoke script**

Perform AIRPLANE-01 through AIRPLANE-06 from the design spec using DevTools Offline/airplane mode, including a hard reload while offline.

- [ ] **Step 5: Commit verification documentation**

```bash
git add tests/test_offlineDurabilityContracts.test.js docs/superpowers/plans/2026-08-30-collector-offline-first-durability.md
git commit -m "test: gate Collector offline-first durability"
```

## Plan self-review

- Spec coverage: all 12 durability rules map to Tasks 1–9.
- Destructive behavior is fixed before offline shell/UX enhancements.
- Media deletion authority is explicit and testable.
- Draft identity no longer relies on curator-as-singleton.
- No task requires offline AI or full catalog mirroring.
- All production behavior changes have a failing-test-first step.
- Merge remains blocked on full verification evidence.
