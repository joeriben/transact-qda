#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
. scripts/lib/load_env.sh

BACKUP_DIR="$HOME/backups/transact-qda"
KEEP_DAYS=30
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/transact_qda_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Copy .env.example to .env and adjust it."
  exit 1
fi

if ! pg_isready -d "$DATABASE_URL" > /dev/null 2>&1; then
  echo "ERROR: PostgreSQL is not reachable via DATABASE_URL. Skipping backup."
  exit 1
fi

echo "Backing up transact_qda → $BACKUP_FILE"
pg_dump --dbname="$DATABASE_URL" --clean --if-exists | gzip > "$BACKUP_FILE"

# Verify the backup is non-empty
if [ ! -s "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file is empty!"
  rm -f "$BACKUP_FILE"
  exit 1
fi

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "Backup complete: $SIZE"

# Prune backups older than $KEEP_DAYS days
PRUNED=$(find "$BACKUP_DIR" -name "transact_qda_*.sql.gz" -mtime +$KEEP_DAYS -print -delete | wc -l)
if [ "$PRUNED" -gt 0 ]; then
  echo "Pruned $PRUNED backup(s) older than $KEEP_DAYS days."
fi

echo "Current backups:"
ls -lh "$BACKUP_DIR"/transact_qda_*.sql.gz 2>/dev/null | tail -5
