#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
BACKUP_ROOT="${BACKUP_ROOT:-$ROOT_DIR/backups/safe-update/$TIMESTAMP}"
STATE_ARCHIVE="$BACKUP_ROOT/app-state.tar.gz"
DB_DUMP="$BACKUP_ROOT/transact_qda.sql.gz"
MANIFEST="$BACKUP_ROOT/manifest.txt"

cd "$ROOT_DIR"

mkdir -p "$BACKUP_ROOT"

log() {
  echo "[safe-update] $*"
}

fail() {
  echo "[safe-update] ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command missing: $1"
}

capture_git_state() {
  log "capturing git state"
  {
    echo "timestamp=$TIMESTAMP"
    echo "root_dir=$ROOT_DIR"
    echo "backup_root=$BACKUP_ROOT"
    echo
    echo "[git]"
    git rev-parse HEAD
    git status --short --branch
  } >>"$MANIFEST"
}

backup_app_state() {
  log "archiving local state files"

  local paths=()
  local optional=(
    ".env"
    "ai-settings.json"
    "static/brand"
    "uploads"
  )

  for path in "${optional[@]}"; do
    if [ -e "$path" ]; then
      paths+=("$path")
    fi
  done

  shopt -s nullglob
  for key in *.key; do
    paths+=("$key")
  done
  shopt -u nullglob

  if [ "${#paths[@]}" -eq 0 ]; then
    log "no local state files found; skipping archive"
    return
  fi

  tar czf "$STATE_ARCHIVE" "${paths[@]}"
  {
    echo
    echo "[app-state]"
    echo "archive=$STATE_ARCHIVE"
    printf 'paths=%s\n' "${paths[*]}"
  } >>"$MANIFEST"
}

backup_database() {
  log "dumping docker postgres database"

  docker inspect transact-qda-db >/dev/null 2>&1 || fail "container transact-qda-db not found"
  docker exec transact-qda-db pg_isready -U tqda -d transact_qda >/dev/null 2>&1 || fail "database is not ready"

  docker exec -t transact-qda-db \
    pg_dump -U tqda --clean --if-exists transact_qda \
    | gzip >"$DB_DUMP"

  gzip -t "$DB_DUMP"

  {
    echo
    echo "[database]"
    echo "dump=$DB_DUMP"
  } >>"$MANIFEST"
}

main() {
  require_cmd git
  require_cmd tar
  require_cmd gzip
  require_cmd docker

  log "writing artifacts to $BACKUP_ROOT"
  : >"$MANIFEST"

  capture_git_state
  backup_app_state
  backup_database

  log "done"
  log "manifest: $MANIFEST"
}

main "$@"
