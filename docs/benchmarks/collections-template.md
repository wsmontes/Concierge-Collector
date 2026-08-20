# Template de benchmark — Explorer e exportação de seleções

Modelo para registrar qualquer rodada de `apps/admin/tests/load/explorer-selection.mjs`.
Cada rodada real preenche este template com os números do JSON gerado pelo script;
o JSON completo fica versionado junto (`/tmp/collections-benchmark.json` não é
versionado — copiar para `docs/benchmarks/runs/` quando o resultado merecer).

## Como rodar

O script exige um FastAPI apontando para um banco `-test` (recusa banco que não
termine em `-test`). Com mongod local:

```bash
cd concierge-api-v3
while IFS= read -r line; do case "$line" in ''|\#*) continue;; esac; export "${line%%=*}"="${line#*=}"; done < .env
export MONGODB_URL=mongodb://127.0.0.1:27017 MONGODB_DB_NAME=concierge-collector-test
export CMS_SERVICE_KEY="$(grep CMS_SERVICE_KEY ../apps/admin/.env | cut -d= -f2-)"
nohup venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8100 > /tmp/bench-fastapi.log 2>&1 &

node apps/admin/tests/load/explorer-selection.mjs --items 50000 \
  --output /tmp/collections-benchmark.json \
  --service-key "$CMS_SERVICE_KEY" --fastapi-base-url http://localhost:8100
```

Flags: `--items` (default 50000), `--output` (obrigatório), `--mongo-url`,
`--mongo-db`, `--cms-mongo-db`, `--service-key`, `--fastapi-base-url`,
`--cms-url` (default `http://localhost:3000`), `--ui-url` (default
`http://localhost:8080`), `--no-seed` (reusa dataset existente), `--keep-data`
(seeds permanecem no banco), `--quiet`.

Fases medidas (todas degradam com `skips`; o processo sai 0 enquanto search/scan
foram tentadas): seed, search, scan, resolve, materialize (CMS admin), apply
(CMS admin), worker RSS (processo escutando a porta do FastAPI via `lsof`/`ps`),
DOM rows (Playwright headless, nunca renderiza o dataset inteiro).

## Template

```markdown
# Benchmark — <data>, <ambiente> (<detalhe do hardware/banco se relevante>)

- Rodada: `node apps/admin/tests/load/explorer-selection.mjs --items <N> --output ...`
- Banco: `<db>@<url>` (sempre -test)

## Dataset

| items | db | batches (1k) | seed throughput |
|------:|----|-------------:|-----------------|
| 50000 | concierge-collector-test | 50 | 39454 docs/s |

## Índices (curations, no momento da rodada)

| name | key | TTL |
|------|-----|-----|
| `_id_` | `{_id: 1}` | — |
| ... | ... | ... |

## Search — GET /api/v3/catalog/curations

| requests | rows | p50 | p95 | p99 | max | retries |
|---------:|-----:|----:|----:|----:|----:|--------:|
| 105 | 51500 | 7.7ms | 11.3ms | 71.3ms | ... | 0 |

## Scan — POST /catalog/curations/scan/start + scan/page

| pages | rows | p50 | p95 | p99 | throughput | retries |
|------:|-----:|----:|----:|----:|-----------:|--------:|
| 101 | 50003 | 7.4ms | 9.3ms | 16.8ms | 61278 rows/s | 0 |

## Resolve — POST /catalog/curations/resolve

| requested | resolved | latency |
|----------:|---------:|--------:|
| 500 | 500 | 6.1ms |

## Materialize (CMS admin) — POST /admin/v1/selections + poll

| status | selectionId | ready ms | notas |
|--------|-------------|---------:|-------|
| skipped | — | — | cms_admin_unreachable (sem CMS na porta) |

## Apply (CMS admin) — POST /admin/v1/selections/:id/operations + poll

| status | operationId | terminal | ms | notas |
|--------|-------------|----------|---:|-------|
| skipped | — | — | — | no_materialized_selection |

## Worker RSS (processo do FastAPI)

| baseline | peak | delta | pid |
|---------:|-----:|------:|----:|
| 129024 KB | 130512 KB | 1488 KB | 12271 |

## DOM rows (Playwright, headless)

| status | rows | bounded (< items) | JS heap | notas |
|--------|-----:|-------------------|--------:|-------|
| skipped | — | — | — | ui_unreachable (sem UI na porta 8080) |

## Fila do CMS (payload-jobs)

| max age | notas |
|--------:|-------|
| n/a | coleção inexistente sem CMS na rodada |

## SLOs

- Seed ≥ 5k docs/s em batch de 1k.
- Scan: p95 < 50ms por página de 500 (50k docs ⇒ ≤ 100 páginas).
- Search: p95 < 50ms por página de 500.
- Worker RSS bounded por batches: delta < 50MB do baseline ao fim da rodada.
- Browser nunca materializa o dataset: DOM rows < items e heap JS < 200MB.
- Retries: 0 em search/scan/resolve; falhas 5xx/network são reportadas em `failures`.

## Failures / skips desta rodada

- skips: ...
- failures: ... (esperado: vazio)
- retries: ...
```

## Histórico

| data | ambiente | items | scan p95 | worker delta | JSON |
|------|----------|------:|---------:|-------------:|------|
| 2026-08-20 | local (mongod 127.0.0.1, FastAPI :8100, sem CMS/UI) | 50000 | 9.3ms | 1488 KB | `/tmp/collections-benchmark.json` |
| 2026-08-20 | local (smoke) | 100 | 7.4ms | 144 KB | `/tmp/collections-benchmark-smoke.json` |
