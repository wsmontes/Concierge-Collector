# Professional Admin UI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Admin's hand-built visual primitives with a small Payload-native professional UI foundation while preserving all existing business behavior.

**Architecture:** Payload remains the Admin framework. Shared Concierge semantic components wrap `@payloadcms/ui` primitives, and the existing Collections/Explorer/Operations workflows are migrated to those components without changing API contracts, persistence or async job behavior.

**Tech Stack:** Payload 3.86.0, `@payloadcms/ui` through the installed Payload stack, Next.js 16.2.12, React 19.2.6, TypeScript 5.9.3, Vitest/Testing Library, existing design tokens.

**Spec:** `docs/superpowers/specs/2026-09-12-admin-ui-professional-foundation-design.md`

## Global Constraints

- Do not introduce Tailwind, shadcn/ui, Radix, React-Admin or Refine dependencies.
- Do not change API routes, Mongo schemas, feature flags or domain semantics.
- Preserve Explorer virtualization and server-side all-matching selection.
- Preserve Collections draft/publish/revision behavior.
- Preserve Operations polling/cancellation/pagination behavior.
- Use Payload UI primitives for buttons/status surfaces when available.
- Keep olive/limestone design tokens and current accessibility focus/touch rules.

---

### Task 1: Add the shared semantic Admin UI layer

**Files:**
- Create: `apps/admin/src/components/ui/AdminPage.tsx`
- Create: `apps/admin/src/components/ui/StatusPill.tsx`
- Create: `apps/admin/src/components/ui/EmptyState.tsx`
- Create: `apps/admin/src/components/ui/InlineNotice.tsx`
- Create: `apps/admin/tests/unit/components/admin-ui-foundation.test.tsx`
- Modify: `apps/admin/src/styles/admin.css`

**Interfaces:**
- Produces `AdminPage`, `AdminSection`, `StatusPill`, `EmptyState`, `InlineNotice`.

- [ ] **Step 1: Write failing unit tests**

Test that `AdminPage` renders eyebrow/title/description/actions, `StatusPill` maps `published|dirty|failed|active|completed|archived` to stable accessible text, and `InlineNotice` exposes `role=alert` only for error tone.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm run test:admin -- --run tests/unit/components/admin-ui-foundation.test.tsx`
Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Implement the semantic components**

Use `Button`/`Pill` only from `@payloadcms/ui`; keep wrappers thin and free of business fetching/state.

- [ ] **Step 4: Run focused test and typecheck**

Run:
`npm run test:admin -- --run tests/unit/components/admin-ui-foundation.test.tsx`
`npm run typecheck:admin`
Expected: PASS.

---

### Task 2: Make the shell use Payload navigation primitives consistently

**Files:**
- Modify: `apps/admin/src/components/shell/CmsNavLinks.tsx`
- Modify: `apps/admin/src/styles/admin.css`
- Modify/Test: existing navigation unit tests under `apps/admin/tests/unit/components/`

**Interfaces:**
- Consumes existing `CMS_NAV_GROUPS` and `isNavItemActive`.
- Preserves current URLs and active-route semantics.

- [ ] **Step 1: Add a regression test for grouped navigation and active item semantics**
- [ ] **Step 2: Confirm the test fails against the intended Payload `NavGroup` structure**
- [ ] **Step 3: Render groups through `NavGroup` while preserving `nav__link` and active indicators**
- [ ] **Step 4: Run nav tests and typecheck**

---

### Task 3: Migrate Collections workspace to the professional foundation

**Files:**
- Modify: `apps/admin/src/components/collections/CollectionsWorkspace.tsx`
- Modify: `apps/admin/src/styles/collections-admin.css`
- Modify: `apps/admin/tests/unit/components/collections-workspace.test.tsx`

**Interfaces:**
- Keeps `CollectionsAdminClient` unchanged.
- Keeps filters, creation dialog, reload and navigation unchanged.

- [ ] **Step 1: Add tests for semantic status pills, page header and empty/error states**
- [ ] **Step 2: Confirm RED**
- [ ] **Step 3: Replace raw header/buttons/status strings with `AdminPage`, Payload `Button`, `StatusPill`, `EmptyState`, `InlineNotice`**
- [ ] **Step 4: Keep the data table semantic HTML but simplify CSS to a professional dense table; do not replace it with a non-virtual abstraction**
- [ ] **Step 5: Run Collections component tests and typecheck**

---

### Task 4: Improve Explorer command hierarchy without touching selection architecture

**Files:**
- Modify: `apps/admin/src/components/explorer/CurationExplorer.tsx`
- Modify: `apps/admin/src/components/explorer/ExplorerFilterForm.tsx`
- Modify: `apps/admin/src/components/explorer/SelectionToolbar.tsx`
- Modify: `apps/admin/src/styles/explorer-admin.css`
- Modify: `apps/admin/tests/unit/components/explorer-filter-form.test.tsx`
- Modify: existing Explorer selection tests

**Interfaces:**
- Keeps `CurationFilters`, `SelectionState`, virtualization and selection endpoints unchanged.

- [ ] **Step 1: Add tests for page semantics, primary selection action and filter grouping**
- [ ] **Step 2: Confirm RED**
- [ ] **Step 3: Use `AdminPage`, Payload `Button`, `Pill` and shared notices while keeping the virtual table**
- [ ] **Step 4: Improve filter grouping/copy but keep `Curator ID` and `Entity type` contract-compatible text inputs**
- [ ] **Step 5: Run Explorer tests and typecheck**

---

### Task 5: Migrate Operations to the shared professional language

**Files:**
- Modify: `apps/admin/src/components/operations/OperationsWorkspace.tsx`
- Modify: `apps/admin/src/styles/operations-admin.css`
- Modify: existing Operations component tests

**Interfaces:**
- Keeps `OperationsAdminClient` unchanged.
- Keeps polling, cancellation and pagination unchanged.

- [ ] **Step 1: Add tests for semantic status rendering and section/empty states**
- [ ] **Step 2: Confirm RED**
- [ ] **Step 3: Replace raw status spans/buttons with shared foundation and Payload primitives**
- [ ] **Step 4: Run Operations tests and typecheck**

---

### Task 6: Verify compatibility and document remaining UX debt

**Files:**
- Create: `docs/reviews/2026-09-12-admin-ui-foundation-review.md`

- [ ] **Step 1: Run Admin unit suite**
Run: `npm run test:admin`

- [ ] **Step 2: Run typecheck/lint/build**
Run:
`npm run typecheck:admin`
`npm run lint:admin`
`npm run build:admin`

- [ ] **Step 3: Record results and residual items**
Document autocomplete/discovery for curator/entity-type, Applications deeper redesign, responsive/mobile review, and any verification blocked by environment.

- [ ] **Step 4: Commit and open a draft PR for review**
