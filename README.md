# PocketBase Hub

A self-hosted dashboard to spin up and manage multiple [PocketBase](https://pocketbase.io) instances from a single UI. Each instance gets its own subdomain, PostgreSQL databases, and admin credentials — all provisioned automatically.

![Dashboard UI](https://raw.githubusercontent.com/Paperized/pocketbase-hub/main/docs/preview.png)

---

## Table of Contents

- [Quick Start (Demo)](#quick-start-demo)
- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Configuration Reference](#configuration-reference)
- [Templates & Placeholders](#templates--placeholders)
- [Scripts Reference](#scripts-reference)
- [API Reference](#api-reference)
- [Building the Image](#building-the-image)
- [Production Deployment Notes](#production-deployment-notes)

---

## Quick Start (Demo)

The `demo/` folder contains a ready-to-run Docker Compose stack. Everything is included: Postgres 17, an internal Traefik router, the Docker socket proxy, and the dashboard itself.

### Prerequisites

- Docker + Docker Compose v2
- A domain with wildcard DNS configured:
  - `pocket-hub.domain.com` → your server IP
  - `*.pocket-hub.domain.com` → your server IP
- A reverse proxy (Traefik, Nginx, Caddy…) already running on the host, able to forward HTTPS traffic to `127.0.0.1:8082`
- A Docker network named `traefik-public` shared with your reverse proxy:
  ```bash
  docker network create traefik-public
  ```
- The host user running the dashboard must have UID `1001` (or change the `user:` field in `demo/docker-compose.yml` to match your own UID/GID):
  ```bash
  id -u   # should print 1001
  ```

### Steps

**1. Clone the repository**

```bash
git clone https://github.com/Paperized/pocketbase-hub.git
cd pocketbase-hub
```

**2. Build the Docker image**

```bash
docker build -t pocket-base-hub:latest .
```

**3. Configure the demo environment**

```bash
cp demo/.env.example demo/.env
```

Edit `demo/.env`:

```env
# The base domain — instances will be at <subdomain>.pocket-hub.domain.com
APP_DOMAIN=pocket-hub.domain.com

# Dashboard login (HTTP Basic Auth)
DASHBOARD_USER=admin
DASHBOARD_PASS=changeme

# PostgreSQL credentials
POSTGRES_USER=postgres
POSTGRES_PASSWORD=a_strong_random_password
```

**4. Point the dashboard Traefik route to your domain**

Edit `demo/traefik/dynamic/dashboard.yml` and replace `pocket-hub.domain.com` with your actual domain:

```yaml
http:
  routers:
    dashboard:
      rule: "Host(`pocket-hub.domain.com`)"
      ...
```

**5. Start the stack**

```bash
docker compose -f demo/docker-compose.yml up -d
```

**6. Open the dashboard**

Navigate to `https://pocket-hub.domain.com` and log in with the credentials from step 3.

You can now create PocketBase instances from the UI. Each instance will be reachable at `https://<subdomain>.pocket-hub.domain.com` within seconds.

---

## Architecture Overview

```
Browser
  │
  ▼
Public reverse proxy (Traefik / Nginx / Caddy — your existing setup)
  │  forwards *.pocket-hub.domain.com → 127.0.0.1:8082
  ▼
pocket-hub-traefik  (internal Traefik, port 8082)
  │  routes by Host header using file provider (hot-reload)
  ├──▶  dashboard:3000          (pocket-hub.domain.com)
  └──▶  pb_<name>:8090          (<name>.pocket-hub.domain.com)

dashboard  (Hono + Bun backend + React frontend)
  ├── reads/writes /instances/<name>/          (bind-mount)
  ├── reads/writes /traefik/dynamic/<name>.yml (bind-mount)
  ├── talks to Docker via socket-proxy (TCP)   (container management)
  └── talks to Postgres directly               (DB provisioning)

socket-proxy  (tecnativa/docker-socket-proxy)
  └── exposes a filtered Docker API — no raw socket exposed to dashboard

pocket-hub-postgres  (Postgres 17)
  └── one database pair per instance: pb-<name> + pb-<name>-logs
```

**Key design decisions:**

- **Subdomain routing** — PocketBase's admin UI hardcodes absolute paths (`/api/`, `/_/`), making path-prefix stripping impossible. Each instance gets its own subdomain.
- **File provider for internal Traefik** — scripts write/delete `.yml` files; Traefik hot-reloads in ~1 second. No Docker label juggling.
- **No DB drop on delete by default** — instance data is kept in Postgres after deletion unless you explicitly check the option in the UI.
- **UID 1001** — the dashboard container runs as a non-root user so files created under `/instances/` are owned by the host user.

---

## Project Structure

```
pocketbase-hub/
│
├── Dockerfile                   # Multi-stage build (Node → Bun runtime)
│
├── backend/                     # Hono server (Bun)
│   ├── index.ts                 # App entry point, static file serving, auth middleware
│   ├── middleware/
│   │   └── auth.ts              # HTTP Basic Auth middleware
│   ├── routes/
│   │   └── instances.ts         # GET/POST/DELETE /api/instances, GET /api/config
│   └── scripts.ts               # Generic shell script runner via Bun.spawn
│
├── frontend/                    # React + Vite (TypeScript)
│   └── src/
│       ├── api.ts               # Typed fetch wrappers for all API calls
│       ├── App.tsx              # Root component with instance list + modals
│       └── components/
│           ├── InstanceCard     # Card with status badge, URL link, delete button
│           ├── CreateModal      # New instance form (name, subdomain, admin credentials)
│           └── DeleteModal      # Confirm delete with optional DB drop checkbox
│
├── config/                      # Baked into the image at /config/; mountable for customization
│   ├── scripts/
│   │   ├── new-instance.sh      # Creates instance: dir, .env, Traefik yml, PG DBs, container
│   │   ├── delete-instance.sh   # Stops container, removes dir + Traefik yml, optionally drops DBs
│   │   └── list-instances.sh    # Lists /instances/, outputs [{name, subdomain}] JSON array
│   └── templates/
│       ├── instance/
│       │   ├── docker-compose.yml   # Template for each PocketBase container
│       │   └── .env                 # Template for each instance's environment file
│       └── traefik/
│           └── dynamic.yml          # Template for each instance's Traefik routing config
│
└── demo/                        # Ready-to-run stack
    ├── .env.example             # Copy to .env and fill in values
    ├── docker-compose.yml       # Full stack: Postgres, socket-proxy, Traefik, dashboard
    ├── instances/               # Runtime dir — populated by the dashboard (bind-mounted)
    └── traefik/
        └── dynamic/
            └── dashboard.yml    # Static route for the dashboard itself
```

---

## Configuration Reference

All configuration is done via environment variables passed to the `dashboard` container.

| Variable | Default | Description |
|---|---|---|
| `APP_DOMAIN` | `localhost` | Base domain. Instances are routed at `<subdomain>.<APP_DOMAIN>`. |
| `APP_SCHEME` | `https` | URL scheme shown in the dashboard (`http` or `https`). |
| `DASHBOARD_USER` | `admin` | HTTP Basic Auth username for the dashboard. |
| `DASHBOARD_PASS` | `changeme` | HTTP Basic Auth password for the dashboard. |
| `POSTGRES_HOST` | `postgres` | Hostname of the PostgreSQL 17 server. |
| `POSTGRES_USER` | `postgres` | PostgreSQL superuser used for provisioning. |
| `POSTGRES_PASSWORD` | _(empty)_ | Password for `POSTGRES_USER`. |
| `INSTANCES_DIR` | `/instances` | Host path where instance directories are created. |
| `TRAEFIK_DYNAMIC_DIR` | `/traefik/dynamic` | Path where Traefik file provider watches for route configs. |
| `TEMPLATES_DIR` | `/config/templates` | Path to instance and Traefik YAML templates. |
| `SCRIPTS_DIR` | `/config/scripts` | Path to provisioning shell scripts. |
| `DOCKER_HOST` | _(empty)_ | Docker API endpoint, e.g. `tcp://socket-proxy:2375`. |
| `PORT` | `3000` | Port the dashboard HTTP server listens on. |

---

## Templates & Placeholders

When a new instance is created, the scripts render the templates by substituting placeholders with `sed`. You can override the templates at runtime by mounting a volume to `/config/templates`.

### `config/templates/instance/docker-compose.yml`

Defines the PocketBase container for each instance.

| Placeholder | Value |
|---|---|
| `__PROJECT_NAME__` | Internal instance name (used for container name `pb_<name>`, compose project) |
| `__SUBDOMAIN__` | Public subdomain (used in comments / future use) |
| `__APP_DOMAIN__` | Base domain |

### `config/templates/instance/.env`

Environment file passed to the PocketBase container via `env_file`.

| Placeholder | Value |
|---|---|
| `__PROJECT_NAME__` | Instance name |
| `__SUBDOMAIN__` | Public subdomain — stored here so `list-instances.sh` can read it back |
| `__APP_DOMAIN__` | Base domain |
| `__POSTGRES_HOST__` | PostgreSQL hostname |
| `__PB_DB_USER__` | Postgres user created for this instance (`pb_<name>`) |
| `__PB_DB_PASSWORD__` | Randomly generated password for the Postgres user |
| `__PB_DATA_DB__` | Main database name (`pb-<name>`) |
| `__PB_AUX_DB__` | Logs database name (`pb-<name>-logs`) |

### `config/templates/traefik/dynamic.yml`

Traefik HTTP router + service for each instance. Written to `/traefik/dynamic/<name>.yml` and picked up by Traefik's file provider automatically.

| Placeholder | Value |
|---|---|
| `__PROJECT_NAME__` | Instance name — used for router/middleware/service names |
| `__SUBDOMAIN__` | Public subdomain — used in `Host()` routing rules |
| `__APP_DOMAIN__` | Base domain |

The template creates:
- A router matching `<subdomain>.<APP_DOMAIN>` on port 8082
- A redirect middleware: bare `/` → `/_/` (PocketBase admin UI)
- A service pointing to `http://pb_<name>:8090`

---

## Scripts Reference

Scripts live at `/config/scripts/` inside the image and are called by the backend via `Bun.spawn`. They read configuration from environment variables inherited from the dashboard container.

### `new-instance.sh <name>`

Provisions a complete PocketBase instance:

1. Creates `$INSTANCES_DIR/<name>/` from templates
2. Writes `$TRAEFIK_DYNAMIC_DIR/<name>.yml`
3. Creates a dedicated Postgres user and two databases (`pb-<name>`, `pb-<name>-logs`)
4. Starts the container with `docker compose up -d`
5. Waits for PocketBase to respond on `/api/health`
6. Inserts a superuser directly into the `_superusers` table via psql (bcrypt hash generated with `Bun.password.hash`)
7. Deletes the default `__pbinstaller@example.com` account created by the image
8. Prints a JSON line to stdout: `{"adminEmail":"...","adminPassword":"..."}`

**Overridable via env vars:**

| Variable | Default |
|---|---|
| `INSTANCE_SUBDOMAIN` | same as `<name>` |
| `INSTANCE_ADMIN_EMAIL` | `admin@<name>.local` |
| `INSTANCE_ADMIN_PASSWORD` | randomly generated 16-char string |

### `delete-instance.sh <name> [--drop-dbs]`

Tears down an instance:

1. Runs `docker compose down` on the instance
2. Removes `$INSTANCES_DIR/<name>/` (including any local `pb-data/`)
3. Removes `$TRAEFIK_DYNAMIC_DIR/<name>.yml`
4. If `--drop-dbs` is passed: drops `pb-<name>`, `pb-<name>-logs`, and the Postgres user

> Without `--drop-dbs`, Postgres data is kept and can be recovered by recreating an instance with the same name.

### `list-instances.sh`

Scans `$INSTANCES_DIR/`, reads the `SUBDOMAIN=` line from each instance's `.env`, and outputs a JSON array:

```json
[{"name":"my-app","subdomain":"myapp"},{"name":"blog","subdomain":"blog"}]
```

---

## API Reference

All endpoints require HTTP Basic Auth.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/config` | Returns `{ domain, scheme }` — used by the frontend form |
| `GET` | `/api/instances` | Returns array of `{ name, subdomain, status, url }` |
| `POST` | `/api/instances` | Creates a new instance (see body below) |
| `DELETE` | `/api/instances/:name?dropDbs=true` | Deletes an instance; add `?dropDbs=true` to also drop Postgres DBs |

**POST `/api/instances` body:**

```json
{
  "name": "my-app",
  "subdomain": "myapp",
  "adminEmail": "admin@my-app.local",
  "adminPassword": "a_strong_password"
}
```

`subdomain`, `adminEmail`, and `adminPassword` are optional — sensible defaults are applied if omitted.

---

## Building the Image

```bash
docker build -t pocket-base-hub:latest .
```

The Dockerfile is a two-stage build:
1. **`node:20-alpine`** — builds the React frontend with Vite
2. **`oven/bun:1-alpine`** — runtime with `bash`, `openssl`, `postgresql16-client`, `docker-cli`, `docker-cli-compose`

The built frontend is served as static files directly from the Bun server.

---

## Production Deployment Notes

- **PostgreSQL 17 is required.** The `fondoger/pocketbase` image uses `json_query(jsonb, text)` which was added in PG17. Do not use PG16 or earlier.
- **Wildcard certificate.** Your public reverse proxy needs a wildcard cert for `*.pocket-hub.domain.com`. With Traefik + Let's Encrypt this is done via DNS-01 challenge.
- **`traefik-public` network.** The internal Traefik container joins this network so your public Traefik can reach `pocket-hub-traefik:8082` by container name. If you use a different reverse proxy, remove this network from `docker-compose.yml` and forward traffic to the exposed `127.0.0.1:8082` port instead.
- **UID 1001.** The dashboard runs as `user: 1001:1001`. Files written under `demo/instances/` will be owned by that UID. Adjust in `docker-compose.yml` if your host user has a different UID (`id -u`).
- **Customizing scripts and templates.** Mount a volume over `/config/scripts` or `/config/templates` to override provisioning behavior without rebuilding the image.
