#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "Stopping transact-qda services..."

# Stop SvelteKit dev server
pkill -f "vite.*transact-qda" 2>/dev/null && echo "  Stopped dev server" || echo "  Dev server not running"

# Stop docker compose
docker compose down 2>/dev/null && echo "  Stopped PostgreSQL" || echo "  PostgreSQL not running"

echo "Done."
