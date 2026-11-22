"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CircuitWarning } from "@esp32-sim/sim-core";
import { Circuit } from "@esp32-sim/sim-core";
import { buildTopology, catalog } from "@esp32-sim/devices";
import { Canvas } from "../../components/Canvas";
import { Controls } from "../../components/Controls";
import { CodeEditor, type EditorMarker } from "../../components/CodeEditor";
import { Library } from "../../components/Library";
import { SerialMonitor } from "../../components/SerialMonitor";
import { Warnings } from "../../components/Warnings";
import { splitDiags } from "../../lib/compile";
import { download, exportFiles, makeZip } from "../../lib/export";
import { createAutosaver, dexieStorage, parseProject, PROJECT_VERSION, type SavedProject } from "../../lib/persist";
import { DEFAULT_INO, DEFAULT_PY, useProject, type Lang } from "../../lib/project";
import { SerialLog } from "../../lib/serial";
import { TEMPLATES } from "../../lib/templates";
import { useCircuit } from "../../lib/store";
import { useRunner } from "../../lib/useRunner";

const SPEEDS = [0.5, 1, 2, 5, 10];

export default function SimPage() {
  const [isolated, setIsolated] = useState<boolean | null>(null);
  const [warnings, setWarnings] = useState<CircuitWarning[]>([]);
  const [markers, setMarkers] = useState<EditorMarker[]>([]);
  const [tab, setTab] = useState<"serial" | "checks" | "controls">("serial");
  const serial = useMemo(() => new SerialLog(), []);
  const { lang, code, setLang, setCode } = useProject();

  const runner = useRunner({
    onStdout: (t) => serial.push(t),
    onStderr: (t) => serial.push(t),
    onError: (message, line, printed) => {
      if (!printed) serial.push(message);
      if (line) setMarkers([{ line, message }]);
    },
    onDiags: (diags) => {
      const { markers, text } = splitDiags(diags);
      if (text.length) serial.push(text.join("\n"));
      setMarkers(markers);
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
  // Restore the last project from IndexedDB (or start with a board), then autosave every change.
  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    (async () => {
      const storage = dexieStorage();
      let saved = null;
      try {
        saved = parseProject(await storage.load());
      } catch {
        /* private mode / blocked storage: start fresh */
      }
      if (cancelled) return;
      const circuit = useCircuit.getState();
      if (saved && saved.components.length > 0) {
        circuit.load(saved.components, saved.wires, saved.values);
        useProject.setState({
          lang: saved.lang,
          code: { py: saved.code.py || DEFAULT_PY, ino: saved.code.ino || DEFAULT_INO },
        });
      } else if (circuit.components.length === 0) {
        circuit.addComponent("esp32-devkit", 60, 20);
      }
      useCircuit.getState().clearHistory();

      const snapshot = (): SavedProject => {
        const c = useCircuit.getState();
        const p = useProject.getState();
        return {
          version: PROJECT_VERSION,
          components: c.components,
          wires: c.wires,
          values: c.values,
          lang: p.lang,
          code: p.code,
        };
      };
      const saver = createAutosaver(storage, snapshot, 500, (e) => console.warn("autosave failed", e));
      const unsubs = [useCircuit.subscribe(() => saver.schedule()), useProject.subscribe(() => saver.schedule())];
      const onHide = () => saver.flush();
      window.addEventListener("beforeunload", onHide);
      cleanup = () => {
        saver.flush();
        unsubs.forEach((u) => u());
        window.removeEventListener("beforeunload", onHide);
      };
    })();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  const onWarnings = useCallback((w: CircuitWarning[]) => setWarnings(w), []);
  const busy = runner.state !== "idle";
  const run = () => {
    serial.clear();
    setMarkers([]);
    const circuit = new Circuit(useCircuit.getState().toCircuitData(), catalog);
    void runner.start(lang, code[lang], buildTopology(circuit), useCircuit.getState().values);
  };

  const exportProject = () => {
    const c = useCircuit.getState();
    const p = useProject.getState();
    const circuit = c.toCircuitData();
    const project: SavedProject = {
      version: PROJECT_VERSION,
      components: c.components,
      wires: c.wires,
      values: c.values,
      lang: p.lang,
      code: p.code,
    };
    download("esp32-project.zip", makeZip(exportFiles({ lang: p.lang, code: p.code[p.lang], circuit, project })));
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
          <option value="ino">Arduino (C++)</option>
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
        <select
          aria-label="Template"
          className={btn}
          value=""
          disabled={busy}
          onChange={(e) => {
            const t = TEMPLATES.find((x) => x.id === e.target.value);
            if (!t) return;
            useCircuit.getState().commit();
            useCircuit.getState().load(t.components, t.wires, t.values);
            setCode("py", t.code.py);
            setCode("ino", t.code.ino);
            serial.clear();
            setMarkers([]);
          }}
        >
          <option value="">Templates…</option>
          {TEMPLATES.map((t) => (
            <option key={t.id} value={t.id} title={t.description}>
              {t.name}
            </option>
          ))}
        </select>
        <button className={btn} onClick={() => useCircuit.getState().undo()} aria-label="Undo" title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button className={btn} onClick={() => useCircuit.getState().redo()} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
          ↷
        </button>
        <button className={btn} onClick={exportProject} data-testid="export" title="Download main.py + wiring table">
          Export to board
        </button>
        <span className="ml-auto text-xs text-gray-500" data-testid="status">
          {runner.state} · isolated: {String(isolated)}
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <Library />
        <Canvas pinsRef={runner.pinsRef} memRef={runner.memRef} onWarnings={onWarnings} />
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
              {(["serial", "checks", "controls"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1 ${tab === t ? "border-b-2 border-blue-600 font-medium" : "text-gray-500"}`}
                >
                  {t === "serial"
                    ? "Serial Monitor"
                    : t === "controls"
                      ? "Controls"
                      : `Checks${warnings.length ? ` (${warnings.length})` : ""}`}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {tab === "serial" ? (
                <SerialMonitor log={serial} />
              ) : tab === "controls" ? (
                <Controls />
              ) : (
                <Warnings warnings={warnings} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
