#!/bin/bash
set -e
cd "$(dirname "$0")/.."

BACKUP_DIR="$HOME/backups/transact-qda"
KEEP_DAYS=30
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/transact_qda_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

# Check if the container is running
if ! docker compose ps --status running | grep -q postgres; then
  echo "ERROR: PostgreSQL container is not running. Skipping backup."
  exit 1
fi

echo "Backing up transact_qda → $BACKUP_FILE"
docker compose exec -T postgres pg_dump -U tqda --clean --if-exists transact_qda | gzip > "$BACKUP_FILE"

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
