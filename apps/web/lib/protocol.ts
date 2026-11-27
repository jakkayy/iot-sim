import type { Topology } from "@esp32-sim/devices";

/** Messages between the UI thread and the runtime Worker. */
export interface StartMessage {
  type: "start";
  lang: "py" | "ino";
  code: string;
  pinsBuffer: SharedArrayBuffer;
  clockBuffer: SharedArrayBuffer;
  /** Shared control values, powered flags and display frames (see devices/memory). */
  deviceBuffer: SharedArrayBuffer;
  topology: Topology;
  /** Absolute URLs (same origin; required under COEP). */
  /** Compiled Arduino program (Arduino mode only). */
  sketchWasm?: ArrayBuffer;
  urls: { micropythonLoader: string; micropythonWasm: string };
}

export type WorkerMessage =
  | { type: "ready" }
  | { type: "stdout"; text: string }
  | { type: "stderr"; text: string }
  /** `printed`: the text already went to stderr, so the UI must not print it again. */
  | { type: "error"; message: string; line?: number; printed?: boolean }
  | { type: "exit" };
