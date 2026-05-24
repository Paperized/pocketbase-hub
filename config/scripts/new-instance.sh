#!/usr/bin/env bash
# new-instance.sh <project-name>
# Creates a new PocketBase instance.
# Optional env vars to override defaults:
#   INSTANCE_SUBDOMAIN      subdomain for Traefik routing (default: project name)
#   INSTANCE_ADMIN_EMAIL    PocketBase superuser email (default: admin@<name>.local)
#   INSTANCE_ADMIN_PASSWORD PocketBase superuser password (default: randomly generated)

set -euo pipefail

PROJECT="${1:-}"

if [ -z "$PROJECT" ]; then
  echo "Usage: new-instance.sh <project-name>" >&2
  exit 1
fi

if ! echo "$PROJECT" | grep -qE '^[a-z0-9-]+$'; then
  echo "Error: name must match ^[a-z0-9-]+$" >&2
  exit 1
fi

if [ ${#PROJECT} -gt 63 ]; then
  echo "Error: name must be 63 chars max" >&2
  exit 1
fi

INSTANCES_DIR="${INSTANCES_DIR:-/instances}"
TRAEFIK_DYNAMIC_DIR="${TRAEFIK_DYNAMIC_DIR:-/traefik/dynamic}"
TEMPLATES_DIR="${TEMPLATES_DIR:-/config/templates}"
APP_DOMAIN="${APP_DOMAIN:-localhost}"
POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"

# Overridable via env
SUBDOMAIN="${INSTANCE_SUBDOMAIN:-$PROJECT}"
PB_ADMIN_EMAIL="${INSTANCE_ADMIN_EMAIL:-admin@${PROJECT}.local}"
PB_ADMIN_PASSWORD="${INSTANCE_ADMIN_PASSWORD:-$(openssl rand -base64 12 | tr -d '=+/' | cut -c1-16)}"

TARGET_DIR="$INSTANCES_DIR/$PROJECT"

if [ -d "$TARGET_DIR" ]; then
  echo "Error: instance '$PROJECT' already exists" >&2
  exit 1
fi

# Validate subdomain
if ! echo "$SUBDOMAIN" | grep -qE '^[a-z0-9-]+$'; then
  echo "Error: subdomain must match ^[a-z0-9-]+$" >&2
  exit 1
fi

# Generate random password for PB's postgres user
PB_DB_PASSWORD=$(openssl rand -base64 18 | tr -d '=+/' | cut -c1-24)
PB_DB_USER="pb_${PROJECT//-/_}"
PB_DATA_DB="pb-${PROJECT}"
PB_AUX_DB="pb-${PROJECT}-logs"

echo "→ Creating instance directory" >&2
mkdir -p "$TARGET_DIR"

# Copy and render docker-compose.yml template
sed \
  -e "s|__PROJECT_NAME__|${PROJECT}|g" \
  -e "s|__SUBDOMAIN__|${SUBDOMAIN}|g" \
  -e "s|__APP_DOMAIN__|${APP_DOMAIN}|g" \
  "$TEMPLATES_DIR/instance/docker-compose.yml" \
  > "$TARGET_DIR/docker-compose.yml"

# Copy and render .env template
sed \
  -e "s|__PROJECT_NAME__|${PROJECT}|g" \
  -e "s|__SUBDOMAIN__|${SUBDOMAIN}|g" \
  -e "s|__APP_DOMAIN__|${APP_DOMAIN}|g" \
  -e "s|__POSTGRES_HOST__|${POSTGRES_HOST}|g" \
  -e "s|__PB_DB_USER__|${PB_DB_USER}|g" \
  -e "s|__PB_DB_PASSWORD__|${PB_DB_PASSWORD}|g" \
  -e "s|__PB_DATA_DB__|${PB_DATA_DB}|g" \
  -e "s|__PB_AUX_DB__|${PB_AUX_DB}|g" \
  "$TEMPLATES_DIR/instance/.env" \
  > "$TARGET_DIR/.env"

echo "→ Writing Traefik dynamic config" >&2
mkdir -p "$TRAEFIK_DYNAMIC_DIR"
sed \
  -e "s|__PROJECT_NAME__|${PROJECT}|g" \
  -e "s|__SUBDOMAIN__|${SUBDOMAIN}|g" \
  -e "s|__APP_DOMAIN__|${APP_DOMAIN}|g" \
  "$TEMPLATES_DIR/traefik/dynamic.yml" \
  > "$TRAEFIK_DYNAMIC_DIR/${PROJECT}.yml"

echo "→ Creating Postgres user and databases" >&2
PGPASSWORD="$POSTGRES_PASSWORD" psql \
  -h "$POSTGRES_HOST" \
  -U "$POSTGRES_USER" \
  -d postgres \
  -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${PB_DB_USER}') THEN
    CREATE USER "${PB_DB_USER}" WITH PASSWORD '${PB_DB_PASSWORD}';
  ELSE
    ALTER USER "${PB_DB_USER}" WITH PASSWORD '${PB_DB_PASSWORD}';
  END IF;
END
\$\$;

SELECT 'CREATE DATABASE "${PB_DATA_DB}" OWNER "${PB_DB_USER}"'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${PB_DATA_DB}')\gexec

SELECT 'CREATE DATABASE "${PB_AUX_DB}" OWNER "${PB_DB_USER}"'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${PB_AUX_DB}')\gexec
SQL

echo "→ Starting instance" >&2
DOCKER_HOST="${DOCKER_HOST:-}" docker compose \
  -f "$TARGET_DIR/docker-compose.yml" \
  --project-name "$PROJECT" \
  up -d

echo "→ Waiting for PocketBase to be healthy" >&2
RETRIES=30
until wget -q --spider "http://pb_${PROJECT}:8090/api/health" 2>/dev/null \
   || curl -fs "http://pb_${PROJECT}:8090/api/health" -o /dev/null 2>/dev/null; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then
    echo "Error: PocketBase did not become healthy in time" >&2
    exit 1
  fi
  sleep 2
done

echo "→ Creating superuser" >&2
# Generate bcrypt hash using bun (available in this container) and upsert directly
# via psql — avoids docker exec which hangs through the TCP socket proxy.
PB_ADMIN_HASH=$(bun -e "console.log(await Bun.password.hash('${PB_ADMIN_PASSWORD}', {algorithm: 'bcrypt', cost: 10}))" 2>/dev/null)

if [ -z "$PB_ADMIN_HASH" ]; then
  echo "Error: failed to generate bcrypt hash for superuser password" >&2
  exit 1
fi

PB_ADMIN_ID=$(openssl rand -hex 8 | cut -c1-15)
PB_TOKEN_KEY=$(openssl rand -base64 40 | tr -d '=+/\n' | cut -c1-50)

PGPASSWORD="$POSTGRES_PASSWORD" psql \
  -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$PB_DATA_DB" \
  -v ON_ERROR_STOP=1 \
  -c "
DO \$\$
BEGIN
  IF EXISTS (SELECT 1 FROM _superusers WHERE email = '${PB_ADMIN_EMAIL}') THEN
    UPDATE _superusers SET password = '${PB_ADMIN_HASH}', updated = now()
      WHERE email = '${PB_ADMIN_EMAIL}';
  ELSE
    INSERT INTO _superusers (id, email, password, \"tokenKey\", created, updated, verified, \"emailVisibility\")
    VALUES ('${PB_ADMIN_ID}', '${PB_ADMIN_EMAIL}', '${PB_ADMIN_HASH}', '${PB_TOKEN_KEY}', now(), now(), true, false);
  END IF;
  DELETE FROM _superusers WHERE email = '__pbinstaller@example.com';
END
\$\$;"

# Output result as JSON to stdout (BE reads this)
echo "{\"adminEmail\":\"${PB_ADMIN_EMAIL}\",\"adminPassword\":\"${PB_ADMIN_PASSWORD}\"}"
