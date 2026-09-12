# Professional Admin UI Foundation — Design

## Goal

Converge the Concierge Admin into a professional operations interface without replacing Payload, duplicating its admin framework, or changing Collections/Explorer/Operations domain contracts.

## Decision

Use **Payload as the admin framework and `@payloadcms/ui` as the primary UI primitive layer**. Use shadcn-admin only as a visual/product reference for information density, sidebar hierarchy, page headers, toolbars, cards and status treatment. Do not add Tailwind, Radix, React-Admin or Refine to this app.

## Why

The current Admin already has the difficult product architecture: versioned Collections, draft/publish workflows, server-side all-matching selections, virtualized Curation browsing, asynchronous jobs, distribution applications and credentials. Replacing Payload would recreate authentication, routing, admin context and component infrastructure while adding a second abstraction layer.

The weak point is visual consistency: pages independently create native buttons, tables, status text, empty states, alerts and layout CSS. That makes a sophisticated operations product look like unrelated custom forms.

## Architecture

### 1. Payload-native shell

Keep the existing `NavWrapper`/Payload navigation integration and active-route behavior. Replace hand-built navigation grouping where safe with Payload-aware primitives, while retaining the current working shell classes and responsive behavior.

### 2. Thin Concierge UI vocabulary

Create reusable semantic components under `apps/admin/src/components/ui/`:

- `AdminPage`: consistent max-width, eyebrow, title, description and action area.
- `AdminSection`: titled operational section with optional description/action.
- `StatusPill`: maps Concierge lifecycle/job states to Payload `Pill` semantics.
- `EmptyState`: consistent no-data state with optional action.
- `InlineNotice`: status/error/success messaging with a stable visual hierarchy.

These components own Concierge semantics; visual primitives come from `@payloadcms/ui`.

### 3. Collections

Preserve all filtering, loading, creation and navigation behavior. Replace native action controls/status strings with Payload Buttons/Pills and migrate the table surface to a denser professional presentation. Lifecycle and draft state must be scannable without reading raw strings.

### 4. Explorer

Preserve the virtualized table and server-side selection architecture. Improve the command surface, filter hierarchy and selected-state affordance. Keep the custom virtualized table because Payload's normal Table is not designed for the Explorer's tens-of-thousands virtualized viewport.

`Curator ID` and `Entity type` remain contract-compatible text filters in this phase; autocomplete/discovery requires separate backend endpoints and is intentionally not faked in the UI.

### 5. Operations

Preserve polling, cancellation and pagination. Replace raw status labels and loose cards with consistent status pills, section hierarchy and primary/secondary action semantics.

### 6. Applications

Keep the existing workflow compatible with the new shared page/notice/status vocabulary. A deeper Applications redesign is deferred until the Collection/Explorer/Operations foundation proves stable.

## Visual rules

- One primary action per page region.
- Destructive actions use Payload error styling where applicable.
- Status is represented by text plus semantic pill styling, never color alone.
- Default content width is approximately 1200–1280px; data-heavy Explorer may use wider space.
- Controls keep a minimum 40px target where existing accessibility rules require it.
- Keep olive/limestone brand tokens; do not copy shadcn-admin colors.
- Avoid a second CSS framework.
- Avoid bespoke primitive implementations when Payload exposes the same primitive.

## Compatibility constraints

- No API route changes.
- No Mongo/Payload schema changes.
- No feature-flag changes.
- No changes to Curation selection semantics, virtualisation, draft revision, publish polling or operation cancellation.
- Node/Payload/Next/React versions remain pinned as currently configured.
- Collector design tokens remain the shared color source.

## Testing

Add focused unit tests for the new semantic UI layer and update existing component tests to assert behavior through accessible labels/roles rather than incidental DOM structure. Existing Admin unit/integration/typecheck/build gates remain authoritative.

## Rollout

Implement on an isolated feature branch. Migrate shared foundation first, then Collections, Explorer and Operations. Do not merge until Admin tests/typecheck/build are green in an environment capable of running the repository.