# Phase 0 spike findings

Date: 2026-11-22. Verified with Playwright against `next start` using
Google Chrome (Chromium). Not yet verified: an actual Vercel deployment,
Firefox, Safari.

## Result: GO

All three runtimes toggle a pin that the UI reads every animation frame:

| Runtime | How | Verified |
| --- | --- | --- |
| JS | Worker + `Atomics.wait` sleep | LED toggles, Stop terminates worker |
| MicroPython | `micropython.wasm` in Worker, `hal` JS module | LED toggles, stdout reaches page |
| Arduino | clang `wasm32` blink (498 bytes) + `arduino-shim` | LED toggles, bun tests pass |

## Findings that change the plan

1. **Worker scripts need their own COEP header.** With `COEP: require-corp` on
   `/sim`, Chrome blocked the worker chunk (`ERR_BLOCKED_BY_RESPONSE`).
   Fix: COEP + `CORP: same-origin` on `/_next/static/*` (see `next.config.mjs`).
2. **The MicroPython emscripten loader cannot be bundled by webpack** (it
   references `fs` / `node:module`). It is copied to `public/micropython/` by
   `apps/web/scripts/copy-wasm.mjs` and loaded with a runtime `import()`.
   Generated copies are git-ignored.
3. **`import js` works inside MicroPython**, i.e. user code can reach JS
   globals (`fetch`, `indexedDB`). Must be removed before running untrusted
   code (Phase 2, and the separate cookie-less origin in Phase 6).
4. **`time.sleep_ms` blocks natively** and is real-time. Phase 2 replaces it
   with the virtual clock.
5. **Arduino build is freestanding** (`--target=wasm32 -nostdlib`), not
   `wasm32-wasi` as first sketched. No libc/libc++ is linked, so `String`,
   `printf` etc. must come from the shim or from wasi-libc / libc++ added in
   Phase 4.
6. **The runtime drives `setup()`/`loop()`** via exported `sim_setup` /
   `sim_loop` instead of a blocking `main()`, leaving room to poll interrupts
   and stop requests between iterations.

## Still open

- Deploy to Vercel and confirm `crossOriginIsolated` there (needs the
  owner's Vercel project; headers are standard `next.config` headers).
- Cross-browser check (Firefox, Safari).
