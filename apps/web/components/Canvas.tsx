"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Circuit, PinState, createPinBuffer, type CircuitWarning } from "@esp32-sim/sim-core";
import { catalog, devices, pinDir, type DeviceMemory } from "@esp32-sim/devices";
import { DeviceBody, applyVisual } from "@esp32-sim/ui-kit";
import { useCircuit } from "../lib/store";
import { routeWire } from "../lib/route";
import { DND_TYPE } from "./Library";

interface Viewport {
  x: number;
  y: number;
  k: number;
}

const WIRE_COLOR = { power: "#dc2626", ground: "#111827", signal: "#2563eb" } as const;

export function Canvas({
  pinsRef,
  memRef,
  onWarnings,
}: {
  /** Pin state of the running program, or null when stopped. */
  pinsRef: MutableRefObject<PinState | null>;
  /** Shared device memory of the running program, or null when stopped. */
  memRef: MutableRefObject<DeviceMemory | null>;
  onWarnings: (w: CircuitWarning[]) => void;
}) {
  const components = useCircuit((s) => s.components);
  const wires = useCircuit((s) => s.wires);
  const selection = useCircuit((s) => s.selection);
  const pendingWire = useCircuit((s) => s.pendingWire);
  const store = useCircuit;

  const svgRef = useRef<SVGSVGElement>(null);
  const groupRefs = useRef<Record<string, SVGGElement | null>>({});
  const previewRef = useRef<SVGPathElement>(null);
  const pressedRef = useRef<Record<string, boolean>>({});
  const idlePins = useRef<PinState>(new PinState(createPinBuffer()));
  const [vp, setVp] = useState<Viewport>({ x: 40, y: 20, k: 1 });
  const [hover, setHover] = useState<{ lines: string[]; x: number; y: number } | null>(null);
  const [badEndpoints, setBadEndpoints] = useState<Set<string>>(new Set());
  const interaction = useRef<
    | { kind: "pan"; sx: number; sy: number; vp: Viewport }
    | { kind: "drag"; id: string; dx: number; dy: number }
    | null
  >(null);

  const structureKey =
    components.map((c) => `${c.id}:${c.type}`).join("|") +
    "#" +
    wires.map((w) => `${w.id}:${w.a}-${w.b}`).join("|");
  const circuit = useMemo(
    () => new Circuit(store.getState().toCircuitData(), catalog),
    // structureKey captures every change that matters to the netlist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structureKey],
  );
  const staticEval = useMemo(() => circuit.evaluate(null), [circuit]);

  // Per-frame loop: evaluate the nets against the live pin buffer and update visuals imperatively.
  useEffect(() => {
    let raf = 0;
    let lastKey = "";
    let lastInputs = "";
    const frame = () => {
      const running = pinsRef.current;
      const pins = running ?? idlePins.current;
      const state = store.getState();
      const ev = circuit.evaluate(pins, pressedRef.current, state.values);
      const mem = memRef.current;
      if (mem) {
        // Feed the Worker: slider values, and which modules are powered.
        for (const [id, controls] of Object.entries(state.values)) {
          for (const [k, v] of Object.entries(controls)) mem.set(id, k, v);
        }
        for (const [id, out] of ev.outputs) mem.set(id, "powered", out.powered ?? 0);
      }
      if (running) {
        circuit.applyInputs(running, ev);
        const sig = [...ev.gpioInput].map(([g, l]) => `${g}:${l}`).join(",");
        if (sig !== lastInputs) {
          lastInputs = sig;
          running.notifyWake(); // let a sleeping program poll interrupts right away
        }
      }
      for (const c of state.components) {
        const g = groupRefs.current[c.id];
        if (g) {
          applyVisual(c.type, g, {
            brightness: ev.leds.get(c.id) ?? 0,
            pressed: !!pressedRef.current[c.id],
            outputs: ev.outputs.get(c.id),
            values: state.values[c.id],
            frame: mem?.frame(c.id) ?? null,
          });
        }
      }
      const key = ev.warnings.map((w) => `${w.code}|${w.endpoints.join(",")}`).join(";");
      if (key !== lastKey) {
        lastKey = key;
        onWarnings(ev.warnings);
        setBadEndpoints(new Set(ev.warnings.flatMap((w) => w.endpoints)));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [circuit, pinsRef, memRef, onWarnings, store]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) store.getState().redo();
        else store.getState().undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        store.getState().redo();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") store.getState().removeSelected();
      if (e.key === "Escape") {
        store.getState().cancelWire();
        store.getState().select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  const toWorld = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left - vp.x) / vp.k, y: (clientY - r.top - vp.y) / vp.k };
  };

  const pinInfo = (endpoint: string) => {
    const [cid, pin] = endpoint.split(":");
    const c = components.find((x) => x.id === cid);
    const def = c && devices[c.type];
    const p = def && def.pins.find((q) => q.name === pin);
    return c && def && p ? { pos: { x: c.x + p.x, y: c.y + p.y }, dir: pinDir(def, p) } : null;
  };
  const pinPos = (endpoint: string) => pinInfo(endpoint)?.pos ?? null;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    store.getState().select(null);
    interaction.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vp };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const it = interaction.current;
    if (it?.kind === "pan") {
      setVp({ ...it.vp, x: it.vp.x + e.clientX - it.sx, y: it.vp.y + e.clientY - it.sy });
    } else if (it?.kind === "drag") {
      const w = toWorld(e.clientX, e.clientY);
      store.getState().moveComponent(it.id, Math.round(w.x - it.dx), Math.round(w.y - it.dy));
    }
    const pending = store.getState().pendingWire;
    if (pending && previewRef.current) {
      const a = pinPos(pending);
      const w = toWorld(e.clientX, e.clientY);
      previewRef.current.setAttribute("d", a ? routeWire(a, w) : "");
    }
  };

  const endInteraction = () => {
    interaction.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const k = Math.min(3, Math.max(0.3, vp.k * factor));
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    setVp({ k, x: mx - ((mx - vp.x) / vp.k) * k, y: my - ((my - vp.y) / vp.k) * k });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData(DND_TYPE);
    const def = devices[type];
    if (!def) return;
    const w = toWorld(e.clientX, e.clientY);
    store.getState().addComponent(type, Math.round(w.x - def.width / 2), Math.round(w.y - def.height / 2));
  };

  const onPinClick = (endpoint: string) => {
    const s = store.getState();
    if (s.pendingWire) s.finishWire(endpoint);
    else s.startWire(endpoint);
  };

  const pending = pendingWire ? pinPos(pendingWire) : null;

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden bg-gray-100">
      <svg
        ref={svgRef}
        data-testid="canvas"
        className="h-full w-full touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endInteraction}
        onWheel={onWheel}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <defs>
          <pattern id="grid" width={20} height={20} patternUnits="userSpaceOnUse">
            <circle cx={1} cy={1} r={1} fill="#d1d5db" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" pointerEvents="none" />
        <g transform={`translate(${vp.x} ${vp.y}) scale(${vp.k})`}>
          {components.map((c) => {
            const def = devices[c.type];
            if (!def) return null;
            const selected = selection?.kind === "component" && selection.id === c.id;
            return (
              <g
                key={c.id}
                ref={(el) => {
                  groupRefs.current[c.id] = el;
                }}
                data-component={c.id}
                transform={`translate(${c.x} ${c.y})`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  store.getState().select({ kind: "component", id: c.id });
                  const w = toWorld(e.clientX, e.clientY);
                  store.getState().commit(); // the whole drag is one undo step
                  interaction.current = { kind: "drag", id: c.id, dx: w.x - c.x, dy: w.y - c.y };
                  svgRef.current!.setPointerCapture(e.pointerId);
                }}
              >
                {selected && (
                  <rect
                    x={-6}
                    y={-6}
                    width={def.width + 12}
                    height={def.height + 12}
                    fill="none"
                    stroke="#f59e0b"
                    strokeDasharray="4"
                    pointerEvents="none"
                  />
                )}
                <DeviceBody def={def} />
              </g>
            );
          })}
          {wires.map((w) => {
            const a = pinInfo(w.a);
            const b = pinInfo(w.b);
            if (!a || !b) return null;
            const kind = staticEval.netKind.get(staticEval.netOf.get(w.a)!) ?? "signal";
            const d = routeWire(a.pos, b.pos, a.dir, b.dir);
            const selected = selection?.kind === "wire" && selection.id === w.id;
            return (
              <g key={w.id}>
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={10}
                  cursor="pointer"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    store.getState().select({ kind: "wire", id: w.id });
                  }}
                />
                <path
                  data-wire={w.id}
                  data-kind={kind}
                  d={d}
                  fill="none"
                  stroke={selected ? "#f59e0b" : WIRE_COLOR[kind]}
                  strokeWidth={selected ? 3.5 : 2.5}
                  strokeLinejoin="round"
                  pointerEvents="none"
                />
              </g>
            );
          })}
          {components.map((c) => {
            const def = devices[c.type];
            if (!def) return null;
            return (
              <g key={c.id} transform={`translate(${c.x} ${c.y})`}>
                {def.controls?.some((x) => x.kind === "momentary") && (
                  <rect
                    data-testid={`press-${c.id}`}
                    x={def.width / 2 - 12}
                    y={def.height / 2 - 12}
                    width={24}
                    height={24}
                    fill="transparent"
                    cursor="pointer"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      pressedRef.current[c.id] = true;
                      window.addEventListener(
                        "pointerup",
                        () => {
                          pressedRef.current[c.id] = false;
                        },
                        { once: true },
                      );
                    }}
                  />
                )}
                {def.pins.map((p) => {
                  const endpoint = `${c.id}:${p.name}`;
                  const bad = badEndpoints.has(endpoint);
                  return (
                    <g key={p.name}>
                      <circle
                        data-pin={endpoint}
                        cx={p.x}
                        cy={p.y}
                        r={9}
                        fill="transparent"
                        cursor="crosshair"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onPinClick(endpoint);
                        }}
                        onPointerEnter={(e) =>
                          setHover({
                            lines: [`${c.id} / ${p.name}`, ...(p.hint ?? [])],
                            x: e.clientX,
                            y: e.clientY,
                          })
                        }
                        onPointerLeave={() => setHover(null)}
                      />
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={3.5}
                        fill={pendingWire === endpoint ? "#f59e0b" : bad ? "#dc2626" : "#fbbf24"}
                        stroke={bad ? "#7f1d1d" : "#92400e"}
                        pointerEvents="none"
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}
          {pending && (
            <path
              ref={previewRef}
              d=""
              fill="none"
              stroke="#f59e0b"
              strokeWidth={2}
              strokeDasharray="5"
              pointerEvents="none"
            />
          )}
        </g>
      </svg>
      {hover && (
        <div
          className="pointer-events-none fixed z-10 rounded bg-gray-900 px-2 py-1 text-xs text-white shadow"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          {hover.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
