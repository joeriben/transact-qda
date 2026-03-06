#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "Starting transact-qda production..."

# Start PostgreSQL
docker compose up -d

# Wait for PostgreSQL
for i in {1..30}; do
  if docker compose exec -T postgres pg_isready -U tqda -d transact_qda > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Run migrations
DATABASE_URL=postgresql://tqda:tqda_dev@localhost:5432/transact_qda node scripts/migrate.js

# Build and run
npm run build
node build/index.js
