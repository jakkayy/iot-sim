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

  const run = () => {
    const buffer = createPinBuffer();
    pinsRef.current = new PinState(buffer);
    const worker = new Worker(new URL("./blink.worker.ts", import.meta.url));
    worker.postMessage({ buffer });
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
      <button onClick={run} disabled={running || !isolated}>Run</button>{" "}
      <button onClick={stop} disabled={!running}>Stop</button>
    </main>
  );
}
