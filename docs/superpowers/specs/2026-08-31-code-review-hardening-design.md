# Code Review Hardening Design

## Context

A review of the 100 commits between `c53ecd2680e71970093ebb55d3f58e0268a7ff66` and `a88dcfedaa66482931c0fc61077c989903ea17e7` found four high-severity integration risks and seven medium/low hardening gaps. The domain direction is sound: Curations keep semantic truth explicit, canonical audio text is English, and raw media is retained until durable materialization succeeds. The remaining risks are mainly temporal: cache generations, concurrent saves, multi-tab processors, and ambiguous authorization failures.

## Goal

Make the current offline-first Collector safe across deploy upgrades, concurrent save attempts, multiple browser tabs, permanent authorization failures, media persistence failures, and large captures without changing product behavior or requiring GitHub Actions.

## Design

### 1. Build and Service Worker generations

Production asset identity is content-addressed. The build will stamp local `src`/`href` references and dynamic Offline Part 2 script URLs with content hashes. The Service Worker must never satisfy one versioned local asset request with bytes cached under another query string.

The build will also inject a deterministic shell generation into `service-worker.js` from the built manifest. Therefore any shipped local asset change produces a byte-level Service Worker change and a new cache namespace automatically. Exact request URLs are cached; `ignoreSearch: true` is removed for versioned shell assets.

### 2. Save serialization boundary

The legacy save flow is composed from several wrappers that temporarily alter shared runtime functions or context. Rewriting the entire editor save pipeline is intentionally out of scope for this hardening pass.

A new `OfflineSaveCoordinator` will be loaded after all Part 2 wrappers and will install the outermost `saveRestaurant` boundary. It exposes `runExclusive(fn)` and serializes every save invocation in one tab. Because the lock is entered before any existing save wrapper executes, temporary `curations.put`, linkage, source-identity, and recording contexts cannot overlap between two saves.

This is an explicit compatibility boundary. Future refactoring can replace the monkeypatch internals with an immutable save context without changing the coordinator API.

### 3. Persistent media leases

Audio and photo processors coordinate through IndexedDB, not process memory. A claim contains a random token and expiration. Claim acquisition happens inside a Dexie read/write transaction so two tabs cannot acquire the same item simultaneously.

Audio rows gain `processingLeaseToken`, `processingLeaseOwner`, and `processingLeaseExpiresAt`. Completion/failure mutations accept the token and refuse stale workers. Expired leases are reclaimable after restart.

Photo processing state uses the same lease shape per `sourceId`. Updates are performed inside a Dexie transaction that re-reads the latest draft before mutating `photoProcessing`, preventing lost updates between tabs.

### 4. Authorization error semantics

HTTP status is not domain meaning. `SyncOwnershipFailureGuard` only converts a failed Curation write into `ownership_forbidden` when the server payload contains an explicit ownership code such as `curation_owner_mismatch`. Generic 403/Forbidden/Not authorized errors remain ordinary sync failures and keep their retry/conflict semantics.

### 5. Media durability and metadata

Photo acceptance must await draft persistence before reporting success to the UI path. Failures leave the in-memory photo intact and surface an error rather than pretending durability.

Audio records keep `sourceLanguage` separate from canonical transcript `language`. Translation sets durable text language to `en` without overwriting the spoken-language provenance.

Quota preflight accepts an expected capture size and a reserve. Capture is rejected before persistence when free space cannot fit the new media plus reserve.

### 6. Operation status and smaller correctness fixes

Collections treats only `completed` as unconditional mutation success. `completed_with_skips` reloads the authoritative draft and reports a partial/skip result.

Draft autosave pending state is keyed by draft ID so independent drafts cannot cancel one another. Explicit discard cleanup only runs when the underlying action actually discarded a Curation, not when it merely cancelled an Entity edit. Local entity search remains unchanged in this pass except for documenting its bounded working-set assumption; introducing a search index is deferred until profiling shows a real scale problem.

## Testing

Tests are behavioral and do not merely search source strings.

- build A/build B proves a changed local asset produces a different Service Worker generation and exact hashed URLs;
- Service Worker cache lookup never falls back across query versions;
- two concurrent save calls execute the composed legacy save chain serially and restore shared functions;
- two processor instances sharing one IndexedDB can acquire a media lease only once;
- stale lease owners cannot finalize another worker's audio/photo;
- generic 403 is not classified as ownership, explicit ownership code is;
- photo acceptance waits for durable draft autosave and propagates failure;
- source language survives canonical-English translation;
- quota preflight accounts for expected bytes;
- `completed_with_skips` is not rendered as unconditional success;
- two independent draft autosaves are both flushed;
- Entity-edit cancellation does not trigger Curation media deletion.

No GitHub Actions workflow is added. Verification is through the repository's existing local Vitest/Pytest/build commands.