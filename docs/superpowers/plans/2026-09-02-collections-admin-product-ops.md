# Collections Admin Product + Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Finish the operator-facing Collections workflow by connecting Collection detail to Explorer, building a first-class Operations workspace, and replacing raw Collection IDs in Distribution with Collection-aware controls.

**Architecture:** Keep the existing server-side selection/operation pipeline and command endpoints as the only mutation boundary. Carry Collection context through URL query state into Explorer, extend operation reads to support current-admin recent history plus publish jobs, and reuse the Collections read API in Distribution rather than duplicating Collection data.

**Tech Stack:** Next.js, React, TypeScript, Payload CMS, Vitest/Testing Library, MongoDB/Payload Jobs.

**Spec:** `docs/superpowers/specs/2026-09-02-collections-admin-convergence-design.md`

## Global Constraints

- No Collection membership expansion in the browser.
- No native Payload writes for Collection lifecycle, membership, operations, applications, or credentials.
- Preserve current-admin privacy scoping on operation reads.
- Preserve Collector operation read restrictions.
- Preserve all CAS/idempotency headers on unsafe commands.
- No raw Mongo IDs as the primary user-facing selector when a Collection title/slug is available.
- Runtime verification is accumulated for the Codex integration pass; tests are still written with each change.

---

### Task 1: Targeted Explorer flow from Collection detail

**Files:**
- Modify: `apps/admin/src/components/collections/CollectionViews.tsx`
- Modify: `apps/admin/src/components/explorer/CurationExplorer.tsx`
- Modify: `apps/admin/src/components/operations/BulkActionDialog.tsx`
- Test: `apps/admin/tests/unit/components/explorer-target-collection.test.tsx`

**Interfaces:**
- `CollectionViews` produces `/admin/explorer?collection=<id>` from `Add Curations`.
- `CurationExplorer` consumes optional `targetCollectionId` from query state.
- `BulkActionDialog` consumes optional `initialCollectionId`, preselects it if eligible, and keeps normal multi-target behavior available.

- [ ] Add failing UI tests for Collection -> Explorer URL, target context banner, and preselected target.
- [ ] Implement `Add Curations` link on non-archived Collection detail.
- [ ] Parse `collection` query parameter in Explorer without accepting it as authority; actual Collection eligibility is confirmed by the Collections list loaded by `BulkActionDialog`.
- [ ] Preselect only when the target exists and is not archived/publishing; otherwise show an explanatory warning and no selection.
- [ ] After a bulk operation is posted, show links back to the target Collection and `/admin/operations` while preserving the Job Drawer.

### Task 2: Operations read model and workspace

**Files:**
- Modify: `apps/admin/src/payload/endpoints/operations.ts`
- Create: `apps/admin/src/operations/admin-client.ts`
- Create: `apps/admin/src/components/operations/OperationsWorkspace.tsx`
- Create: `apps/admin/app/(payload)/admin/operations/page.tsx`
- Modify: `apps/admin/src/components/shell/CmsNav.tsx`
- Test: `apps/admin/tests/unit/payload/operations-list.test.ts`
- Test: `apps/admin/tests/unit/components/operations-workspace.test.tsx`

**Interfaces:**
- `GET /api/admin/v1/operations?actor=current&scope=recent&cursor=<...>` returns current-admin parent selection operations in reverse chronological order, terminal and active, with aggregated child summary/progress.
- `GET /api/admin/v1/publish-jobs?actor=current&cursor=<...>` returns only publish jobs created by the current admin and a safe allowlisted shape including Collection ID, target version, status/checkpoint, selectedCount, confirmedUnavailableCount, createdAt and updatedAt.
- Existing active endpoint behavior used by `JobDrawer` remains backward compatible.

- [ ] Add endpoint tests proving current-admin scoping, terminal history inclusion, cursor behavior, and publish-job actor isolation.
- [ ] Extend operation endpoint query parsing without weakening the existing `active=true` contract.
- [ ] Add safe publish-job list endpoint under the operations endpoint module or a focused neighboring endpoint module.
- [ ] Add typed operations client and workspace with Bulk Operations and Publications sections.
- [ ] Allow cancellation only for operations whose existing endpoint says `cancellable=true`; never show cancel for publish jobs.
- [ ] Add Operations nav entry.

### Task 3: Distribution Collection picker and application editing

**Files:**
- Modify: `apps/admin/src/components/applications/ApplicationViews.tsx`
- Create: `apps/admin/src/components/applications/CollectionAccessPicker.tsx`
- Test: `apps/admin/tests/unit/components/application-collection-picker.test.tsx`

**Interfaces:**
- `CollectionAccessPicker` loads `/api/admin/v1/collections`, displays title + slug + lifecycle, and returns an ordered unique set of selected Collection IDs.
- Application create continues to use `POST /api/admin/v1/applications`.
- Application edit uses existing `PATCH /api/admin/v1/applications/:id` with `If-Match`, `Idempotency-Key`, `X-Request-Id` and the loaded `revision`.

- [ ] Add failing tests proving the create form never requires a raw Mongo ID and sends selected IDs from the picker.
- [ ] Add editing test proving a Collection access change uses the loaded application revision.
- [ ] Replace raw Collection ID textarea with accessible checkbox/search picker.
- [ ] Add `Edit access` surface per application for Collection set and requests/minute; keep name/owner immutable in this first edit surface unless already supported safely.
- [ ] On `412`, reload applications and explain that the application changed on the server.

### Task 4: Product-level regression inventory

**Files:**
- Create: `docs/verification/2026-09-02-collections-admin-codex-gate.md`

- [ ] Record focused unit/integration commands for all files introduced by Collections Admin convergence.
- [ ] Record `npm run typecheck:admin`, `npm run build:admin`, existing publish integration tests, and the future UI E2E path.
- [ ] Explicitly mark runtime status as `NOT RUN IN CHAT ENVIRONMENT` rather than claiming pass/fail.
