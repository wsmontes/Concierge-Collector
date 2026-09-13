# GitHub Actions — Root Cause Note

Date: 2026-09-12

## Current state

`main` has no `.github/workflows/` directory, so pushes and pull requests do not have any workflow to trigger.

This is intentional historical state, not a newly introduced workflow-discovery bug.

## Evidence from repository history

- `fff0fa2` — `chore(ci): remove workflows do GitHub Actions (billing travado)`
  - records that GitHub Actions was disabled at repository level;
  - records that runs were failing in roughly three seconds because of billing;
  - deletes workflows and moves tests/lint to local execution.
- `c048a24` — `chore(ci): remove GitHub Actions quality workflow`.
- `c8923d8` — `chore(ci): remove GitHub Actions image build workflow`.

The current Contents API returns 404 for `.github/workflows/` because the directory does not exist.

## Root cause

The missing CI signal is downstream of the recorded GitHub Actions billing/account state and the deliberate removal/disablement that followed. Recreating workflow YAML before resolving that prerequisite would restore files but not the execution capability that was removed because runs could not start successfully.

## Safe restoration sequence

1. Confirm the GitHub account/organization Actions billing state is healthy.
2. Confirm Actions is enabled for `wsmontes/Concierge-Collector` in repository settings.
3. Reintroduce one minimal quality workflow first, limited to deterministic validation:
   - install with `npm ci`;
   - `npm run test:admin`;
   - `npm run typecheck:admin`;
   - `npm run lint:admin`;
   - `npm run build:admin`.
4. Open a test PR and verify the workflow reaches a runner and executes all steps.
5. Only then consider restoring broader Collector/Python/image-build gates.
6. Add required branch checks after the quality workflow is stable.

## Non-goal

Do not restore the previous image-build workflow merely to make the Actions tab look active. CI should be restored as an executable quality gate after billing/permission prerequisites are proven.
