"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PinState, createPinBuffer, type CircuitWarning } from "@esp32-sim/sim-core";
import { Canvas } from "../../components/Canvas";
import { Library } from "../../components/Library";
import { Warnings } from "../../components/Warnings";
import { BLINK_DEMO } from "../../lib/demo";
import { useCircuit } from "../../lib/store";

type Lang = "js" | "py" | "ino";

export default function SimPage() {
  const [isolated, setIsolated] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [warnings, setWarnings] = useState<CircuitWarning[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const pinsRef = useRef<PinState | null>(null);

  useEffect(() => setIsolated(window.crossOriginIsolated), []);
  useEffect(() => {
    if (useCircuit.getState().components.length === 0) {
      useCircuit.getState().addComponent("esp32-devkit", 60, 20);
    }
  }, []);

  const run = (lang: Lang) => {
    const buffer = createPinBuffer();
    pinsRef.current = new PinState(buffer);
    setLog([]);
    const worker =
      lang === "py"
        ? new Worker(new URL("./micropython.worker.ts", import.meta.url))
        : lang === "ino"
          ? new Worker(new URL("./arduino.worker.ts", import.meta.url))
          : new Worker(new URL("./blink.worker.ts", import.meta.url));
    worker.onmessage = (e: MessageEvent<{ type: string; line?: string; message?: string }>) => {
      const text = e.data.line ?? e.data.message ?? "";
      setLog((l) => [...l, `[${e.data.type}] ${text}`]);
    };
    const abs = (p: string) => new URL(p, location.href).href;
    worker.postMessage({
      buffer,
      wasmUrl: abs("/micropython/micropython.wasm"),
      loaderUrl: abs("/micropython/micropython.mjs"),
      sketchUrl: abs("/arduino/blink.wasm"),
    });
    workerRef.current = worker;
    setRunning(true);
  };

  // Stop = terminate the worker, so even an infinite loop stops immediately.
  const stop = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    pinsRef.current = null;
    setRunning(false);
  };

  const onWarnings = useCallback((w: CircuitWarning[]) => setWarnings(w), []);

  const disabled = running || !isolated;
  const btn = "rounded border border-gray-300 bg-white px-2 py-1 text-sm hover:bg-gray-100 disabled:opacity-40";

  return (
    <div className="flex h-full flex-col bg-gray-50 text-gray-900">
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-300 bg-white px-3 py-2">
        <h1 className="mr-2 font-semibold">ESP32 Simulator</h1>
        <button className={btn} onClick={() => useCircuit.getState().load(BLINK_DEMO.components, BLINK_DEMO.wires)}>
          Load Blink circuit
        </button>
        <span className="mx-1 text-gray-300">|</span>
        <button className={btn} onClick={() => run("js")} disabled={disabled}>Run JS demo</button>
        <button className={btn} onClick={() => run("py")} disabled={disabled}>Run MicroPython demo</button>
        <button className={btn} onClick={() => run("ino")} disabled={disabled}>Run Arduino demo</button>
        <button className={btn} onClick={stop} disabled={!running}>Stop</button>
        <span className="ml-auto text-xs text-gray-500">
          isolated: {String(isolated)}
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <Library />
        <Canvas pinsRef={pinsRef} onWarnings={onWarnings} />
        <div className="flex w-72 shrink-0 flex-col">
          <Warnings warnings={warnings} />
          <pre data-testid="log" className="min-h-0 flex-1 overflow-auto border-l border-t border-gray-300 bg-white p-2 text-xs">
            {log.join("\n")}
          </pre>
        </div>
      </div>
    </div>
  );
}
