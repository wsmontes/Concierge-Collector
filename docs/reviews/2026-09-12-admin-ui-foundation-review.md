# Admin UI Professional Foundation — Implementation Review

Date: 2026-09-12
Branch: `feat/admin-ui-professional-foundation-20260912`
PR: #11

## Scope delivered

This branch converges the operational Admin on a Payload-native visual foundation without changing domain contracts, persistence, API routes or asynchronous job semantics.

Implemented:

- Added shared semantic components: `AdminPage`, `AdminSection`, `StatusPill`, `EmptyState`, and `InlineNotice`.
- Reused Payload Admin primitives from `@payloadcms/ui` for buttons, pills and banners.
- Migrated Collections list and Collection detail controls to the shared hierarchy.
- Migrated the Collection Overview to professional status, notice and action primitives.
- Migrated Curation Explorer command hierarchy while preserving virtualization and server-side all-matching selection.
- Migrated Operations status, empty/error states and commands while preserving polling, cancellation and pagination.
- Migrated Consumer Applications and credential management to the same page, section, status and command language.
- Added focused unit tests for the shared UI foundation and Applications UI states; preserved existing workflow tests.
- Kept the recently repaired Payload navigation shell unchanged to avoid reopening the sidebar integration defect fixed on `main`.

## Architecture preserved

No changes were made to:

- Collections API contracts or revision/If-Match semantics.
- Collection draft, publish, restore or version behavior.
- Explorer filter contract, virtual table, server selection manifests or bulk-operation endpoints.
- Operations polling, cancellation or pagination behavior.
- Consumer application/credential API contracts.
- Payload collections, Mongo schemas, FastAPI routes, feature flags, jobs or Collector behavior.

## Static review findings addressed

During the final code review two legacy CSS specificity conflicts were found and fixed:

1. Global `.curation-explorer form` styles forced the new Explorer filter surface back to `display:flex`. `explorer-admin.css` now explicitly isolates `form.explorer-filter-form` as a grid.
2. Global `.application-views form` styles forced the new Applications form to `max-width: 600px`. `distribution-admin.css` now explicitly isolates `form.application-views__form` and restores the professional full-width layout.

The branch remains based directly on the current `main` merge base used for this work and the implementation diff is limited to Admin UI code, Admin tests, and design/review documentation.

## Verification status

Automated execution is **not verified in this session**.

This is not a newly broken workflow trigger. Repository history shows that GitHub Actions was deliberately shut down because billing caused runs to fail almost immediately:

- `fff0fa2` — `chore(ci): remove workflows do GitHub Actions (billing travado)` records that Actions was disabled and workflows deleted, moving tests/lint to local execution.
- `c048a24` — removes the GitHub Actions quality workflow.
- `c8923d8` — removes the GitHub Actions image-build workflow.

The current `main` has no `.github/workflows/` directory, so feature commits correctly produce no workflow runs or commit statuses. Recreating workflow YAML without first resolving/re-enabling the account/repository Actions billing state would not provide useful verification.

The local command executor available to this session also failed before it could access a workspace. Therefore this review does not claim that tests, typecheck, lint, or build pass.

Before merge, run from the repository root in a real workspace:

```bash
npm ci
npm run test:admin
npm run typecheck:admin
npm run lint:admin
npm run build:admin
```

For a broader release gate, also run:

```bash
npm run verify
```

Keep PR #11 in draft until those commands complete successfully.

## Dependency note

The new custom Admin components import `Button`, `Pill`, and `Banner` from `@payloadcms/ui`, which is the supported Payload Admin import path. The current root lockfile already contains `@payloadcms/ui@3.86.0` transitively through the Payload stack, but `apps/admin/package.json` does not declare it directly.

Do not edit only `apps/admin/package.json` in this branch without regenerating `package-lock.json`. On the next local dependency-install pass, promote `@payloadcms/ui` to a direct Admin dependency at the same Payload version and commit the regenerated lockfile together:

```bash
npm install @payloadcms/ui@3.86.0 --workspace=@concierge/admin
```

Then rerun the five verification commands above.

## Residual UX debt — deliberately not hidden inside this refactor

1. `CollectionAccessPicker` still exhausts Collection pages into the browser before filtering. It should eventually become server-search/infinite-load if Collection count grows materially.
2. Explorer `Curator ID` and `Entity type` remain contract-compatible text inputs. A discovery/autocomplete endpoint would improve operator usability without changing this UI foundation.
3. The Payload sidebar was deliberately not restyled in this branch. `main` had just fixed its `NavWrapper`/hamburger/active-route integration, so visual shell changes should be a separate, smaller PR after this foundation is verified.
4. Dialog primitives are still mixed: some existing domain dialogs remain custom overlays. A later pass can converge them on Payload Modal/Drawer primitives once regression coverage includes focus trapping, Escape handling, and focus restoration.
5. Responsive styling was improved in code but still needs browser/device visual QA after a successful local build.

## CI restoration note

Treat CI restoration as a separate infrastructure task from this UI PR. The prerequisite is to confirm the GitHub Actions billing/account state and repository Actions permission, then decide which quality gate should be restored. Only after that should workflow files be reintroduced. Restoring old YAML first would address the symptom, not the recorded root cause.

## Merge recommendation

Do not merge yet. The implementation is ready for executable verification, but there is currently no fresh test/typecheck/lint/build evidence for the head commit. Once the local verification commands pass and the direct `@payloadcms/ui` dependency is committed with a synchronized lockfile, this branch can move from draft to review/merge consideration.
