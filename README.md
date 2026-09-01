# Concierge

Concierge is a curated-knowledge platform. It captures human perspective about real-world entities, organizes that knowledge into intentional Collections, and exposes it to downstream applications and AI systems.

The repository is a monorepo containing the offline-first Collector, the FastAPI operational domain, the Payload/Admin knowledge-operations system, generated contracts, workers, publication and distribution surfaces.

## Domain model

The current architecture is built around three deliberately separate concepts:

- **Entity** — the thing in the world: a restaurant, hotel, place or other canonical object.
- **Curation** — a curator's perspective/knowledge about an Entity. A Curation may be authored before it is linked to an Entity.
- **Collection** — an intentional, versioned selection of Curations for publication or distribution.

`entity_id` is the Curation→Entity relation. Workflow state such as `draft`/`active` is not used to represent linkage.

## Components

```text
Concierge-Collector/
├── index.html / scripts/ / styles/
│   └── Collector — offline-first curator authoring client
│
├── capture/
│   └── lightweight voice capture surface
│
├── concierge-api-v3/
│   └── FastAPI — operational domain authority
│       ├── Entity / Curation writes and ownership
│       ├── OAuth / sessions / authorization
│       ├── semantic and hybrid retrieval
│       ├── Places / AI / Capture provider boundaries
│       └── consumer-facing distribution projection
│
├── apps/admin/
│   └── Payload + Next — knowledge operations
│       ├── Collections and versioning
│       ├── Explorer / selections / bulk operations
│       ├── publish and export jobs
│       ├── consumer applications / credentials
│       └── operational worker surfaces
│
├── packages/
│   ├── design-tokens
│   └── fastapi-client — generated API contract client
│
├── contracts/
│   └── generated/shared API contracts
│
└── docs/
    └── architecture, operations, plans and historical material
```

### Boundary ownership

**Collector** owns authoring UX and durable local work. Local drafts/media remain authoritative until persistence/synchronization succeeds.

**FastAPI** owns operational Entity/Curation mutations, identity, authorization and paid-provider boundaries. Client-side role state is never authorization authority.

**Payload/Admin** owns knowledge operations around Collections, publication, selection/export and consumer management. Collection publication is versioned and worker-driven.

**Contracts** are generated boundaries between components rather than hand-maintained duplicate schemas.

## Local setup

### JavaScript workspace

The repository requires Node 22 and npm 10.

```bash
npm ci --legacy-peer-deps
```

### FastAPI

```bash
cd concierge-api-v3
cp .env.example .env
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cd ..
```

The release tooling does not require a particular virtualenv path. Python resolution is:

1. `CONCIERGE_PYTHON`
2. `PYTHON`
3. `concierge-api-v3/venv`
4. `concierge-api-v3/.venv`
5. system `python3` / `python`

### Collector

Serve the repository root, for example:

```bash
python3 -m http.server 5500
```

Default local surfaces:

- Collector: `http://127.0.0.1:5500`
- FastAPI: `http://localhost:8000/api/v3`
- Admin: `http://127.0.0.1:3000`

## Verification — no GitHub Actions CI

The project deliberately does **not** use GitHub Actions for CI. The canonical release gates are reproducible local commands.

Standard gate:

```bash
npm run verify
```

It checks Collector build/lint/unit tests, Admin unit/type/build, API unit/format/lint, and generated contracts.

Full release qualification:

```bash
npm run verify:full
```

It adds Admin/API integration coverage and live Playwright flows, including auth handoff, Explorer and Collection publication. The full gate expects the documented local Mongo/FastAPI/Admin/worker test stack and fails rather than silently skipping those high-value suites.

See [docs/LOCAL_RELEASE_GATE.md](docs/LOCAL_RELEASE_GATE.md).

An optional pre-push gate can be enabled with:

```bash
npm run hooks:enable
```

## Security and identity operations

Production authorization is server-side. Important operational tools under `concierge-api-v3/scripts/` include dry-run-first auditing/migration for user identity indexes and removal of legacy stored Google OAuth refresh credentials.

Do not apply destructive migrations blindly. Audit first, review duplicates/state, then apply in the intended environment.

## Architecture baseline

The current convergence target is **Architecture Baseline 1**. Its invariants, qualification requirements and deliberately deferred decisions are documented in:

- [docs/ARCHITECTURE_BASELINE_1.md](docs/ARCHITECTURE_BASELINE_1.md)
- [docs/superpowers/specs/2026-08-30-convergence-baseline-design.md](docs/superpowers/specs/2026-08-30-convergence-baseline-design.md)
- [docs/superpowers/plans/2026-08-30-convergence-baseline.md](docs/superpowers/plans/2026-08-30-convergence-baseline.md)

Synthetic Curations remain supported for compatibility/enrichment workflows, but whether synthetic knowledge should remain a first-class `Curation` type is an explicitly deferred domain-model decision; it is not being silently cemented by this baseline.

## Documentation

- [docs/README.md](docs/README.md) — documentation index
- [docs/API/README.md](docs/API/README.md) — API documentation
- [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) — local development
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — deployment
- [docs/OAUTH_SETUP_GUIDE.md](docs/OAUTH_SETUP_GUIDE.md) — OAuth setup
- [docs/LOCAL_RELEASE_GATE.md](docs/LOCAL_RELEASE_GATE.md) — release qualification

Historical/superseded material remains in `docs/archive/` and `archive/`; it should not be treated as the current architecture unless explicitly referenced.
