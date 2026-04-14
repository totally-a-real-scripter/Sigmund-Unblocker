# Sigmund Unblocker

A containerized proxy platform that orchestrates **Ultraviolet + Scramjet + Epoxy Transport + Wisp server** with a polished dark UI.

## Project Structure

```txt
.
├── Dockerfile
├── backend/
│   ├── Dockerfile (compatibility wrapper)
│   ├── package.json
│   └── src/
│       ├── config/env.js
│       ├── middleware/security.js
│       ├── routes/{api.js,logs.js}
│       ├── services/{integrationService.js,proxyService.js,eventBus.js,metricsService.js}
│       ├── utils/validation.js
│       └── server.js
├── frontend/
│   └── public/
│       ├── index.html
│       ├── app.js
│       └── styles.css
├── wisp/
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

## Architecture & Data Flow

```txt
Browser UI (tabs, url bar, dashboard)
  -> Node/Express backend (`/api/proxy`, `/logs/stream`, `/api/metrics`)
    -> Epoxy transport bridge (`/ws/transport`)
      -> Wisp Python service (WebSocket transport)
        -> Ultraviolet + Scramjet rewriting/runtime
          -> Target website
```

### Key integration notes

- `backend/src/services/integrationService.js` imports `scramjet`, `ultraviolet`, and `epoxy-transport` so deployments fail fast if any integration is missing.
- `/ws/transport` upgrades are proxied to `WISP_WS_URL`, enabling transport tunneling and real-time diagnostics.
- `/uv` and `/scram` static mounts expose the browser runtime assets.

## Feature Coverage

- URL input with validation and normalization.
- Full-page iframe render via backend proxy endpoint.
- WebSocket transport bridge for Epoxy/Wisp.
- Basic cookie/session passthrough, streaming for uncached responses.
- Multi-tab session UI + local history.
- Live request log stream (SSE), latency metrics, and error panel.
- Config controls for cache, header overrides, timeout.
- Rate limiting + domain allow/block policy + security headers.
- Visible lawful-use disclaimer in UI.

## Local Setup

1. Copy env file:
   ```bash
   cp .env.example .env
   ```
2. Build/start with Docker Compose (uses root `Dockerfile` for backend):
   ```bash
   docker compose up --build
   ```
3. Open `http://localhost:3000`.

## Coolify Deployment (step-by-step)

1. Create a new **Docker Compose** service in Coolify and point it to this repository.
2. Keep `docker-compose.yml` as the deployment file.
3. In Coolify environment settings, define variables from `.env.example` (at minimum `PUBLIC_PORT`, `WISP_PUBLIC_PORT`, `MAX_RPS`, `CACHE_ENABLED`, `REQUEST_TIMEOUT_MS`).
4. Ensure public domain is routed to `backend` service port `3000`.
5. Deploy. Coolify handles internal networking; backend resolves Wisp as `ws://wisp:4000`.
6. After deploy, open `/api/health` to verify backend + metrics.

## Operational Tips

- Increase `MAX_RPS` cautiously to prevent abuse.
- Use `DOMAIN_ALLOWLIST` in managed/education deployments.
- Set `CACHE_ENABLED=false` when troubleshooting origin consistency.


## Registry timeout fix (Coolify / restricted networks)

If build logs show timeouts pulling `node:22-alpine` from Docker Hub, set a reachable mirror image in Coolify env vars:

- `NODE_BASE_IMAGE` (for example `docker.io/library/node:22-alpine` or your internal mirror)
- `PYTHON_BASE_IMAGE` (for example `docker.io/library/python:3.12-slim` or your internal mirror)

`docker-compose.yml` forwards these values as build args so you can switch registries without code changes.
