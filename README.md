# PocketBase Hub

A self-hosted dashboard to spin up and manage multiple [PocketBase](https://pocketbase.io) instances from a single UI. Each instance gets its own subdomain, PostgreSQL databases, and admin credentials — all provisioned automatically.

---

## Table of Contents

- [Quick Start (Demo)](#quick-start-demo)
- [Reverse Proxy Setup](#reverse-proxy-setup)
- [Architecture Overview](#architecture-overview)
- [Instance Lifecycle & Ownership](#instance-lifecycle--ownership)
- [Dashboard Authentication](#dashboard-authentication)
- [Project Structure](#project-structure)
- [Configuration Reference](#configuration-reference)
- [Templates & Placeholders](#templates--placeholders)
- [Scripts Reference](#scripts-reference)
- [API Reference](#api-reference)
- [Building the Image](#building-the-image)
- [Production Notes](#production-notes)

---

## Quick Start (Demo)

The `demo/` folder is a ready-to-run Docker Compose stack: Postgres 17, internal Traefik router, Docker socket proxy, and the dashboard.

### Prerequisites

- Docker + Docker Compose v2
- Wildcard DNS pointing to your server:
  - `pocket-hub.domain.com` → server IP
  - `*.pocket-hub.domain.com` → server IP
- A reverse proxy handling TLS termination (see [Reverse Proxy Setup](#reverse-proxy-setup))
- Host user UID `1001` (or adjust `user:` in `demo/docker-compose.yml` to match `id -u`)

### Steps

**1. Clone and build**

```bash
git clone https://github.com/Paperized/pocketbase-hub.git
cd pocketbase-hub
docker build -t pocket-base-hub:latest .
```

**2. Configure environment**

```bash
cp demo/.env.example demo/.env
```

Edit `demo/.env` with your values:

```env
APP_DOMAIN=pocket-hub.domain.com

DASHBOARD_USER=admin        # leave empty to disable auth
DASHBOARD_PASS=changeme

POSTGRES_USER=postgres
POSTGRES_PASSWORD=a_strong_random_password

CERT_RESOLVER=letsencrypt   # only needed if using Traefik (see below)
```

**3. Update the dashboard route**

Edit `demo/traefik/dynamic/dashboard.yml` and replace the hostname with your actual domain:

```yaml
rule: "Host(`pocket-hub.domain.com`)"
```

**4. Start the stack**

```bash
docker compose -f demo/docker-compose.yml up -d
```

**5. Open the dashboard**

Go to `https://pocket-hub.domain.com`. From here you can create PocketBase instances — each one will be live at `https://<subdomain>.pocket-hub.domain.com` within seconds.

---

## Reverse Proxy Setup

The internal Traefik router listens on `127.0.0.1:8082` (HTTP only). Your public reverse proxy handles TLS termination and forwards all traffic matching `*.pocket-hub.domain.com` to port `8082`.

### Option A — Traefik (recommended, works out of the box)

If you already run Traefik as your public reverse proxy with Docker auto-discovery, the setup is zero-config: the labels in `docker-compose.yml` automatically register the routing rules and request a wildcard TLS certificate.

**How it works:**
- Your public Traefik watches the Docker socket for containers with `traefik.enable=true`
- `pocket-hub-traefik` exposes labels that define the routing rule and cert resolver
- Traefik reaches `pocket-hub-traefik` via the shared `traefik-public` Docker network

**Requirements:**
1. Your public Traefik must be connected to a Docker network named `traefik-public`:
   ```bash
   docker network create traefik-public
   ```
2. Your public Traefik must use the Docker provider (`--providers.docker=true`) with `exposedByDefault: false`
3. Set `CERT_RESOLVER` in `demo/.env` to the name of your Let's Encrypt resolver (e.g. `letsencrypt`, `cloudflare`)

The relevant label in `docker-compose.yml`:
```yaml
# Matches both pocket-hub.domain.com AND *.pocket-hub.domain.com in one rule
- "traefik.http.routers.pocket-hub.rule=HostRegexp(`^([a-z0-9-]+\\.)?${APP_DOMAIN}$$`)"
- "traefik.http.routers.pocket-hub.tls.certresolver=${CERT_RESOLVER}"
- "traefik.http.services.pocket-hub.loadbalancer.server.port=8082"
```

The single `HostRegexp` rule covers the base domain and all subdomains — no need to add new rules when new instances are created.

### Option B — Nginx

Remove the `labels` block and `traefik-public` network from `demo/docker-compose.yml`, then add a server block:

```nginx
server {
    listen 443 ssl;
    server_name pocket-hub.domain.com *.pocket-hub.domain.com;

    ssl_certificate     /path/to/wildcard.crt;
    ssl_certificate_key /path/to/wildcard.key;

    location / {
        proxy_pass http://127.0.0.1:8082;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Option C — Caddy

```caddyfile
*.pocket-hub.domain.com, pocket-hub.domain.com {
    tls {
        dns <your-dns-provider> <api-token>
    }
    reverse_proxy 127.0.0.1:8082
}
```

---

## Architecture Overview

```
Browser
  │
  ▼
Public reverse proxy  (Traefik / Nginx / Caddy — TLS termination)
  │  forwards *.pocket-hub.domain.com → pocket-hub-traefik:8082
  │  [Traefik: via traefik-public network + auto-discovery labels]
  │  [Nginx/Caddy: via 127.0.0.1:8082 port binding]
  ▼
pocket-hub-traefik  (internal Traefik, HTTP only, port 8082)
  │  routes by Host header using file provider (hot-reload ~1s)
  ├──▶  dashboard:3000          (pocket-hub.domain.com)
  └──▶  pb_<name>:8090          (<name>.pocket-hub.domain.com)

dashboard  (Hono + Bun backend + React frontend)
  ├── reads/writes /instances/<name>/          (bind-mount)
  ├── reads/writes /traefik/dynamic/<name>.yml (bind-mount → Traefik hot-reloads)
  ├── talks to Docker via socket-proxy (TCP)   (start/stop/status containers)
  └── talks to Postgres directly               (create/drop DBs and users)

socket-proxy  (tecnativa/docker-socket-proxy)
  └── filtered Docker API — dashboard never touches the raw socket

pocket-hub-postgres  (Postgres 17)
  └── one DB pair per instance: pb-<name>  +  pb-<name>-logs
```

**Key design decisions:**

- **Subdomain routing** — PocketBase's admin UI uses hardcoded absolute paths (`/api/`, `/_/`), making path-prefix stripping impossible. Each instance gets its own subdomain.
- **File provider for internal Traefik** — `new-instance.sh` writes a `.yml` file; Traefik picks it up in ~1 second. No Docker API calls or label restarts needed.
- **No DB drop by default** — Postgres data survives instance deletion unless you explicitly check the option in the delete dialog.
- **UID 1001** — the dashboard container runs as a non-root user so files written to `/instances/` are owned by the host user and don't require sudo to manage.

---

## Instance Lifecycle & Ownership

### The instance folder is the source of truth

When an instance named `my-app` is created, the hub writes:

```
demo/instances/my-app/
  ├── docker-compose.yml   # container definition
  ├── .env                 # all instance configuration
  └── pb-data/             # PocketBase local data (if any)

demo/traefik/dynamic/my-app.yml   # Traefik routing for this instance
```

The folder name (`my-app`) is the permanent identifier used for:
- The Docker container name (`pb_my-app`)
- The Docker Compose project name
- The Postgres user (`pb_my_app`) and databases (`pb-my-app`, `pb-my-app-logs`)
- The Traefik config file name

**Do not rename the folder.** The delete script and the container runtime all depend on this name being stable. If you need to rename, delete and recreate.

### What you can change after creation

Once an instance is running, the hub hands off control. You are free to:

- **Edit `instances/<name>/.env`** — add custom environment variables, change PocketBase settings like `PB_HTTP_ADDR`. Restart the container to apply (`docker compose -f instances/<name>/docker-compose.yml restart`).
- **Edit `traefik/dynamic/<name>.yml`** — add extra Traefik middlewares (rate limiting, headers, IP allowlists). Traefik hot-reloads within ~1 second, no restart needed.
- **Configure PocketBase from its admin UI** (`https://<subdomain>.domain.com/_/`) — manage collections, auth providers, hooks, API rules. These changes are stored in Postgres and persist independently.

### What you must NOT change after creation

- **`POSTGRES_URL`, `POSTGRES_DATA_DB`, `POSTGRES_AUX_DB`** in the instance `.env` — these values match the databases that were created at provisioning time. Changing them will cause PocketBase to fail to start, and the delete script will be unable to clean up correctly.
- **The instance folder name** — see above.

---

## Dashboard Authentication

HTTP Basic Auth is **enabled by default** and **optional**.

| `DASHBOARD_USER` value | Behavior |
|---|---|
| Non-empty string (default: `admin`) | Basic Auth is enforced on all `/api/*` routes |
| Empty string or not set | Auth is disabled — all requests pass through without credentials |

To disable auth, set `DASHBOARD_USER=` (empty) in `demo/.env`.

> Even with auth disabled, the dashboard should only be accessible over HTTPS and ideally restricted by network/firewall if exposed publicly.

---

## Project Structure

```
pocketbase-hub/
│
├── Dockerfile                   # Multi-stage build (Node → Bun runtime)
│
├── backend/                     # Hono server (Bun)
│   ├── index.ts                 # Entry point, static file serving, auth setup
│   ├── middleware/
│   │   └── auth.ts              # HTTP Basic Auth — no-op if DASHBOARD_USER is empty
│   ├── routes/
│   │   └── instances.ts         # GET /api/config, GET/POST/DELETE /api/instances
│   └── scripts.ts               # Shell script runner via Bun.spawn
│
├── frontend/                    # React + Vite (TypeScript)
│   └── src/
│       ├── api.ts               # Typed fetch wrappers
│       ├── App.tsx              # Root component
│       └── components/
│           ├── InstanceCard     # Status badge, URL link, delete button
│           ├── CreateModal      # Form: name, subdomain, admin email, admin password
│           └── DeleteModal      # Confirm delete + optional DB drop checkbox
│
├── config/                      # Baked into /config/ in the image; mountable for customization
│   ├── scripts/
│   │   ├── new-instance.sh      # Full provisioning: dir, .env, Traefik yml, PG DBs, container, superuser
│   │   ├── delete-instance.sh   # Teardown: stop container, remove dir + Traefik yml, optional DB drop
│   │   └── list-instances.sh    # Scan /instances/, output [{name, subdomain}] JSON
│   └── templates/
│       ├── instance/
│       │   ├── docker-compose.yml
│       │   └── .env
│       └── traefik/
│           └── dynamic.yml
│
└── demo/                        # Ready-to-run stack
    ├── .env.example             # Copy to .env and fill in values
    ├── docker-compose.yml       # Postgres 17 + socket-proxy + Traefik + dashboard
    ├── instances/               # Runtime — populated by the dashboard (bind-mounted)
    └── traefik/
        └── dynamic/
            └── dashboard.yml    # Static Traefik route for the dashboard itself
```

---

## Configuration Reference

Environment variables for the `dashboard` container:

| Variable | Default | Description |
|---|---|---|
| `APP_DOMAIN` | `localhost` | Base domain. Instances are at `<subdomain>.<APP_DOMAIN>`. |
| `APP_SCHEME` | `https` | URL scheme shown in the UI (`http` or `https`). |
| `DASHBOARD_USER` | `admin` | Basic Auth username. Empty = auth disabled. |
| `DASHBOARD_PASS` | `changeme` | Basic Auth password. |
| `POSTGRES_HOST` | `postgres` | PostgreSQL 17 hostname. |
| `POSTGRES_USER` | `postgres` | Postgres superuser for provisioning. |
| `POSTGRES_PASSWORD` | _(empty)_ | Password for `POSTGRES_USER`. |
| `INSTANCES_DIR` | `/instances` | Where instance directories are created. |
| `TRAEFIK_DYNAMIC_DIR` | `/traefik/dynamic` | Where Traefik file provider watches for routes. |
| `TEMPLATES_DIR` | `/config/templates` | Path to instance and Traefik templates. |
| `SCRIPTS_DIR` | `/config/scripts` | Path to provisioning scripts. |
| `DOCKER_HOST` | _(empty)_ | Docker API endpoint, e.g. `tcp://socket-proxy:2375`. |
| `PORT` | `3000` | Dashboard HTTP port. |

---

## Templates & Placeholders

Scripts render templates with `sed` substitution. Mount a volume over `/config/templates` to customize without rebuilding.

### `config/templates/instance/docker-compose.yml`

| Placeholder | Value |
|---|---|
| `__PROJECT_NAME__` | Instance name → container name `pb_<name>`, compose project |
| `__SUBDOMAIN__` | Public subdomain |
| `__APP_DOMAIN__` | Base domain |

### `config/templates/instance/.env`

| Placeholder | Value |
|---|---|
| `__PROJECT_NAME__` | Instance name |
| `__SUBDOMAIN__` | Subdomain — **stored here as source of truth for `list-instances.sh`** |
| `__APP_DOMAIN__` | Base domain |
| `__POSTGRES_HOST__` | PostgreSQL hostname |
| `__PB_DB_USER__` | Postgres user (`pb_<name>`) |
| `__PB_DB_PASSWORD__` | Randomly generated password |
| `__PB_DATA_DB__` | Main DB (`pb-<name>`) — **do not change after creation** |
| `__PB_AUX_DB__` | Logs DB (`pb-<name>-logs`) — **do not change after creation** |

### `config/templates/traefik/dynamic.yml`

| Placeholder | Value |
|---|---|
| `__PROJECT_NAME__` | Used for router / middleware / service names |
| `__SUBDOMAIN__` | Used in `Host()` rules |
| `__APP_DOMAIN__` | Base domain |

Creates: a router matching `<subdomain>.<APP_DOMAIN>`, a `/` → `/_/` redirect middleware, and a service pointing to `http://pb_<name>:8090`.

---

## Scripts Reference

### `new-instance.sh <name>`

1. Creates `$INSTANCES_DIR/<name>/` from templates
2. Writes `$TRAEFIK_DYNAMIC_DIR/<name>.yml`
3. Creates Postgres user + two databases
4. Starts container with `docker compose up -d`
5. Waits for PocketBase `/api/health` (checked from the dashboard container via the shared `pb_network`)
6. Creates a superuser directly in `_superusers` via psql (bcrypt hash via `Bun.password.hash`)
7. Removes the default `__pbinstaller@example.com` account
8. Prints `{"adminEmail":"...","adminPassword":"..."}` to stdout for the API response

**Optional env overrides:**

| Variable | Default |
|---|---|
| `INSTANCE_SUBDOMAIN` | same as `<name>` |
| `INSTANCE_ADMIN_EMAIL` | `admin@<name>.local` |
| `INSTANCE_ADMIN_PASSWORD` | randomly generated 16-char string |

### `delete-instance.sh <name> [--drop-dbs]`

1. `docker compose down` the instance
2. Removes `$INSTANCES_DIR/<name>/`
3. Removes `$TRAEFIK_DYNAMIC_DIR/<name>.yml`
4. With `--drop-dbs`: also drops both Postgres databases and the user

Without `--drop-dbs`, the databases are kept — recreating an instance with the same name will reuse the existing data.

### `list-instances.sh`

Scans `$INSTANCES_DIR/`, reads `SUBDOMAIN=` from each `.env`, outputs:

```json
[{"name":"my-app","subdomain":"myapp"},{"name":"blog","subdomain":"blog"}]
```

---

## API Reference

All endpoints require HTTP Basic Auth (if `DASHBOARD_USER` is set).

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/config` | Returns `{ domain, scheme }` |
| `GET` | `/api/instances` | Returns `[{ name, subdomain, status, url }]` |
| `POST` | `/api/instances` | Creates a new instance |
| `DELETE` | `/api/instances/:name` | Deletes an instance. Add `?dropDbs=true` to also drop Postgres DBs |

**POST body:**

```json
{
  "name": "my-app",
  "subdomain": "myapp",
  "adminEmail": "admin@my-app.local",
  "adminPassword": "a_strong_password"
}
```

`subdomain`, `adminEmail`, `adminPassword` are optional — defaults are applied if omitted.

---

## Building the Image

```bash
docker build -t pocket-base-hub:latest .
```

Two-stage build:
1. **`node:20-alpine`** — builds the React/Vite frontend
2. **`oven/bun:1-alpine`** — runtime, installs `bash`, `openssl`, `postgresql16-client`, `docker-cli`, `docker-cli-compose`

---

## Production Notes

- **PostgreSQL 17 required.** `fondoger/pocketbase` uses `json_query(jsonb, text)` added in PG17.
- **Wildcard TLS certificate.** Your reverse proxy needs a cert covering `*.pocket-hub.domain.com`. With Traefik + Let's Encrypt, use DNS-01 challenge (required for wildcards).
- **UID 1001.** Adjust `user:` in `docker-compose.yml` to match your host user UID (`id -u`).
- **Customizing without rebuilding.** Mount volumes over `/config/scripts` or `/config/templates` to override provisioning behavior.
- **Superuser credentials** are shown once in the UI after instance creation and are not stored anywhere by the hub. Save them immediately.
