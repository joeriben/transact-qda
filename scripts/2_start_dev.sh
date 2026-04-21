#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
. scripts/lib/load_env.sh

echo "Starting transact-qda development..."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Copy .env.example to .env and adjust it."
  exit 1
fi

echo "  Waiting for database..."
for i in {1..30}; do
  if pg_isready -d "$DATABASE_URL" > /dev/null 2>&1; then
    echo "  Database ready."
    break
  fi
  sleep 1
done

if ! pg_isready -d "$DATABASE_URL" > /dev/null 2>&1; then
  echo "ERROR: Database is not reachable via DATABASE_URL."
  exit 1
fi

# Run migrations
echo "  Running migrations..."
node scripts/migrate.js

# Kill any process on port 5174
if lsof -ti:5174 -sTCP:LISTEN > /dev/null 2>&1; then
  echo "  Port 5174 in use, killing..."
  lsof -ti:5174 -sTCP:LISTEN | xargs -r kill -9
  sleep 1
fi

# Start dev server (foreground so user sees output)
echo "  Starting SvelteKit dev server..."
npm run dev
