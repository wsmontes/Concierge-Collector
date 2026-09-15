# Editorial Admin and Universal Record Access — Implementation Review

Date: 2026-09-14
Plan: `docs/Concierge Admin — Plano completo de CMS editorial e acesso universal aos dados.md`
State: implemented in the working tree, **not committed** (no commit/push was requested).

## Scope delivered

The Admin is now an exploration surface over the stored knowledge, not only an operational
console for Collections.

### Fase 0 — Foundation: universal content access

| File | Role |
|---|---|
| `src/content/field-types.ts` | Frozen vocabulary: `FieldType`, `FieldOwner`, `FieldDescriptor`, `FieldNode`, `inferFieldType`, `isFieldEditable`, `isContainerType`, `isStructuredType`. |
| `src/content/field-path.ts` | Addressing for arbitrary fields (`sources.audio[0].filename`), immutable `setFieldValue`/`removeFieldValue`, record-local search. |
| `src/content/value-guards.ts` | One canonical `isRecord`. |
| `src/content/record-inspector.ts` | `buildFieldTree`, `filterFieldTree`, `flattenFieldTree`, `declaredButAbsent`. |
| `src/content/field-registry.ts` | 24 Curation + 13 Entity + 12 Collection descriptors (labels, owners, derived/system classification, `filterable`). |
| `src/components/content/ContentFieldEditor.tsx` + `fields/*` | One editor per glyph: text, long text, number, boolean, dateTime, enum, structured (object/array/json/unknown), read-only. |
| `src/components/content/ContentFieldInspector.tsx` | The All Fields surface: field tree, search by name **or** value, declared-but-empty list, editor wiring. |

Guarantee, pinned by tests: **every stored key renders**. A field the registry never described
appears with `descriptor: null` and stays editable through the structured editor (plan §19/§45);
only registry-declared system fields (`version`, timestamps, `_id`, embeddings) are read-only, and
they say why.

### Fase 1 — Curations as a real CMS

- `/admin/curations` — editorial list: URL-as-state (`q`, `status`, `city`, `entity_type`,
  `curator_id`, `unlinked`, `concept.<Category>`, `where`, `sort`, `columns`, `cursor`), configurable
  columns, 8 sort orders, saved views that persist filters **+ sort + columns**, row click → preview
  drawer, and the untouched Gmail-like selection model (explicit ids or an all-matching intent that
  carries the concept facets, the advanced conditions and `unlinked`).
- `/admin/curations/<id>` — full record: header, About (derived `city`/`type` say
  `Derived from Entity` and link to the Entity), Your curation, Concepts (dynamic categories,
  "View N Curations with …"), Media & sources, transcript area, Collections, History,
  **All fields**, Advanced. Editing is per block; the PATCH body carries only the edited path's
  top-level root and the loaded `version`; a 409 keeps the draft and offers Reload.
- `/admin/explorer` remains a compatibility redirect for old deep links.

### Fase 2 — Entities

`/admin/entities` (derived city, filters, cursor paging, preview drawer, keyboard navigation) and
`/admin/entities/<id>` (canonical identity, location, contact, media, attributes, metadata,
**Curations about this Entity**, All fields, History; `entity_id` and `version` read-only).

### Fase 3 — Discovery

- **Global search palette (§6)**: mounted via `admin.components.providers`, so it is reachable from
  every screen. ⌘K / Ctrl+K and a visible trigger; debounced queries with an out-of-order-response
  guard; results grouped `ENTITIES` / `CURATIONS` / `COLLECTIONS`, human label first and any id
  demoted to secondary text; ArrowUp/ArrowDown/Enter navigation that opens
  `/admin/entities/<id>`, `/admin/curations/<id>` or `/admin/collections/collections/<id>`.
- **Advanced field search (§8)**: field / operator / value conditions on the Curations list, carried
  in the URL as repeated `where=<json>` and honoured by both the list and the all-matching selection
  intent. 15 operators; the value control follows the operator (none for
  `exists`/`not_exists`/`is_empty`/`is_not_empty`, number, date, enum, or a list for
  `contains_any`/`contains_all`).

### Fase 4 — Collections

- **Humanized members and draft diff (§24, §25)**: rows show restaurant name, curator,
  `type · city`, concept chips, status and `Updated`; raw ids and `operationId` live behind a
  collapsed `Technical details` per row. A member the catalog no longer knows renders
  `No longer in the catalog` instead of a blank cell.
- **Preview from a Collection (§12)** reuses the Curation preview drawer and keeps the way back to
  the Collection; a Relationships card reports the draft's Curation count plus the distinct Entities
  and Curators it represents, and says so explicitly when it only saw one bounded page.

### Fase 9 — Editorial dashboard (§37)

`admin.components.beforeDashboard` renders Content Health on `/admin`: total Curations, Unlinked,
Synthetic drafts, Without images, Without transcript, Updated today, Without Collections — each a
link to the most precise query that list can actually honour, with the two counters that are not
addressable from the list saying so instead of linking somewhere misleading. No invented quality
score, and no "processing errors" card because **no such stored signal exists** (verified, not
faked).

### Boundary (Admin ↔ FastAPI)

Additive only; the frozen contract grew 10 → **18 paths / 38 schemas / 3 security schemes**:

| Route | Purpose |
|---|---|
| `GET /catalog/curations/{id}/record` | Complete stored Curation document, JSON-safe, unknown keys preserved. |
| `GET /catalog/entities` | Entity page with derived city and per-page Curation counts (one aggregation). |
| `GET /catalog/entities/{id}/record` | Complete stored Entity document. |
| `GET /catalog/entities/{id}/curations` | Curations attached to an Entity. |
| `PATCH /catalog/curations/{id}` | `If-Match` + actor; system roots rejected 422, undeclared roots written. |
| `PATCH /catalog/entities/{id}` | Same lock/actor contract. |
| `POST /catalog/curations/summaries` | Batch ids → list rows, for humanizing Collections. |
| `POST /catalog/content-health` | Dashboard counters in one `$facet` aggregation. |
| `GET /catalog/curations` (extended) | `sort` allowlist (server default unchanged), `unlinked`, repeated `concept.<Category>`, repeated `where` — all shared with the scan path. |

Admin-side BFF: `/api/admin/v1/records/*` (records, summaries, content-health, search) behind the
same `collections_admin` guard as every other endpoint.

## Verification executed

| Command / surface | Result |
|---|---|
| `npm run verify` (repo release gate, 10 steps) | **passed** (final run, clean environment) |
| API unit selection | **578 passed, 1 skipped** |
| Admin unit suite | **546 passed** (101 files) |
| Admin production build | passed |
| `npm run check:contracts` | clean |
| `black --check` + `flake8 --max-line-length=120 --ignore=E203,W503` | clean |
| Playwright `tests/e2e/curations/keyboard.spec.ts` | **1 passed** — selection/keyboard semantics survived the Explorer→Curations cutover (run before the Fase 3/4/9 wave) |
| Boundary exercised with `curl` against real Mongo | record read; PATCH bumping `version` with `updatedBy` provenance; undeclared root key round-trips; stale `If-Match` → 409; `version` → 422; missing actor → 401 |
| Browser smoke (Mongo replica set + FastAPI + Admin + worker) | dashboard counters from live data; ⌘K palette (focus, debounce, grouping, keyboard navigation, navigation); advanced filter (clause in the URL, one matching row); **persisted selection intent carried `{"where":[{"field":"restaurant_name","op":"contains","value":" 2"}]}` and the worker materialized exactly 1 Curation — no over-selection**; humanized draft diff (`ADDED 2` with names, ids collapsed); mobile 390 px on dashboard, palette and list: zero horizontal overflow |
| Admin integration suite (local replica set) | 3 failures, all in `publish-concurrency` / `selection-manifest` — reproduced identically (4 failures) on a pristine HEAD worktree, so pre-existing |

## Defects found and fixed

`main` was **red** before this work; the previous Admin UI branch was merged without executable
verification.

1. `InlineNotice` (`tone="warning"`) failed `typecheck` — Payload's `Banner` has no warning tone.
2. 13 admin unit files failed at import: `@payloadcms/ui` ships raw CSS and Node cannot load it.
3. Two stale test queries left by that merge (a dialog and a page action both named "Create Collection"; `closest('section')` in the Explorer test) — plus the same ambiguity in the Collections E2E spec.
4. Entity rows derived `city` from `data.city` only, and did not even project the canonical field; now follows the domain's documented chain.
5. **Every date in the Admin was shifted by the viewer's UTC offset**: BSON datetimes come back naive and serialized without an offset ("in 7 hours" for a record just updated). Normalized at both CMS serialization boundaries.
6. The published scan contract made `sort` required, breaking every existing caller; now optional with the server default unchanged.
7. The Curation detail page's default loader imported names its own module does not export — it would have crashed in the browser while its injected-loader tests passed.
8. Whitespace-only `q` reached the boundary instead of meaning "no query".
9. **The ⌘K palette was mounted inside the navigation subtree**, which Payload marks `inert` while the sidebar is closed: the palette opened but could never receive focus or a keystroke (measured in a real browser at 390 px *and* 1440 px, with `inert` confirmed on an ancestor). Moved to `admin.components.providers`; a unit test could not have caught this.
10. Duplicated vocabulary (two `DEFAULT_CURATION_SORT`, a local `FLEXIBLE_TYPE` table) consolidated into one definition.

## Findings deliberately not fixed

- **`draftSelectedCount` is only maintained for `mode: 'selection'` operations.** `apply-draft-operation.ts` increments it on the selection path; an *explicit*-mode "add" commits the change (item `applied`, `draftRevision` +1, change `committed`) while the counter stays put, so the header can read "0 selected" with Curations in the draft. Measured both ways on the live stack: the selection-mode operation produced "1 selected" and the explicit-mode one did not. The file is untouched by this change set and a correct fix needs the draft-delta semantics (re-adding an existing member must not increment). Reported, not silently patched.
- **Curations have no version snapshots**, so History shows authorship and version and says that no comparison exists — the plan's field-level diff (§46) is only realizable once snapshots exist. The Collections side does have versions, and its draft diff is now humanized.
- **Pre-existing integration failures**: `publish-concurrency.int.test.ts` (2) and `selection-manifest.int.test.ts` (2) fail against a local Mongo, identically on a pristine HEAD worktree.
- `verify:full` was not run end to end; the two relevant specs were run individually instead, and the stack used for the smoke carries seeded/E2E data in its `-test` databases.
- `@payloadcms/ui` is still consumed transitively rather than declared in `apps/admin/package.json` (pre-existing); promoting it requires regenerating `package-lock.json`.
- Not built: media thumbnails/originals (no media-serving boundary exists — the Media section renders stored metadata instead of inventing URLs), curator reassignment (no user-directory endpoint; the field is read-only with that reason), Entity "Collections" column and the "Without Collections" list filter (both need the CMS-side membership join exposed as a list query).

## Local stack notes

- The CMS repository requires a **replica set**: audit/lifecycle writes run in a transaction, and a standalone `mongod` answers `transactionUnsupported` → every audited command returns 503.
- FastAPI needs `CMS_ADMIN_ORIGIN` and `CMS_ADMIN_CALLBACK_URL`; absent, the handoff loops with `ERR_TOO_MANY_REDIRECTS` (the 307 `Location` is relative).
- Session for a browser: `GET /api/v3/auth/dev-login` (sets `access_token`), then `/auth/start?return_to=…`.
- Drop `concierge-cms-test` before `payload migrate` if a previous boot created Mongoose-default indexes (`IndexOptionsConflict`).
- Stop the local stack before `npm run verify`: the Collector suite's live tests otherwise execute against a dirty `-test` database and fail.
