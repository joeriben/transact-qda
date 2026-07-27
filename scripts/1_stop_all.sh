#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "Stopping transact-qda services..."

# Stop SvelteKit dev server
pkill -f "vite.*transact-qda" 2>/dev/null && echo "  Stopped dev server" || echo "  Dev server not running"

# Stop local production server if started manually
pkill -f "node build/index.js" 2>/dev/null && echo "  Stopped production server" || echo "  Production server not running"

echo "Done."
