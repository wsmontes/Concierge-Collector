# Collections Admin Convergence — Design

**Date:** 2026-09-02  
**Status:** approved for implementation

## Context

Architecture Baseline 1 already contains the core Collections domain and most supporting infrastructure: Payload Admin, CMS auth, Collection lifecycle/CAS, draft operations, publish jobs, versioned membership, audit, Curation Explorer, server-side selections, exports, consumer applications/credentials, distribution APIs and Collector integration.

The main gap is product convergence: the backend and presentational React components exist, but the Collection management experience is not wired into a complete operator workflow. In particular, the current `CollectionViews` shell receives preview data rather than owning live reads, and its publish/restore controls are not connected to command endpoints. `/admin/collections` still relies on the generic Payload route even though native create/update/delete are intentionally blocked for domain safety.

This design closes that gap without changing the domain model.

## Goals

1. Make `/admin/collections` a real administrative workspace for Collections.
2. Make `/admin/collections/[id]` the canonical Collection detail surface.
3. Connect existing Members, Draft Changes, Versions, Distribution and Activity views to live paginated endpoints.
4. Wire metadata edit, publish, archive, restore and restore-as-draft to the existing command APIs using revision/idempotency headers.
5. Integrate Collection detail with the existing Curation Explorer instead of building a second selection UI.
6. Add an Operations surface for active/recent draft operations and publish jobs.
7. Preserve all existing domain invariants, feature flags and fail-closed authorization boundaries.

## Non-goals

- No change to the N:N Collection model.
- No ordering/rank/position of Curations.
- No direct native Payload writes to Collection lifecycle or membership.
- No new offline behavior for Collections in the Collector.
- No framework rewrite of the Collector.
- No redesign of the distribution data contract.

## Architecture

### 1. Collection list workspace

Create a custom `/admin/collections` page backed by the existing admin API.

The page shows:

- title and slug;
- lifecycle (`draft`, `published`, `archived`);
- draft state (`clean`, `dirty`, `publishing`, `failed`);
- selected counts;
- current published version;
- recent activity indicator where available.

It provides a first-class `New Collection` flow that calls `POST /api/admin/v1/collections` with `Idempotency-Key` and `X-Request-Id`. It does not use Payload native create.

Filters are intentionally small in v1: text query and lifecycle/draft-state filters. This is a management list, not another Explorer.

### 2. Collection detail workspace

Create `/admin/collections/[id]` as the canonical Collection management page.

The detail page loads the Collection record and renders the existing tab model:

- Overview
- Members
- Draft Changes
- Versions
- Distribution
- Activity

The existing presentational components remain useful, but data acquisition and commands move behind a typed client adapter. Lists remain cursor-paginated server reads; the browser never materializes an entire membership universe.

### 3. Typed admin client boundary

Introduce a small client module under `apps/admin/src/collections/admin-client.ts`.

Responsibilities:

- GET Collection list/detail;
- PATCH metadata with `If-Match`;
- archive/restore with `If-Match`;
- publish with `If-Match`, idempotency and unavailable confirmation;
- restore historical version as draft;
- members/diff/versions/activity pagination;
- normalize API errors into stable codes for UI handling.

This keeps fetch/header/error behavior out of React components and preserves the command/API boundary.

### 4. Collection commands and concurrency UX

Every unsafe operation uses the existing concurrency model:

- `If-Match` with current `revision` or `draftRevision` as required by the endpoint;
- fresh `X-Request-Id` per HTTP request;
- one logical `Idempotency-Key` per command intent, reused only for uncertain network retry of that same intent.

On `409/412`, the UI reloads server state and tells the operator the Collection changed. It never applies an optimistic membership mutation.

On `423`, controls become read-only and the active publication/job state is shown.

On `503`, state remains retryable.

### 5. Publish flow

The publish button becomes an explicit command flow:

1. load current Collection state;
2. request/derive publish preview information already supported by the domain reads;
3. show base version, next version, add/remove counts and unavailable count;
4. require explicit confirmation when unavailable items exist;
5. POST publish command;
6. poll the publish job/Collection state until terminal;
7. reload all affected tabs after promotion.

No UI path can directly move `currentPublishedVersion`.

### 6. Historical restore

Versions exposes `Restore as draft` rather than `Set current`.

The command calls the existing restore-as-draft endpoint and creates new draft changes. The published pointer stays unchanged until a later explicit publish.

### 7. Explorer integration

Do not build a Collection-specific picker.

From Collection detail, `Add Curations` navigates to `/admin/explorer` with the target Collection encoded in query state. The Explorer keeps its existing explicit/all-matching selection model and server-side manifests. When a target Collection is preselected, the bulk dialog defaults to it but remains based on the same operations pipeline.

From Explorer, successful bulk operations link back to the affected Collection detail and open the Job drawer/operation status as appropriate.

### 8. Operations workspace

Populate the currently empty Operations navigation group with `/admin/operations`.

The first version provides:

- active/recent draft operations for the current admin;
- selection parent + child summaries;
- publish jobs;
- status, progress, timestamps and safe error codes;
- cancel only where the existing operation contract permits it;
- links back to Collection and Explorer context.

This page is an operational console, not a raw Payload collection browser.

### 9. Distribution integration

The existing Applications UI remains the primary consumer-credential manager.

Collection detail's Distribution tab gains a read-oriented view of which applications currently include the Collection, plus a link to `/admin/applications` for editing. Application create/edit should move from raw Collection ID text entry toward a Collection picker, but that is a follow-up after the core Collection management path is closed.

## Data flow

```text
Admin React page
   -> typed admin client
      -> Payload custom /api/admin/v1/* endpoints
         -> domain repository / operation queue / publish worker
            -> concierge-cms

Curation membership changes
   -> Curation Explorer
      -> Selection manifest
         -> Collection operation(s)
            -> serialized worker
               -> draft delta

Publish
   -> publish command
      -> publish job
         -> worker + fencing/CAS
            -> immutable CollectionVersion + membership intervals
               -> currentPublishedVersion pointer
```

FastAPI remains the authority for operational Curations and live role authorization. Payload remains the authority for CMS-side Collection state and jobs.

## Error handling

UI error states use stable codes rather than raw server messages.

- `401`: sign-in/session recovery path.
- `403`: admin access required / permission changed.
- `409`: domain conflict or unavailable confirmation changed.
- `412`: stale revision; reload state.
- `423`: publication/Collection locked.
- `503`: dependency/service unavailable; retry.
- network failure: preserve retry path and idempotency key for an uncertain command.

No raw response body, token, credential or internal Mongo document is displayed.

## Testing

### Unit

- typed admin client headers, retries and error normalization;
- Collection list states and create flow;
- Collection detail tabs fetch paginated data;
- publish confirmation behavior;
- restore-as-draft behavior;
- stale revision and locked-state UX;
- Explorer preselected-Collection query state;
- Operations aggregation rendering.

### Integration

Reuse the isolated `concierge-cms-test` harness to verify:

- UI BFF endpoints return the expected allowlisted shapes;
- command endpoints and page adapters agree on revision fields;
- restore-as-draft does not move the published pointer;
- Operations reads never expose another actor's private operation state.

### E2E

Extend the existing live stack tests to drive the UI rather than only direct API calls:

1. CMS handoff/login;
2. create Collection from `/admin/collections`;
3. open detail;
4. send Curations through Explorer;
5. observe draft state;
6. publish v1 from the UI;
7. create/publish v2;
8. inspect Versions/Activity;
9. archive and restore from the UI.

The existing direct API publish E2E remains as a lower-level regression.

## Rollout

The existing `collections_admin` feature flag continues to gate the admin endpoints. The new UI must not bypass it.

No database migration is required for the core convergence work unless implementation discovers a missing read index. Any such index is added as an explicit idempotent migration and qualified against the test CMS database.

## Implementation order

1. Typed Collection admin client + custom list/detail routes.
2. Live Members/Diff/Versions/Activity adapters.
3. Metadata/lifecycle/publish/restore command wiring.
4. Explorer target-Collection integration.
5. Operations workspace.
6. Distribution picker polish.
7. Remaining production recovery/retention hardening from the original phase 07.

## Success criteria

The work is complete when an authorized admin can perform the full Collection lifecycle from the Admin UI without using raw Payload CRUD or manually calling APIs, while all existing concurrency, audit, versioning, authorization and distribution invariants remain intact.
