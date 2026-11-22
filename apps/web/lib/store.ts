import { create } from "zustand";
import type { CircuitData, Endpoint, Wire } from "@esp32-sim/sim-core";

export interface PlacedView {
  id: string;
  type: string;
  x: number;
  y: number;
}

export type Selection = { kind: "component" | "wire"; id: string } | null;

const PREFIX: Record<string, string> = {
  "esp32-devkit": "esp",
  led: "led",
  resistor: "r",
  button: "btn",
};

export interface CircuitStore {
  components: PlacedView[];
  wires: Wire[];
  selection: Selection;
  /** First endpoint of a wire being drawn. */
  pendingWire: Endpoint | null;

  addComponent(type: string, x: number, y: number): string;
  moveComponent(id: string, x: number, y: number): void;
  select(selection: Selection): void;
  removeSelected(): void;
  startWire(endpoint: Endpoint): void;
  /** Completes the pending wire. Returns false if rejected (same pin, duplicate, none pending). */
  finishWire(endpoint: Endpoint): boolean;
  cancelWire(): void;
  load(components: PlacedView[], wires: Wire[]): void;
  toCircuitData(): CircuitData;
}

function nextId(existing: PlacedView[], type: string): string {
  const prefix = PREFIX[type] ?? type;
  const used = new Set(existing.map((c) => c.id));
  for (let i = 1; ; i++) {
    const id = `${prefix}${i}`;
    if (!used.has(id)) return id;
  }
}

const sameWire = (w: Wire, a: Endpoint, b: Endpoint) =>
  (w.a === a && w.b === b) || (w.a === b && w.b === a);

export const useCircuit = create<CircuitStore>((set, get) => ({
  components: [],
  wires: [],
  selection: null,
  pendingWire: null,

  addComponent(type, x, y) {
    const { components } = get();
    // Only one board: simulator state (pins) belongs to a single ESP32.
    if (type === "esp32-devkit") {
      const existing = components.find((c) => c.type === type);
      if (existing) return existing.id;
    }
    const id = nextId(components, type);
    set({ components: [...components, { id, type, x, y }] });
    return id;
  },

  moveComponent(id, x, y) {
    set((s) => ({ components: s.components.map((c) => (c.id === id ? { ...c, x, y } : c)) }));
  },

  select(selection) {
    set({ selection });
  },

  removeSelected() {
    const { selection, components, wires } = get();
    if (!selection) return;
    if (selection.kind === "wire") {
      set({ wires: wires.filter((w) => w.id !== selection.id), selection: null });
    } else {
      set({
        components: components.filter((c) => c.id !== selection.id),
        wires: wires.filter(
          (w) => !w.a.startsWith(`${selection.id}:`) && !w.b.startsWith(`${selection.id}:`),
        ),
        selection: null,
        pendingWire: null,
      });
    }
  },

  startWire(endpoint) {
    set({ pendingWire: endpoint });
  },

  finishWire(endpoint) {
    const { pendingWire, wires } = get();
    if (!pendingWire || pendingWire === endpoint) {
      set({ pendingWire: null });
      return false;
    }
    if (wires.some((w) => sameWire(w, pendingWire, endpoint))) {
      set({ pendingWire: null });
      return false;
    }
    let n = wires.length + 1;
    const ids = new Set(wires.map((w) => w.id));
    while (ids.has(`w${n}`)) n++;
    set({ wires: [...wires, { id: `w${n}`, a: pendingWire, b: endpoint }], pendingWire: null });
    return true;
  },

  cancelWire() {
    set({ pendingWire: null });
  },

  load(components, wires) {
    set({ components, wires, selection: null, pendingWire: null });
  },

  toCircuitData() {
    const { components, wires } = get();
    return { components: components.map(({ id, type }) => ({ id, type })), wires };
  },
}));
