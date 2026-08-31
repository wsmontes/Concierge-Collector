# Curation Authoring Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Collector curation editor around curator input first, with Entity as context, automation as the default structuring layer, and Concepts/transcript/technical actions demoted to review and exception paths.

**Architecture:** Add a focused `CurationWorkspaceModule` as the progressive orchestration boundary for the current legacy editor. The first vertical slice preserves all existing DOM IDs and persistence handlers, then rearranges/relabels the surface at runtime so recording/photo/text capture is primary without breaking the current `ConceptModule`, `RecordingModule`, `RestaurantModule`, IndexedDB or sync contracts. Subsequent tasks move state-sensitive behavior into the workspace boundary while leaving compatibility adapters in place.

**Tech Stack:** Vanilla JavaScript, DOM APIs, Vitest + jsdom, existing Tailwind/design-system CSS, Dexie/IndexedDB, current Collector modules.

**Spec:** `docs/superpowers/specs/2026-08-29-curation-authoring-workspace-design.md`

## Global Constraints

- Preserve `Curation.entity_id` optionality and valid orphan authoring.
- Preserve `restaurant_name` storage for provenance/fallback; linked display identity comes from `Entity.name`.
- Preserve synthetic → human takeover semantics; simply viewing a synthetic curation must not transfer ownership.
- Preserve human → human ownership protection and duplicate/new-curation path.
- Preserve offline-first draft/sync behavior and existing optimistic/version semantics.
- Preserve Collection membership by `curation_id`.
- Do not require Entity resolution before curator input.
- Do not make curator edit canonical Entity metadata inside Curation authoring.
- New input must remain saved even when analysis/transcription fails; derived processing failure is not input loss.
- Manual concept editing is an exception path, not the default surface.

---

### Task 1: State model and workspace boundary

**Files:**
- Create: `scripts/modules/curationWorkspaceModule.js`
- Create: `tests/test_curationWorkspaceModule.test.js`

**Interfaces:**
- Produces: `window.CurationWorkspaceModule`
- Produces: `CurationWorkspaceModule.deriveState(curation, entity) -> { linkage, authorship, key }`
- Produces: `workspace.refresh({ curation?, entity? })`
- Consumes: `window.uiManager`, `window.ApiService`, local Dexie entity cache when available.

- [ ] **Step 1: Write failing tests** for orphan-human, linked-human, linked-synthetic and orphan-synthetic state derivation; verify linked state uses entity canonical name and orphan uses `restaurant_name`.
- [ ] **Step 2: Run** `npm run test:collector -- tests/test_curationWorkspaceModule.test.js` and verify failure because the module does not exist.
- [ ] **Step 3: Implement minimal state derivation** with no DOM mutation beyond constructor wiring.
- [ ] **Step 4: Run the focused test** and verify pass.
- [ ] **Step 5: Commit** `feat(curations): add authoring workspace state model`.

### Task 2: Input-first DOM composition

**Files:**
- Modify: `scripts/modules/curationWorkspaceModule.js`
- Create: `styles/curation-workspace.css`
- Modify: `index.html`
- Extend: `tests/test_curationWorkspaceModule.test.js`

**Interfaces:**
- Produces: workspace sections with stable IDs `curation-workspace-about`, `curation-workspace-capture`, `curation-workspace-content`, `curation-workspace-concepts`, `curation-workspace-sources`, `curation-workspace-advanced`.
- Reuses existing field/control IDs: `restaurant-name`, `take-photo`, `gallery-photo`, `camera-input`, `gallery-input`, `restaurant-description`, `curation-notes-public`, `curation-notes-private`, `concepts-container`, `restaurant-transcription`, `reprocess-concepts`, `clone-curation`, `export-curation-json`.

- [ ] **Step 1: Add DOM tests** asserting the canonical section order and that existing controls are reparented rather than cloned.
- [ ] **Step 2: Verify failure** with focused Vitest.
- [ ] **Step 3: Implement `compose()`** to remove the old editor section nav from the active UX, create the six semantic sections, and move existing nodes without changing their IDs.
- [ ] **Step 4: Add CSS** making About/Capture immediately visible, secondary sections lower-density, and mobile single-column.
- [ ] **Step 5: Wire module in `index.html`** after `restaurantModule.js`/`entityModule.js` and before `main.js`.
- [ ] **Step 6: Run focused tests + `npm run build:collector:check`**.
- [ ] **Step 7: Commit** `feat(curations): compose input-first authoring workspace`.

### Task 3: Entity context vs orphan working identity

**Files:**
- Modify: `scripts/modules/curationWorkspaceModule.js`
- Extend: `tests/test_curationWorkspaceModule.test.js`

**Interfaces:**
- Produces: `resolveEntity(entityId, suppliedEntity?) -> Promise<Entity|null>` with fallback supplied → local Dexie → `ApiService.getEntity`.
- Produces: read-only linked Entity card and editable orphan working-name surface.

- [ ] **Step 1: Add tests** for fallback order, linked read-only canonical identity, hidden Places/location/entity metadata in linked curation context, and orphan working name visibility.
- [ ] **Step 2: Verify failure**.
- [ ] **Step 3: Implement resolver and renderer** using `textContent`/safe DOM APIs only.
- [ ] **Step 4: Add `View entity` navigation** through NavigationManager when available; fallback to current Entity UI path.
- [ ] **Step 5: Verify focused tests**.
- [ ] **Step 6: Commit** `feat(curations): separate entity context from curation identity`.

### Task 4: Unified capture tools

**Files:**
- Modify: `scripts/modules/curationWorkspaceModule.js`
- Extend: `styles/curation-workspace.css`
- Extend: `tests/test_curationWorkspaceModule.test.js`

**Interfaces:**
- Produces: primary button `#curation-record-review` labelled `Record your review` or `Record more`.
- Consumes the existing additional recording mechanics (`ConceptModule.setupAdditionalReviewButton`, `#additional-record-start`, `RecordingModule.startRecording`) as a compatibility layer.

- [ ] **Step 1: Add tests** that record CTA is first/primary, photos are adjacent capture actions, and CTA delegates to existing recording path without duplicating record controls.
- [ ] **Step 2: Verify failure**.
- [ ] **Step 3: Implement unified CTA** that ensures the legacy recorder exists, moves its live controls into Capture, suppresses legacy `Record Additional Review` copy, and triggers the same recording pipeline.
- [ ] **Step 4: Ensure input survives processing failure** by never removing accepted photos/audio on analysis errors; only status messaging changes.
- [ ] **Step 5: Verify focused tests**.
- [ ] **Step 6: Commit** `feat(curations): make recording and photos primary capture tools`.

### Task 5: Concepts review-first and sources/history

**Files:**
- Modify: `scripts/modules/curationWorkspaceModule.js`
- Extend: `styles/curation-workspace.css`
- Extend: `tests/test_curationWorkspaceModule.test.js`

**Interfaces:**
- Produces: `#curation-concepts-summary`, `#curation-review-concepts`, `#curation-manual-concepts`.
- Produces: collapsed `Sources & history` disclosure containing transcript and manual reprocess.

- [ ] **Step 1: Add tests** that concept editor is collapsed by default, summary count updates after concept render, review expands current concepts, and manual controls are not primary.
- [ ] **Step 2: Verify failure**.
- [ ] **Step 3: Implement review-first wrapper** around the existing concept container using a MutationObserver to keep counts current without replacing `ConceptModule` logic.
- [ ] **Step 4: Move transcript + `Reprocess Concepts` into collapsed Sources & History** and relabel reprocess as `Analyze again` in the workspace surface.
- [ ] **Step 5: Verify focused tests**.
- [ ] **Step 6: Commit** `feat(curations): make concepts and transcript review surfaces`.

### Task 6: Synthetic curation authoring state

**Files:**
- Modify: `scripts/modules/curationWorkspaceModule.js`
- Extend: `styles/curation-workspace.css`
- Extend: `tests/test_curationWorkspaceModule.test.js`

**Interfaces:**
- Produces: synthetic banner in About/Capture without calling PATCH or changing curator ownership.
- Human write continues through existing save endpoint, which owns takeover semantics.

- [ ] **Step 1: Add tests** that synthetic banner appears, CTA becomes `Record your expert review`, render performs no network write, and save wiring is not replaced.
- [ ] **Step 2: Verify failure**.
- [ ] **Step 3: Implement banner/copy and CTA variant** only.
- [ ] **Step 4: Verify focused tests**.
- [ ] **Step 5: Commit** `feat(curations): surface synthetic drafts for human enrichment`.

### Task 7: Compatibility hooks and regression coverage

**Files:**
- Modify: `scripts/modules/curationWorkspaceModule.js`
- Extend: `tests/test_curationWorkspaceModule.test.js`
- Add/modify static contract test if needed: `tests/test_index_script_order.test.js`

**Interfaces:**
- Workspace refreshes after `RestaurantModule.editCuration`, `resetCurationForm`, `populateCurationData`, and Entity context changes without changing the public call signatures.

- [ ] **Step 1: Add compatibility tests** for repeated open/close/reopen, no duplicate sections/listeners, linked→orphan transition, and curation A→curation B transition.
- [ ] **Step 2: Verify failure**.
- [ ] **Step 3: Implement idempotent hooks** by wrapping existing public methods only after the classes are loaded; preserve return values/promises.
- [ ] **Step 4: Run `npm run build:collector:check`, `npm run lint:collector`, focused tests, then full `npm run test:collector`**.
- [ ] **Step 5: Commit** `test(curations): harden authoring workspace compatibility`.

### Task 8: Follow-up module ownership cleanup

**Files:**
- Modify: `scripts/modules/conceptModule.js`
- Modify: `scripts/modules/restaurantModule.js`
- Modify: `scripts/modules/curationWorkspaceModule.js`
- Extend: `tests/test_curationWorkspaceModule.test.js`

**Interfaces:**
- `CurationWorkspaceModule` becomes owner of general editor orchestration.
- `ConceptModule` remains owner of concept extraction/render/manual concept editing.
- `RestaurantModule` remains compatibility adapter for existing callers during this phase.

- [ ] **Step 1: Add tests** proving workspace owns capture DOM and general editor refresh while ConceptModule still updates concepts.
- [ ] **Step 2: Verify failure before cleanup**.
- [ ] **Step 3: Remove `setupAdditionalReviewButton()` invocation from general `ConceptModule.setupEvents`; expose/retain the recording helper only as compatibility callable from workspace.
- [ ] **Step 4: Stop `RestaurantModule.populateEntityDetails` from presenting linked identity as an editable Curation name; let workspace render canonical linked context.
- [ ] **Step 5: Run full Collector quality suite**.
- [ ] **Step 6: Commit** `refactor(curations): move editor orchestration into workspace`.

### Task 9: PR verification and product acceptance

**Files:** none unless fixes are required.

- [ ] **Step 1: Open/update PR** from `design/curation-authoring-workspace` to `main` so `.github/workflows/quality.yml` runs.
- [ ] **Step 2: Require collector job** (`build:collector:check`, lint, Vitest) green; inspect other required jobs for unrelated failures.
- [ ] **Step 3: Review diff for schema/API ownership drift**; there should be none unless explicitly documented.
- [ ] **Step 4: Verify final acceptance cases:** orphan capture without Entity; linked Entity context; synthetic no-write-on-view; record/photo primary; concepts secondary; transcript/Analyze again secondary; mobile section order; repeated editor navigation no duplication.
- [ ] **Step 5: Update spec status and plan checkboxes** with implemented commit SHAs.
