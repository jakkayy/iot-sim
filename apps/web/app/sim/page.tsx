"use client";

import { useEffect, useRef, useState } from "react";
import { PinState, createPinBuffer } from "@esp32-sim/sim-core";

export default function SimPage() {
  const [isolated, setIsolated] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const ledRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const pinsRef = useRef<PinState | null>(null);

  useEffect(() => setIsolated(window.crossOriginIsolated), []);

  // UI reads pin state every frame; no setState per pin change.
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const on = pinsRef.current?.readDigital(2) === 1;
      if (ledRef.current) ledRef.current.style.background = on ? "#ff3b30" : "#444";
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const [log, setLog] = useState<string[]>([]);

  const run = (lang: "js" | "py" | "ino") => {
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

  return (
    <main style={{ padding: 24 }}>
      <h1>Simulator (spike)</h1>
      <p>crossOriginIsolated: {String(isolated)}</p>
      <div
        ref={ledRef}
        data-testid="led"
        style={{ width: 32, height: 32, borderRadius: 16, background: "#444", margin: "12px 0" }}
      />
      <button onClick={() => run("js")} disabled={running || !isolated}>Run JS</button>{" "}
      <button onClick={() => run("py")} disabled={running || !isolated}>Run MicroPython</button>{" "}
      <button onClick={() => run("ino")} disabled={running || !isolated}>Run Arduino</button>{" "}
      <button onClick={stop} disabled={!running}>Stop</button>
      <pre data-testid="log">{log.join("\n")}</pre>
    </main>
  );
}
