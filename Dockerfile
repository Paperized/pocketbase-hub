# ─── Stage 1: Build Frontend ────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS runtime

# Install: bash, openssl (password gen), postgresql-client (psql), docker CLI + compose plugin
RUN apk add --no-cache \
    bash \
    openssl \
    postgresql16-client \
    docker-cli \
    docker-cli-compose

WORKDIR /app

# Install backend dependencies
COPY backend/package.json ./
RUN bun install --production

# Copy backend source
COPY backend/ ./

# Copy built frontend → served as static files from /app/public
COPY --from=frontend-builder /app/dist ./public

# Copy config (scripts + templates) → /config
# Users can override by mounting a volume on /config, /config/scripts, or /config/templates
COPY config/ /config/

RUN chmod +x /config/scripts/*.sh

# Runtime directories (will typically be bind-mounted from host)
RUN mkdir -p /instances /traefik/dynamic

EXPOSE 3000

ENV PORT=3000 \
    INSTANCES_DIR=/instances \
    TRAEFIK_DYNAMIC_DIR=/traefik/dynamic \
    TEMPLATES_DIR=/config/templates \
    SCRIPTS_DIR=/config/scripts \
    APP_DOMAIN=localhost \
    DASHBOARD_USER=admin \
    DASHBOARD_PASS=changeme

CMD ["bun", "run", "index.ts"]
