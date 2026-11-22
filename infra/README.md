# Home server

Services: `compiler` (Go + Docker sandbox), `socket-proxy`, `cloudflared`.
Mosquitto and Node-RED are added in the MQTT phase.

## Setup

1. Install Docker on the home server. A **rootless** Docker daemon is strongly recommended
   (see `docs/security.md`); optionally install gVisor (`runsc`).
2. `cp .env.example .env` and fill it in.
3. Images: either pull the ones CI publishes to GHCR or build locally:
   `docker compose --profile images build sandbox-image compiler`
   `docker compose --profile images pull sandbox-image`
4. In Cloudflare Zero Trust create a tunnel, put its token in `.env`, and add a public hostname
   `compile.<your-domain>` -> `http://compiler:8787`.
5. In the Cloudflare dashboard add a WAF rate-limiting rule for `compile.<your-domain>/compile`
   (the compiler also limits per client IP, but dropping abuse at the edge is cheaper).
6. `docker compose up -d`, then check `https://compile.<your-domain>/healthz`.

## Wiring the web app

Set `NEXT_PUBLIC_COMPILE_URL=https://compile.<your-domain>` in the Vercel project. The compiler
only answers browser requests whose `Origin` is `WEB_ORIGIN`.

## Operating it

- `docker compose logs -f compiler` shows one line per compile (hash prefix, ok, duration). Source code is never logged.
- The cache lives in the `compiler-cache` volume and evicts the oldest entries beyond 256 MB.
- Updating: pull new images and `docker compose up -d`. A new sandbox image changes `/shim/VERSION`,
  which invalidates every cached build automatically.
