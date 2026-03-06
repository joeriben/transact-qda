#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "Seeding database..."
DATABASE_URL=postgresql://tqda:tqda_dev@localhost:5432/transact_qda node scripts/seed.js
echo "Done."
