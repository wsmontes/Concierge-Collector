# CMS Backup / Restore Rehearsal

This procedure proves that a CMS backup can be restored and verified without touching the source database.

## Required isolation

The destination database name **must end in `-restore-test`**. The smoke script rejects any target URL/database containing `production`, rejects an identical source/destination database name, and never prints Mongo connection strings.

The restore uses `--drop`, but only after the destination checks pass. `--drop` applies to the namespace-remapped restore-test database, never to the source database.

Use a staging/test source that is quiescent for the duration of the smoke. The post-restore checker compares the live source with the restored snapshot; concurrent source writes would correctly cause a mismatch even if the dump itself was valid.

## Prerequisites

- MongoDB Database Tools (`mongodump`, `mongorestore`).
- The Concierge API Python venv with PyMongo, or `PYTHON_BIN` pointing to an equivalent interpreter.
- A source credential with read permission on the CMS database.
- A restore credential that may create/drop collections only in the isolated restore-test database.

## Run

```bash
export CMS_BACKUP_SOURCE_URL='mongodb+srv://...'
export CMS_BACKUP_SOURCE_DB='concierge-cms-staging'
export CMS_RESTORE_TEST_URL='mongodb+srv://...'
export CMS_RESTORE_TEST_DB='concierge-cms-restore-test'

bash scripts/operations/cms-backup-restore-smoke.sh
```

The script performs:

1. fail-safe destination validation;
2. `mongodump --archive --gzip` from the source;
3. `mongorestore --drop` with `--nsFrom`/`--nsTo` into the isolated restore-test DB;
4. a read-only comparison of collection names, `count_documents({})`, and a streaming canonical SHA-256 over every document sorted by `_id`;
5. deletion of the temporary archive through an EXIT trap.

Success ends with:

```text
CMS restore invariants: PASS
CMS backup -> restore smoke: PASS
```

Any count/hash mismatch is a failed production-readiness gate. Do not make the destination database a production restore target and do not repurpose this script as an automated production disaster-recovery command.

## What this proves

- the configured backup credential can read the intended CMS database;
- the archive is restorable by the configured recovery credential;
- restored document sets, counts and BSON values match the source at verification time;
- the operational restore path does not depend on the running Payload web/worker process.

It does not authorize a production restore. Production restore remains a separately approved disaster-recovery action.
