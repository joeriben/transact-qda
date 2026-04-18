#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Ensuring Compose services are running..."
docker compose up -d

echo "Seeding database in app container..."
docker compose exec -T app node scripts/seed.js
echo "Done."
