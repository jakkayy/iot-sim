/**
 * Defense in depth for user code running in the Worker. This is NOT a sandbox:
 * the real containment is the Worker boundary plus a cookie-less origin and a
 * CSP (Phase 6). It removes the easy ways out so a casual `import js` / fetch
 * does not work.
 */

/** Globals that give a Worker network, storage or the ability to spawn code. */
export const BLOCKED_GLOBALS = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "Worker",
  "SharedWorker",
  "importScripts",
  "indexedDB",
  "caches",
  "BroadcastChannel",
] as const;

/** Run before user code, after the runtime and every resource it needs are loaded. */
export function lockdownGlobals(target: Record<string, unknown> = globalThis as never): string[] {
  const removed: string[] = [];
  for (const name of BLOCKED_GLOBALS) {
    if (name in target) {
      try {
        Object.defineProperty(target, name, { value: undefined, configurable: false, writable: false });
        removed.push(name);
      } catch {
        /* non-configurable in this environment */
      }
    }
  }
  return removed;
}

/**
 * Python run at boot. In MicroPython `sys.modules[name] = None` makes `import`
 * succeed with None, so a stub that raises ImportError on use gives a clearer error.
 */
export const PYTHON_BLOCK = `
import sys

class _Blocked:
    def __init__(self, name):
        self._n = name

    def __getattr__(self, attr):
        raise ImportError("module '" + self._n + "' is not available in the simulator")

sys.modules['js'] = _Blocked('js')
sys.modules['jsffi'] = _Blocked('jsffi')
`;
