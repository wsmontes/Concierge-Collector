# CMS Backup / Restore Smoke Runbook

## Purpose

Prove that the `concierge-cms` MongoDB data needed by Collections can be dumped and restored into an isolated namespace without changing the source database.

This is a release/operations check, not an application startup step. Web and worker processes never run `mongodump`, `mongorestore`, or migrations automatically.

## Safety properties

`scripts/operations/cms-backup-restore-smoke.sh` fails before restore unless all of the following are true:

- source and destination database names are supplied explicitly;
- the restore database name ends with `-restore-test`;
- the restore database and restore URI do not contain `prod`/`production`;
- source and destination are not the same namespace;
- `mongodump`, `mongorestore`, and `mongosh` are installed;
- the source invariant snapshot is identical before and after the dump.

The script never prints MongoDB URIs. The temporary compressed archive is deleted by a shell trap.

## What the smoke verifies

The comparison deliberately covers both broad and domain-specific state:

1. document counts for every non-system collection;
2. Collection lifecycle/version/draft/revision counters;
3. immutable CollectionVersion selected counts and membership hashes.

A mismatch fails the smoke. The restored test database is left in place for inspection; cleanup is an explicit operator action.

## Prerequisites

Use a staging/test source or a deliberately quiesced production backup source. Stop CMS write traffic and the Payload worker while the source signature + dump is taken. A changing source causes an intentional failure rather than producing ambiguous evidence.

MongoDB Database Tools and `mongosh` must be installed on the operator machine.

## Run

```bash
export CMS_BACKUP_SOURCE_URL='mongodb+srv://...'
export CMS_BACKUP_SOURCE_DB='concierge-cms-staging'
export CMS_RESTORE_TEST_URL='mongodb+srv://...'
export CMS_RESTORE_TEST_DB='concierge-cms-restore-test'

bash scripts/operations/cms-backup-restore-smoke.sh
```

Expected terminal line:

```text
CMS backup/restore smoke passed for isolated restore namespace concierge-cms-restore-test.
```

Do not paste MongoDB URIs into tickets, logs, PR descriptions, or screenshots.

## Inspect

After a passing smoke, inspect the restored namespace with read-only queries if desired:

```javascript
use concierge-cms-restore-test

db.collections.countDocuments({})
db.collection_versions.countDocuments({ status: 'published' })
db.collection_memberships.countDocuments({})
db.audit_events.countDocuments({})
```

For a known published Collection, verify that `currentPublishedVersion`, the corresponding `collection_versions.membershipHash`, and membership interval counts agree with the source evidence.

## Cleanup

Drop only the explicitly named restore-test database after inspection. Never parameterize cleanup from the source database variable.

```javascript
use concierge-cms-restore-test
db.dropDatabase()
```

## Failure handling

- **Source changed during dump:** keep the source untouched, quiesce web/worker writes, retry.
- **Restore namespace guard failed:** choose a new database ending in `-restore-test`; do not relax the guard.
- **Invariant mismatch:** keep the restored DB for investigation, do not promote a release, compare collection counts and CollectionVersion hashes.
- **Missing database tools:** install MongoDB Database Tools / `mongosh`; do not replace the smoke with an unverified copy.

## Retention notes

Operational retention is intentionally conservative:

- CMS login/session and selection/export TTLs are managed by their existing migrations/expiry fields.
- Worker heartbeats are retained for seven days by migration `20260902_009_operational_retention`.
- staged draft rows older than `CMS_ORPHAN_STAGING_RETENTION_DAYS` are purged only when their owning operation is terminal or missing.
- Collection versions, membership intervals, applications and credentials have no TTL.
- audit events and old operation items are not deleted until an archive/compaction artifact exists and is verified; accumulation is preferred over destructive retention without evidence.
