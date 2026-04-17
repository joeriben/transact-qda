#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "Running migrations inside the app container..."
docker compose exec -T app node scripts/migrate.js
