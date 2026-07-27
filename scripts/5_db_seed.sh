#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
. scripts/lib/load_env.sh

echo "Seeding database..."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Copy .env.example to .env and adjust it."
  exit 1
fi

node scripts/seed.js
echo "Done."
