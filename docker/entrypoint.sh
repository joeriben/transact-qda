#!/bin/bash
# SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
# SPDX-License-Identifier: AGPL-3.0-or-later
set -e

DB_HOST="${POSTGRES_HOST:-db}"
DB_USER="${POSTGRES_USER:-tqda}"

echo "[entrypoint] waiting for database at ${DB_HOST}..."
for i in $(seq 1 60); do
  if pg_isready -h "${DB_HOST}" -U "${DB_USER}" >/dev/null 2>&1; then
    echo "[entrypoint] database ready."
    break
  fi
  sleep 1
  if [ "$i" = 60 ]; then
    echo "[entrypoint] database not reachable after 60 seconds." >&2
    exit 1
  fi
done

echo "[entrypoint] running migrations..."
node scripts/migrate.js

echo "[entrypoint] starting app..."
exec "$@"
