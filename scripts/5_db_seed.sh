#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "Seeding database inside the app container..."
docker compose exec -T app node scripts/seed.js
echo "Done."
