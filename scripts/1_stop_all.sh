#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "Stopping transact-qda development helpers..."

# Stop SvelteKit dev server
pkill -f "vite.*transact-qda" 2>/dev/null && echo "  Stopped dev server" || echo "  Dev server not running"

# Stop the local Compose stack as a convenience for host-side development.
docker compose down 2>/dev/null && echo "  Stopped Docker Compose stack" || echo "  Docker Compose stack not running"

echo "Done."
