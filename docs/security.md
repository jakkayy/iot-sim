# Security notes

The simulator accepts code from strangers in two places. They are very different.

## 1. Code that runs in the visitor's browser (MicroPython / compiled Arduino)

It runs in a Web Worker. MicroPython's `js` and `jsffi` modules are blocked and network or
spawn globals (`fetch`, `XMLHttpRequest`, `WebSocket`, `Worker`, `importScripts`, `indexedDB`, ...)
are removed before user code runs. **This is defense in depth, not a sandbox**: a determined
program can still reach JavaScript through object prototypes. What actually limits the damage:

- the Worker has no DOM and no access to the page's storage;
- the simulator must be served from an origin that holds **no cookies or credentials** and with a CSP
  that denies network access to the Worker (planned for the sharing phase; today there is no login, so
  there is nothing to steal, but do not add authenticated cookies to the origin that serves `/sim`);
- compiled Arduino code is WebAssembly: it can only call the imports the runtime provides.

## 2. Code that is compiled on the home server (Arduino)

Compiling is never *executing*: the server only runs clang, and the result is run in the browser.
The risk is a compiler escape or resource exhaustion. Layers, outermost first:

| Layer | What it does |
| --- | --- |
| Cloudflare Tunnel + WAF | no open router port; rate limiting at the edge; optional Turnstile |
| Compiler service | per-IP token bucket (10/min, real client IP from `CF-Connecting-IP` only behind the tunnel), one compile per client at a time, bounded queue, 200 KB input cap, CORS allowlist (never `*`) |
| Source validation | rejects `asm`, `.incbin`, `#embed`, `#include_next`, `__has_include`, and `#include` paths that are absolute or contain `..`, so compiler output cannot read container files |
| Output sanitising | only `file:line:col: severity: message` lines are returned; container paths are replaced; messages are truncated |
| Sandbox container | per job: `--network none`, `--read-only`, `noexec` tmpfs, `--cap-drop ALL`, `no-new-privileges`, 512 MB RAM, 1 CPU, 128 pids, 20 s timeout, user 65534, optional gVisor. No volume is mounted: sources arrive on stdin, the wasm leaves on stdout |
| Result checks | wasm size cap and an import allowlist (a program may only call functions the simulator provides) |

The isolation flags are **hard-coded** in `services/compiler/runner.go` and asserted by tests; an
HTTP request cannot add, remove or change any of them. `integration_test.go` runs shell commands
inside the sandbox flags to prove the isolation is real (uid, read-only root, zero capabilities, no
network interface, no Docker socket) and that a macro bomb is stopped.

### Known limitation: the Docker socket

The compiler needs to start containers, so it talks to the Docker API through
`docker-socket-proxy`. That proxy filters by **endpoint**, not by request body: if the compiler
process were compromised, it could ask Docker to create a container with arbitrary settings
(for example privileged, with a host mount), which is equivalent to root on the host.
Mitigations, in order of value:

1. Run the Docker daemon **rootless**, or with user-namespace remapping, so "root in a container" is
   an unprivileged user on the host.
2. Use **gVisor** (`SANDBOX_RUNTIME=runsc`) for the compile containers.
3. Keep the compiler service small and hardened (read-only root, no capabilities, dedicated network,
   it never executes user code itself).
4. Future hardening: replace the proxy with a guard that validates the container-create body against
   the same fixed flags, so even a compromised compiler cannot ask for anything else.

Do not run this stack on a machine that holds data you cannot afford to lose without (1) or (2).
