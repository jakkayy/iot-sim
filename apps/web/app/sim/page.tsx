"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CircuitWarning } from "@esp32-sim/sim-core";
import { Canvas } from "../../components/Canvas";
import { CodeEditor, type EditorMarker } from "../../components/CodeEditor";
import { Library } from "../../components/Library";
import { SerialMonitor } from "../../components/SerialMonitor";
import { Warnings } from "../../components/Warnings";
import { BLINK_DEMO } from "../../lib/demo";
import { useProject, type Lang } from "../../lib/project";
import { SerialLog } from "../../lib/serial";
import { useCircuit } from "../../lib/store";
import { useRunner } from "../../lib/useRunner";

const SPEEDS = [0.5, 1, 2, 5, 10];

export default function SimPage() {
  const [isolated, setIsolated] = useState<boolean | null>(null);
  const [warnings, setWarnings] = useState<CircuitWarning[]>([]);
  const [markers, setMarkers] = useState<EditorMarker[]>([]);
  const [tab, setTab] = useState<"serial" | "checks">("serial");
  const serial = useMemo(() => new SerialLog(), []);
  const { lang, code, setLang, setCode } = useProject();

  const runner = useRunner({
    onStdout: (t) => serial.push(t),
    onStderr: (t) => serial.push(t),
    onError: (message, line, printed) => {
      if (!printed) serial.push(message);
      if (line) setMarkers([{ line, message }]);
    },
    onReset: () => {
      serial.clear();
      setMarkers([]);
    },
  });

  useEffect(() => setIsolated(window.crossOriginIsolated), []);
  useEffect(() => {
    // Production only: a service worker in dev would serve stale wasm/chunks.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  useEffect(() => {
    // Test hook for Playwright only (opt-in via ?e2e).
    if (new URLSearchParams(location.search).has("e2e")) {
      (window as unknown as { __sim: unknown }).__sim = { useProject, useCircuit };
    }
  }, []);
  useEffect(() => {
    if (useCircuit.getState().components.length === 0) {
      useCircuit.getState().addComponent("esp32-devkit", 60, 20);
    }
  }, []);

  const onWarnings = useCallback((w: CircuitWarning[]) => setWarnings(w), []);
  const busy = runner.state !== "idle";
  const run = () => {
    serial.clear();
    setMarkers([]);
    runner.start(lang, code[lang]);
  };

  const btn =
    "rounded border border-gray-300 bg-white px-2 py-1 text-sm hover:bg-gray-100 disabled:opacity-40";

  return (
    <div className="flex h-full flex-col bg-gray-50 text-gray-900">
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-300 bg-white px-3 py-2">
        <h1 className="mr-2 font-semibold">ESP32 Simulator</h1>
        <select
          aria-label="Language"
          className={btn}
          value={lang}
          disabled={busy}
          onChange={(e) => setLang(e.target.value as Lang)}
        >
          <option value="py">MicroPython</option>
          <option value="ino" disabled>
            Arduino (coming soon)
          </option>
        </select>
        <button className={btn} onClick={run} disabled={busy || !isolated} data-testid="run">
          ▶ Run
        </button>
        <button className={btn} onClick={runner.stop} disabled={!busy} data-testid="stop">
          ■ Stop
        </button>
        <button className={btn} onClick={runner.reset} data-testid="reset">
          ↺ Reset
        </button>
        <label className="ml-2 flex items-center gap-1 text-sm">
          Speed
          <select
            aria-label="Simulation speed"
            className={btn}
            value={runner.speed}
            onChange={(e) => runner.setSpeed(Number(e.target.value))}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
        </label>
        <button
          className={btn}
          onClick={() => useCircuit.getState().load(BLINK_DEMO.components, BLINK_DEMO.wires)}
          disabled={busy}
        >
          Load Blink circuit
        </button>
        <span className="ml-auto text-xs text-gray-500" data-testid="status">
          {runner.state} · isolated: {String(isolated)}
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <Library />
        <Canvas pinsRef={runner.pinsRef} onWarnings={onWarnings} />
        <div className="flex w-[460px] shrink-0 flex-col border-l border-gray-300">
          <div className="min-h-0 flex-1" data-testid="editor">
            <CodeEditor
              value={code[lang]}
              onChange={(v) => setCode(lang, v)}
              language={lang === "py" ? "python" : "cpp"}
              markers={markers}
            />
          </div>
          <div className="flex h-56 shrink-0 flex-col border-t border-gray-300 bg-white">
            <div className="flex border-b border-gray-200 text-sm">
              {(["serial", "checks"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1 ${tab === t ? "border-b-2 border-blue-600 font-medium" : "text-gray-500"}`}
                >
                  {t === "serial" ? "Serial Monitor" : `Checks${warnings.length ? ` (${warnings.length})` : ""}`}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {tab === "serial" ? <SerialMonitor log={serial} /> : <Warnings warnings={warnings} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
