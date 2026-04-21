#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
. scripts/lib/load_env.sh

echo "Starting transact-qda production..."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Copy .env.example to .env and adjust it."
  exit 1
fi

echo "  Waiting for database..."
for i in {1..30}; do
  if pg_isready -d "$DATABASE_URL" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! pg_isready -d "$DATABASE_URL" > /dev/null 2>&1; then
  echo "ERROR: Database is not reachable via DATABASE_URL."
  exit 1
fi

# Run migrations
node scripts/migrate.js

# Build and run
npm run build
node build/index.js
