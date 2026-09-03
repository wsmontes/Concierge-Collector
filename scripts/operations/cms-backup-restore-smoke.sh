#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'cms-backup-restore-smoke: %s\n' "$1" >&2
  exit 1
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "$name is required"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

require_env CMS_BACKUP_SOURCE_URL
require_env CMS_BACKUP_SOURCE_DB
require_env CMS_RESTORE_TEST_URL
require_env CMS_RESTORE_TEST_DB

require_command mongodump
require_command mongorestore
require_command mongosh
require_command mktemp

source_url="$CMS_BACKUP_SOURCE_URL"
source_db="$CMS_BACKUP_SOURCE_DB"
restore_url="$CMS_RESTORE_TEST_URL"
restore_db="$CMS_RESTORE_TEST_DB"

[[ "$source_db" =~ ^[A-Za-z0-9_-]+$ ]] || fail 'CMS_BACKUP_SOURCE_DB contains unsupported characters'
[[ "$restore_db" =~ ^[A-Za-z0-9_-]+$ ]] || fail 'CMS_RESTORE_TEST_DB contains unsupported characters'
[[ "$restore_db" == *-restore-test ]] || fail 'CMS_RESTORE_TEST_DB must end with -restore-test'
[[ ! "$restore_db" =~ [Pp][Rr][Oo][Dd] ]] || fail 'restore database name must not contain prod/production'
[[ ! "$restore_url" =~ [Pp][Rr][Oo][Dd] ]] || fail 'restore URL appears to target production'
if [[ "$source_url" == "$restore_url" && "$source_db" == "$restore_db" ]]; then
  fail 'source and restore namespaces must differ'
fi

archive="$(mktemp "${TMPDIR:-/tmp}/concierge-cms-backup.XXXXXX.archive.gz")"
trap 'rm -f "$archive"' EXIT

snapshot() {
  local uri="$1"
  local database="$2"
  CMS_SNAPSHOT_DB="$database" mongosh "$uri" --quiet --eval '
    const d = db.getSiblingDB(process.env.CMS_SNAPSHOT_DB);
    const names = d.getCollectionNames().filter((name) => !name.startsWith("system.")).sort();
    const counts = {};
    for (const name of names) counts[name] = d.getCollection(name).countDocuments({});
    const collectionState = d.getCollection("collections").find({}, {
      _id: 1, slug: 1, lifecycle: 1, currentPublishedVersion: 1,
      draftEpoch: 1, draftRevision: 1, revision: 1,
      publishedSelectedCount: 1, draftSelectedCount: 1
    }).sort({_id: 1}).toArray();
    const versions = d.getCollection("collection_versions").find({}, {
      _id: 1, collectionId: 1, version: 1, status: 1,
      selectedCount: 1, membershipHash: 1
    }).sort({collectionId: 1, version: 1}).toArray();
    print(EJSON.stringify({counts, collectionState, versions}, {relaxed: true}));
  '
}

printf 'Capturing source invariants (credentials and URLs are not printed)...\n'
source_before="$(snapshot "$source_url" "$source_db")"

printf 'Creating compressed MongoDB archive...\n'
mongodump \
  --uri="$source_url" \
  --db="$source_db" \
  --archive="$archive" \
  --gzip \
  >/dev/null

source_after="$(snapshot "$source_url" "$source_db")"
[[ "$source_before" == "$source_after" ]] || fail 'source changed during dump; quiesce CMS web/worker and retry'

printf 'Restoring into guarded test namespace %s...\n' "$restore_db"
mongorestore \
  --uri="$restore_url" \
  --archive="$archive" \
  --gzip \
  --drop \
  --nsInclude="${source_db}.*" \
  --nsFrom="${source_db}.*" \
  --nsTo="${restore_db}.*" \
  >/dev/null

restore_snapshot="$(snapshot "$restore_url" "$restore_db")"
[[ "$source_before" == "$restore_snapshot" ]] || fail 'restored database invariant signature differs from source dump'

printf 'CMS backup/restore smoke passed for isolated restore namespace %s.\n' "$restore_db"
