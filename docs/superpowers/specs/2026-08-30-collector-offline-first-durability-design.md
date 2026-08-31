# Collector Offline-First Durability Design

## Goal

Make Concierge Collector safe for long disconnected authoring sessions: a curator must be able to open the already-installed Collector with no network, create/edit/save many Curations, capture audio/photos/text, close/reopen the app, and later reconnect without losing or silently overwriting work.

## Core invariant

**Local durable state is authoritative until synchronization and any required source processing have succeeded.** Network availability must never be required to preserve a user's work.

## Non-goals

- Offline AI transcription or concept extraction.
- Offline Google Places/catalog completeness.
- Mirroring the entire server dataset into IndexedDB.
- Retaining raw audio/photo forever after a durable processed representation exists.

## Durability rules

1. **Capture-before-processing.** Raw audio/photo is persisted to IndexedDB before any remote processing starts.
2. **No destructive cleanup by age/count.** A raw source may be deleted only after it is disposable, never merely because it is old or exceeds a count limit.
3. **Save is non-destructive.** Saving a Curation cannot delete the only durable copy of an unprocessed capture source.
4. **Single destructive boundary.** Only `DatabaseManager` may delete/reset the Collector IndexedDB, and it must refuse when unsaved/unsynced work exists.
5. **Drafts are session-specific.** Multiple independent offline authoring sessions can coexist for one curator; curator identity is ownership metadata, not the draft primary identity.
6. **Lifecycle flush.** Debounced draft writes are flushed when the document becomes hidden, on `pagehide`, and before internal navigation away from authoring.
7. **App shell is offline-capable.** Critical JS/CSS/runtime dependencies must be same-origin and cached by a versioned Service Worker so reload/start works without network after one successful online load.
8. **Storage is treated as scarce.** Request persistent storage when supported, preflight quota before large capture, handle `QuotaExceededError`, and never reclaim space by deleting non-disposable captures.
9. **Local-first entity linking.** Existing local Entities can be searched/selected while offline; remote Places/catalog search augments this only when online.
10. **Ownership is enforced before editing.** A human Curation owned by another human is read-only locally; synthetic Curations remain eligible for takeover on human save under existing backend rules.
11. **Deferred processing is explicit.** Offline raw media uses states such as `captured`/`awaiting_processing`; reconnect processing is idempotent and resumable.
12. **Sync is downstream of durability.** Server push failure never reverses a successful local save.

## Data model

### Capture source lifecycle

Use the existing `pendingAudio` store for this implementation tranche, but strengthen its semantics instead of introducing a broad new media subsystem immediately.

Each pending audio record gains/uses durable lifecycle semantics:

- `status: captured | awaiting_processing | processing | completed | failed`
- `sourceId`: stable client-generated identifier
- `curationId`: optional durable Curation association
- `draftId`: optional authoring-session association
- `transcriptPersisted`: boolean, default false
- `disposable`: boolean, default false

A raw blob can be deleted only when `disposable === true`, or by an explicit user destructive action that names the recording.

Photo durability will follow the same principle using draft/session persistence in this tranche: accepted photos must remain in the draft until the saved Curation contains a durable media representation or a durable pending-media record. The implementation must not clear accepted photo data merely because Save succeeded.

### Draft identity

`draftRestaurants` remains for compatibility, but each new authoring flow receives its own draft. `getOrCreateCurrentDraft(curatorId)` must not automatically adopt the most recent unrelated draft. Restore is by explicit current draft/session identity.

## Boot and recovery

- Vendor critical browser libraries (`Dexie`, `Toastify`, and the runtime dependencies required by authoring) under same-origin static assets.
- Register `service-worker.js` from `main.js` or a focused bootstrap module.
- Cache the app shell with a versioned cache name.
- Navigation requests use network-first with cached `index.html` fallback; static same-origin assets use cache-first/stale-while-revalidate.
- API calls are never cached as authoritative mutation responses.
- `main.js` must not directly call `deleteDatabase('ConciergeCollector')`; recovery delegates to `DatabaseManager`.

## Reconnect behavior

When connectivity returns:

1. Resume `awaiting_processing`/`failed` audio processing without duplicate transcription.
2. Persist transcript/concepts into the relevant draft/Curation.
3. Mark the raw audio disposable only after the transcript/source provenance is durably persisted.
4. Push pending Curations/Entities through `SyncManager`.
5. Preserve conflicts for explicit resolution; never drop local content to make sync green.

## Storage behavior

- Call `navigator.storage.persist()` when supported after successful boot/auth.
- Use `navigator.storage.estimate()` before starting a recording or accepting a large photo batch.
- At >= 95% usage, block new large captures with a clear message while keeping editing/text saves available.
- Catch `QuotaExceededError` on IndexedDB writes and surface a recoverable error; existing data remains untouched.

## Offline ownership behavior

Before mutable Curation edit:

- `curator_type === 'synthetic'`: editable; existing takeover-on-save behavior remains.
- human owner equals current curator: editable.
- human owner differs: read-only and offer creating the current curator's own Curation for the same Entity.

This decision must use locally persisted curator identity and Curation fields, not require a server round-trip.

## Acceptance tests

### AIRPLANE-01 — restart durability

Open online once, switch to airplane mode, create 50 Curations with audio, close the app, reopen while still offline. All 50 Curations/drafts and all still-required raw audio blobs remain available.

### AIRPLANE-02 — edit durability

Edit 20 locally available Curations while offline, background/foreground the app repeatedly, close/reopen, and verify the latest saved/draft state survives.

### AIRPLANE-03 — Save cannot consume source

Capture audio and photos offline, Save Curation before remote processing succeeds, and verify raw sources remain durable and associated with the saved work.

### AIRPLANE-04 — resumable reconnect

Reconnect with 50 pending sources, interrupt processing around item 23, restart, and verify processing resumes without duplicate source application or loss.

### AIRPLANE-05 — quota safety

Simulate storage near quota; new large capture is refused, text editing/save still works, and no existing source is deleted.

### AIRPLANE-06 — safe reclamation

After transcript/source representation is durably persisted, mark raw audio disposable and prune it without removing transcript/provenance/Curation.

## Implementation sequencing

1. P0 audio retention and Save semantics.
2. P0 destructive recovery boundary.
3. Draft/session flush and multi-draft safety.
4. Storage persistence/quota handling.
5. App-shell offline boot.
6. Local-first Entity linking and ownership guard.
7. Reconnect processor hardening and end-to-end airplane tests.

## Rollout

Keep all work on `design/curation-authoring-workspace` and the existing draft PR. Do not merge until targeted tests and the Collector quality suite pass, plus a manual browser airplane-mode smoke test is completed. Existing server-driven browsing remains unchanged except for local fallbacks; this work must not download the full server catalog.
