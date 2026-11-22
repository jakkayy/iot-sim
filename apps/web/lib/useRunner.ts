"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PinState, VirtualClock, createClockBuffer, createPinBuffer, type ControlValues } from "@esp32-sim/sim-core";
import { DeviceMemory, type Topology } from "@esp32-sim/devices";
import type { StartMessage, WorkerMessage } from "./protocol";

export type RunState = "idle" | "starting" | "running";

export interface RunnerEvents {
  onStdout(text: string): void;
  onStderr(text: string): void;
  onError(message: string, line?: number, printed?: boolean): void;
  onReset(): void;
}

/** Bump with the @micropython/micropython-webassembly-pyscript version so the SW cache refreshes. */
export const RUNTIME_VERSION = "1.29.0-6";
const abs = (p: string) => new URL(`${p}?v=${RUNTIME_VERSION}`, location.href).href;

/**
 * Owns the runtime Worker and the shared buffers. Stop = terminate the Worker
 * (so even `while True` stops at once) and drop the pin buffer.
 */
export function useRunner(events: RunnerEvents) {
  const [state, setState] = useState<RunState>("idle");
  const [speed, setSpeedState] = useState(1);
  const workerRef = useRef<Worker | null>(null);
  const pinsRef = useRef<PinState | null>(null);
  const clockRef = useRef<VirtualClock | null>(null);
  const memRef = useRef<DeviceMemory | null>(null);
  const speedRef = useRef(1);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const stop = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    pinsRef.current = null;
    clockRef.current = null;
    memRef.current = null;
    setState("idle");
  }, []);

  const start = useCallback(
    (lang: "py" | "ino", code: string, topology: Topology, values: ControlValues) => {
      stop();
      const pinsBuffer = createPinBuffer();
      const clockBuffer = createClockBuffer();
      const clock = new VirtualClock(clockBuffer, undefined, true);
      clock.setSpeed(speedRef.current);
      pinsRef.current = new PinState(pinsBuffer);
      clockRef.current = clock;
      const mem = DeviceMemory.create(topology.devices);
      for (const [id, controls] of Object.entries(values)) {
        for (const [k, v] of Object.entries(controls)) mem.set(id, k, v);
      }
      memRef.current = mem;

      const worker = new Worker(new URL("../app/sim/runtime.worker.ts", import.meta.url));
      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const m = e.data;
        const ev = eventsRef.current;
        if (m.type === "ready") setState("running");
        else if (m.type === "stdout") ev.onStdout(m.text);
        else if (m.type === "stderr") ev.onStderr(m.text);
        else if (m.type === "error") ev.onError(m.message, m.line, m.printed);
        else if (m.type === "exit") {
          // Program finished by itself (or failed): keep the worker's pins visible, mark idle.
          setState("idle");
        }
      };
      worker.onerror = (e) => {
        eventsRef.current.onError(e.message || "Worker crashed");
        setState("idle");
      };
      const msg: StartMessage = {
        type: "start",
        lang,
        code,
        pinsBuffer,
        clockBuffer,
        deviceBuffer: mem.buffer,
        topology,
        urls: {
          micropythonLoader: abs("/micropython/micropython.mjs"),
          micropythonWasm: abs("/micropython/micropython.wasm"),
          sketch: abs("/arduino/blink.wasm"),
        },
      };
      worker.postMessage(msg);
      workerRef.current = worker;
      setState("starting");
    },
    [stop],
  );

  const reset = useCallback(() => {
    stop();
    eventsRef.current.onReset();
  }, [stop]);

  const setSpeed = useCallback((s: number) => {
    speedRef.current = s;
    setSpeedState(s);
    clockRef.current?.setSpeed(s);
  }, []);

  useEffect(() => () => workerRef.current?.terminate(), []);

  return { state, speed, setSpeed, start, stop, reset, pinsRef, memRef };
}
