#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "Running migrations..."
DATABASE_URL=postgresql://tqda:tqda_dev@localhost:5432/transact_qda node scripts/migrate.js
