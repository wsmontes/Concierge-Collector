#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARCHIVE=""

cleanup() {
  if [[ -n "$ARCHIVE" && -f "$ARCHIVE" ]]; then
    rm -f "$ARCHIVE"
  fi
}
trap cleanup EXIT

required_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required" >&2
    exit 2
  fi
}

validate_restore_target() {
  # Destructive --drop is permitted only after all of these guards pass.
  # The destination database must match the explicit *-restore-test pattern.
  if [[ "$CMS_RESTORE_TEST_DB" != *-restore-test ]]; then
    echo "CMS_RESTORE_TEST_DB must end with -restore-test" >&2
    exit 2
  fi
  local target_lower
  target_lower="$(printf '%s %s' "$CMS_RESTORE_TEST_URL" "$CMS_RESTORE_TEST_DB" | tr '[:upper:]' '[:lower:]')"
  if [[ "$target_lower" == *production* ]]; then
    echo "restore target containing 'production' is refused" >&2
    exit 2
  fi
  if [[ "$CMS_BACKUP_SOURCE_DB" == "$CMS_RESTORE_TEST_DB" ]]; then
    echo "source and restore database names must differ" >&2
    exit 2
  fi
  if [[ "$CMS_BACKUP_SOURCE_URL" == "$CMS_RESTORE_TEST_URL" && "$CMS_BACKUP_SOURCE_DB" == "$CMS_RESTORE_TEST_DB" ]]; then
    echo "source and restore namespaces must differ" >&2
    exit 2
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "required command not found: $1" >&2
    exit 2
  fi
}

required_env CMS_BACKUP_SOURCE_URL
required_env CMS_BACKUP_SOURCE_DB
required_env CMS_RESTORE_TEST_URL
required_env CMS_RESTORE_TEST_DB
validate_restore_target

require_command mongodump
require_command mongorestore

PYTHON_BIN="${PYTHON_BIN:-$ROOT/concierge-api-v3/venv/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "restore checker requires PYTHON_BIN or concierge-api-v3/venv/bin/python" >&2
  exit 2
fi

ARCHIVE="$(mktemp "${TMPDIR:-/tmp}/concierge-cms-backup.XXXXXX.archive.gz")"

# Do not echo either connection string. The source operation is read-only.
mongodump \
  --uri="$CMS_BACKUP_SOURCE_URL" \
  --db="$CMS_BACKUP_SOURCE_DB" \
  --archive="$ARCHIVE" \
  --gzip

# Namespace remapping means --drop can touch only the already-validated isolated
# restore database, never the source namespace.
mongorestore \
  --uri="$CMS_RESTORE_TEST_URL" \
  --archive="$ARCHIVE" \
  --gzip \
  --drop \
  --nsFrom="${CMS_BACKUP_SOURCE_DB}.*" \
  --nsTo="${CMS_RESTORE_TEST_DB}.*"

"$PYTHON_BIN" "$ROOT/scripts/operations/check_cms_restore.py" \
  --source-url "$CMS_BACKUP_SOURCE_URL" \
  --source-db "$CMS_BACKUP_SOURCE_DB" \
  --restore-url "$CMS_RESTORE_TEST_URL" \
  --restore-db "$CMS_RESTORE_TEST_DB"

echo "CMS backup -> restore smoke: PASS"
