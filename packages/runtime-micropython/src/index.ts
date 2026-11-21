import { PinState, sleepMs } from "@esp32-sim/sim-core";

export interface RunOptions {
  /** URL of micropython.mjs (served as a static file, never bundled: the emscripten loader references Node modules). */
  loaderUrl: string;
  /** URL of micropython.wasm. Both URLs must be same-origin because of COEP. */
  wasmUrl: string;
  pins: PinState;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

interface MicroPython {
  runPython(code: string): unknown;
  registerJsModule(name: string, module: object): void;
}
type LoadMicroPython = (options: {
  url?: string;
  linebuffer?: boolean;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}) => Promise<MicroPython>;

/**
 * Spike-level runtime: exposes a tiny `hal` module to Python. The real
 * `machine` / `time` modules replace this in Phase 2.
 * Must run inside a Worker because user code blocks (time.sleep_ms).
 */
export async function runMicroPython(code: string, opts: RunOptions): Promise<void> {
  const { loadMicroPython } = (await import(/* webpackIgnore: true */ opts.loaderUrl)) as {
    loadMicroPython: LoadMicroPython;
  };
  const mp = await loadMicroPython({
    url: opts.wasmUrl,
    linebuffer: true,
    stdout: opts.onStdout,
    stderr: opts.onStderr,
  });
  mp.registerJsModule("hal", {
    mode: (pin: number, mode: number) => opts.pins.setMode(pin, mode),
    write: (pin: number, level: number) => opts.pins.writeDigital(pin, level ? 1 : 0),
    sleep_ms: (ms: number) => sleepMs(ms),
  });
  mp.runPython(code);
}
