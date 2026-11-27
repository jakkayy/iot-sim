# ESP32 IoT Simulator

A 2D, browser-based ESP32 simulator in the spirit of Wokwi: wire parts on a
canvas, write MicroPython (Arduino in progress), and talk to MQTT / Node-RED.
Everything that must feel instant runs in the browser; a small home server only
compiles Arduino sketches and hosts the MQTT broker.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Spike: Worker + SharedArrayBuffer, MicroPython wasm, Arduino wasm | done |
| 1 | Core, board, wiring, pre-run checks | done |
| 2 | MicroPython runtime, editor, serial monitor | done (v0.1.0) |
| 3-6 | Devices, Arduino compile service, MQTT/Node-RED, accounts + sharing | planned, see git log |

## Develop

Requires Bun 1.3+, Node 22+, Docker (only to compile Arduino sketches).

```bash
bun install
bun run dev          # apps/web on http://localhost:3000/sim
bun run lint         # tsc --noEmit in every workspace
bun run test         # unit tests (bun test)
bun run build

# browser tests (Chrome; override with CHROME_PATH)
cd apps/web && bun run build && bun run e2e
```

## Layout

```
apps/web/              Next.js app (deploy to Vercel)
packages/sim-core/     pins (SharedArrayBuffer), virtual clock, netlist, HAL. No React.
packages/devices/      device definitions: engine semantics, pin geometry, hints
packages/ui-kit/       SVG drawings of devices
packages/runtime-micropython/  MicroPython wasm + machine/time modules on the HAL
packages/runtime-arduino/      loads sketches compiled against arduino-shim
arduino-shim/          Arduino.h etc. (C++), imports resolved by the HAL
scripts/               helpers (Docker-based Arduino compile spike)
docs/                  spike findings
```

## Deploying the web app to Vercel

- Project Root Directory: `apps/web` (keep "include source files outside the root directory" on).
- Install with Bun (Vercel detects `bun.lock`). The `prebuild` script copies the MicroPython wasm into `public/`.
- `/sim` is served with `COOP: same-origin` and `COEP: require-corp` (see `next.config.mjs`); after deploying, check `crossOriginIsolated` is `true` in the page header.

## Security notes

User code runs in a Worker. MicroPython's `js`/`jsffi` modules are blocked and
network/spawn globals are removed before user code runs, but this is **defense in
depth, not a sandbox**. The planned containment is a cookie-less simulator origin
plus a CSP (Phase 6). Do not put authenticated cookies on the origin that serves `/sim`.
