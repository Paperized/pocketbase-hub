#!/usr/bin/env bash
# delete-instance.sh <project-name> [--drop-dbs]
# Deletes a PocketBase instance:
#   1. Stops and removes the container (docker compose down)
#   2. Removes the instance directory (including local pb-data)
#   3. Removes the Traefik dynamic config
#   4. Optionally drops Postgres databases (only if --drop-dbs is passed)

set -euo pipefail

PROJECT="${1:-}"
DROP_DBS=false
if [ "${2:-}" = "--drop-dbs" ]; then
  DROP_DBS=true
fi

if [ -z "$PROJECT" ]; then
  echo "Usage: delete-instance.sh <project-name> [--drop-dbs]" >&2
  exit 1
fi

if ! echo "$PROJECT" | grep -qE '^[a-z0-9-]+$'; then
  echo "Error: invalid instance name" >&2
  exit 1
fi

if [ "$PROJECT" = "template" ]; then
  echo "Error: cannot delete template" >&2
  exit 1
fi

INSTANCES_DIR="${INSTANCES_DIR:-/instances}"
TRAEFIK_DYNAMIC_DIR="${TRAEFIK_DYNAMIC_DIR:-/traefik/dynamic}"
POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"

TARGET_DIR="$INSTANCES_DIR/$PROJECT"
TRAEFIK_FILE="$TRAEFIK_DYNAMIC_DIR/${PROJECT}.yml"
PB_DB_USER="pb_${PROJECT//-/_}"
PB_DATA_DB="pb-${PROJECT}"
PB_AUX_DB="pb-${PROJECT}-logs"

if [ ! -d "$TARGET_DIR" ]; then
  echo "Error: instance '$PROJECT' not found" >&2
  exit 1
fi

echo "→ Stopping instance" >&2
if DOCKER_HOST="${DOCKER_HOST:-}" docker compose \
    -f "$TARGET_DIR/docker-compose.yml" \
    --project-name "$PROJECT" \
    down 2>/dev/null; then
  echo "  Container stopped" >&2
else
  echo "  Warning: docker compose down failed (container may already be stopped)" >&2
fi

echo "→ Removing instance directory (includes pb-data)" >&2
rm -rf "$TARGET_DIR"

echo "→ Removing Traefik dynamic config" >&2
if [ -f "$TRAEFIK_FILE" ]; then
  rm -f "$TRAEFIK_FILE"
fi

if [ "$DROP_DBS" = "true" ]; then
  echo "→ Dropping Postgres databases" >&2
  PGPASSWORD="$POSTGRES_PASSWORD" psql \
    -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d postgres \
    -v ON_ERROR_STOP=1 <<SQL
-- Terminate all active connections to both databases before dropping
SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE datname IN ('${PB_DATA_DB}', '${PB_AUX_DB}')
    AND pid <> pg_backend_pid();

DROP DATABASE IF EXISTS "${PB_DATA_DB}" WITH (FORCE);
DROP DATABASE IF EXISTS "${PB_AUX_DB}" WITH (FORCE);
DROP USER IF EXISTS "${PB_DB_USER}";
SQL
  echo "  Databases dropped" >&2
else
  echo "  Note: Postgres databases pb-${PROJECT} and pb-${PROJECT}-logs were NOT dropped" >&2
fi

echo "✓ Instance '${PROJECT}' deleted"
