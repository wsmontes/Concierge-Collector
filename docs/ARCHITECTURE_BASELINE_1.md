# Architecture Baseline 1

**Status:** candidate — full local qualification pending

Architecture Baseline 1 is the first explicit convergence point for the modern Concierge platform. It is not a claim that every historical subsystem has been rewritten; it defines the boundaries and invariants that future work must preserve.

## Product/domain invariants

### Entity

An Entity represents an object in the world. Canonical facts about that object belong to the Entity boundary.

### Curation

A Curation represents curator knowledge/perspective. It may exist before Entity linkage. `entity_id` is optional while authoring and becomes the durable linkage relation when known.

A human Curation created from Capture begins with:

- `curator_type = human`
- workflow `status = draft`
- linkage represented by `entity_id`
- audio provenance retaining the Capture `source_id`

Viewing a synthetic Curation never transfers ownership. Human takeover occurs only through an authorized write.

### Collection

A Collection is an intentional, versioned selection of Curations. Publication creates immutable historical versions while the next draft may continue evolving independently.

## Component boundaries

### Collector

Owns curator authoring and durable local state.

Baseline rules:

- offline draft/media survives network and processing failure;
- another human's Curation is blocked before entering a mutable edit path;
- the editor has one outer edit orchestration boundary (`CurationAuthoringController`);
- legacy wrappers remain fallback compatibility during progressive migration;
- server synchronization remains authoritative for authorization/conflict outcomes.

### FastAPI

Owns operational Entity/Curation writes, authentication, authorization, paid-provider boundaries and retrieval.

Baseline rules:

- access/refresh/OAuth state use distinct server-side trust boundaries;
- refresh rotation is single-use and server-backed;
- OAuth PKCE verifier is server-side and transient;
- protected/paid routes revalidate live user authorization instead of trusting a stale role claim indefinitely;
- Google OAuth refresh credentials are not stored in the operational user document;
- paid-provider rate identity is stable across access-token rotation and Bearer/cookie transport;
- unexpected provider/database errors are redacted at the response boundary;
- semantic fallback is exhaustive when Atlas Vector Search is unavailable: correctness over recency-biased speed;
- legacy no-version Curation updates still use optimistic compare-and-swap.

### Capture

Capture is a paid-work orchestration boundary, not a second Curation writer.

Baseline rules:

- owner-scoped deterministic Capture identity;
- durable processing claim before Whisper/GPT/Places;
- lease heartbeat while blocking provider work runs off the event loop;
- duplicate active processing fails/reuses state rather than paying twice;
- Entity and Curation confirmation writes delegate to canonical services;
- modern Curation draft/linkage/provenance semantics are preserved;
- concept extraction preserves the established Curation category shape and price vocabulary.

### Payload/Admin

Owns knowledge operations, Collection lifecycle and worker-driven publication/distribution.

Baseline rules:

- draft operations are serialized and revisioned;
- publication is fenced/leased and idempotent;
- expired leases can be taken over without duplicate promotion;
- a published version remains stable while a later draft changes;
- archive/restore preserves the exact published version;
- consumer credentials and distribution are separate from human authoring auth;
- Collector reads and draft mutations can be rolled back independently at the server boundary.

Existing integration coverage includes a forced publish lease expiry/takeover and asserts a single published version, fencing-token advancement and one publish audit event.

## Staged rollout policy

Collections rollout flags are enforced server-side in both FastAPI and Payload/Admin. Browser/UI state is never authoritative for enabling a capability.

In staging and production, and when the environment is not classified, an absent flag is **disabled**. Development/test environments remain enabled by default so local workflows work without production rollout configuration.

Versioned ownership metadata lives in `config/collections-feature-flags.json` for:

- `cms_auth`
- `catalog_scan`
- `collections_admin`
- `collector_association_read`
- `collector_draft_mutation`
- `consumer_credentials`
- `collections_distribution`

Before deploying Baseline 1, the operator must explicitly choose the production value for the corresponding environment variables rather than relying on defaults.

## Semantic retrieval policy

Atlas Vector Search is the preferred fast path. The operational database currently stores compact Binary float32 vectors, which may not be indexable by every deployed Atlas vector configuration.

If native vector search cannot execute, the baseline fallback scans every eligible Curation. It may be slower, but an older Curation cannot disappear merely because it falls outside a recent-candidate window.

Responses identify the mode as `atlas_vector` or `fallback_exhaustive`; exhaustive fallback is not marked partial. The Pydantic/OpenAPI response contract uses the same terminology and defaults.

A future migration to a natively indexable vector representation is encouraged, but must not reintroduce silent recall loss.

## Release qualification

GitHub Actions are intentionally not part of this architecture because of project cost constraints.

### Standard

```bash
npm run verify
```

Required before ordinary merge/deploy work.

### Full

```bash
npm run verify:full
```

Required for Architecture Baseline 1 qualification and changes involving auth, Collections publishing, persistence or migrations.

The full stack must include:

- MongoDB test databases using the required `-test` naming guard;
- FastAPI in development/test configuration;
- Admin/Payload web process;
- Payload worker;
- Playwright browser;
- the deterministic seed data expected by the Explorer/publish E2E suites.

`verify:full` executes both API integration tests and the real-Mongo `@mongo` suite with `--run-mongo`. It validates both `CMS_MONGODB_DB_NAME` and `MONGODB_TEST_DB_NAME` before execution and refuses names that do not end in `-test`.

`verify:full` also enables the live auth-handoff, Explorer and publish Playwright suites. Remote E2E targets are rejected unless `CONCIERGE_ALLOW_REMOTE_E2E=1` explicitly opts into a disposable remote test environment.

## Identity migration qualification

Before applying user identity indexes or deleting legacy credentials in an environment with real data:

1. run the duplicate-identity audit;
2. review every duplicate/conflict;
3. run the Google-refresh-token purge in dry-run mode;
4. apply the purge only after review;
5. run the identity-index migration dry-run;
6. apply indexes only when the audit is clean;
7. smoke-test login, refresh, logout, role revocation and CMS handoff.

The scripts live under `concierge-api-v3/scripts/` and are intentionally operator-driven rather than automatic startup mutations.

## Deferred decisions

These are deliberately **not** resolved by Baseline 1:

- whether `synthetic` should remain a first-class Curation authorship type or become a separate enrichment-candidate domain object;
- the final native vector-storage/index representation;
- a framework rewrite of the vanilla Collector;
- broader save/discard/media orchestration migration behind the new authoring controller.

## Candidate → baseline promotion

This document remains a candidate contract until a complete checkout executes the standard and full release gates and the applicable environment/migration smoke checks. Failures discovered during qualification are fixed on the convergence branch before merge/tagging.
