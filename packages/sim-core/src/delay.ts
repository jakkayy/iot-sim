/**
 * Blocking sleep usable inside a Worker. Atomics.wait is not allowed on the
 * main thread, so callers must only use this from the runtime Worker.
 */
export function sleepMs(ms: number): void {
  if (ms <= 0) return;
  const cell = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(cell, 0, 0, ms);
}
