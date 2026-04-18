#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Starting transact-qda Compose stack (developer helper)..."
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

echo "Following app logs. Press Ctrl+C to stop log output; the stack keeps running."
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f app
