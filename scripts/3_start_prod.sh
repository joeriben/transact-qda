#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Starting transact-qda Compose stack..."
docker compose pull
docker compose up -d

echo "Current service status:"
docker compose ps
