# Concierge Architecture Convergence Baseline

**Date:** 2026-08-30
**Status:** implementation candidate; full-stack qualification pending

## Goal

Converge the modern Concierge architecture before adding another major feature. The target is a reproducible Architecture Baseline 1 where security, semantic retrieval, Collections publication, offline authoring and release qualification have explicit boundaries and failure behavior.

This work continues on top of the current `main` architecture and the Curation Authoring Workspace. It ports valid intent and regression coverage from older hardening work, but does **not** transplant stale branch history or regress current domain semantics.

## Constraints

- No GitHub Actions CI; verification is local through `npm run verify` and `npm run verify:full`.
- Preserve the current domain split: Entity = world object; Curation = curator perspective; Collection = intentional selection.
- Preserve orphan Curation authoring and `entity_id` as the linkage truth.
- Preserve Capture confirmation semantics introduced on 2026-08-30: new human Curations start in workflow status `draft`, linkage is represented by `entity_id`, and audio provenance keeps the Capture source id.
- Preserve offline-first durability. Refactoring may remove wrapper chains, but must not weaken draft/media persistence or ownership protection.
- Server-side authorization remains authoritative. Client role state is presentation-only.
- Full integration, browser and production-environment qualification will be executed from a real checkout after this implementation; the branch remains draft until that evidence exists.

## Workstreams

### 1. Authentication and paid-provider hardening

Converge the still-relevant security work from PR #4 onto the current branch:

- atomic single-use refresh rotation;
- browser-bound, one-shot OAuth state with PKCE verifier kept server-side;
- production callback origin isolation;
- stop storing Google OAuth refresh credentials in operational user documents;
- live Mongo authorization/role revalidation at protected and paid-provider boundaries;
- stable rate-limit identity across access-token rotation and Bearer/cookie transports;
- safe cross-site logout/refresh fallback behavior;
- generic external-provider/server error responses;
- deterministic first-login identity and dry-run-first identity-index migration tools;
- Capture paid-work lease/idempotency where it can be introduced without regressing the current Capture domain contract.

### 2. Semantic retrieval correctness

The existing fallback ranks only a recency-bounded subset when Atlas Vector Search cannot index the packed Binary vectors. This silently loses recall as the catalog grows.

Baseline behavior is correctness-first:

- configured Atlas Vector Search remains the fast path;
- if that path is unavailable, fallback must consider every eligible Curation instead of the most recent `candidate_limit` records;
- fallback ranking must be streaming/bounded-memory where practical;
- logs/diagnostics must expose when exhaustive fallback is used and how many candidates were scanned;
- no silent recency bias is allowed.

A future native vector representation/index may replace the exhaustive fallback, but correctness is required now.

### 3. Collections qualification and worker recovery

`verify:full` is the qualification entry point. It must fail clearly when the integration stack is missing rather than silently skip high-value tests.

Add deterministic coverage for worker/publish recovery so the system proves:

- an interrupted/expired lease can be reclaimed;
- retry does not create duplicate versions or double-promote publication;
- the published version remains stable while a later draft is processed;
- archive/restore keeps the exact published version;
- qualification documentation tells the operator how to run the stack and what evidence to capture.

### 4. Collector authoring orchestration

The current progressive migration is valid, but multiple modules wrap `UIManager.editCuration` and depend on installation order. Baseline 1 introduces a single authoring entry boundary.

The first convergence step is intentionally narrow:

- one controller owns the outer `editCuration` interception;
- ownership policy and durability become explicit collaborators instead of independent outer wrappers;
- existing module APIs and DOM IDs remain compatible;
- no framework rewrite and no broad UI redesign;
- the controller is small enough to test independently.

Further save/discard/capture orchestration can migrate behind the controller later without another big-bang rewrite.

### 5. Documentation and repository governance

- Rewrite the root README around the actual monorepo and current product architecture.
- Record Architecture Baseline 1, boundaries, invariants, operational gates and deferred decisions.
- Treat synthetic-Curation modeling as a documented future decision, not a migration in this sprint.
- Close stale PRs only after their still-valid work has been either ported or explicitly superseded.
- Keep the convergence PR draft until the full local qualification passes in a real checkout.

## Definition of done for the candidate branch

The implementation branch contains all baseline code, regressions and runbooks, and passes every verification that can be executed in the current environment. Any check requiring the complete local stack is explicitly listed for final qualification.

The baseline becomes releasable only after a real checkout runs:

```bash
npm run verify
npm run verify:full
```

plus the documented Mongo identity audits/migrations and production-environment smoke checks that are applicable to deployment.
