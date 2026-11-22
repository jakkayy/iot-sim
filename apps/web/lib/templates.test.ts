import { describe, expect, test } from "bun:test";
import { Circuit } from "@esp32-sim/sim-core";
import { catalog, devices } from "@esp32-sim/devices";
import { TEMPLATES } from "./templates";

describe("templates", () => {
  for (const t of TEMPLATES) {
    describe(t.id, () => {
      test("builds a valid circuit with unique ids", () => {
        const ids = t.components.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(t.wires.map((w) => w.id)).size).toBe(t.wires.length);
        for (const c of t.components) expect(devices[c.type], c.type).toBeDefined();
        expect(() => new Circuit({ components: t.components, wires: t.wires }, catalog)).not.toThrow();
      });

      test("passes the pre-run checks (no shorts, no LED without resistor, no 5V on GPIO)", () => {
        const circuit = new Circuit({ components: t.components, wires: t.wires }, catalog);
        expect(circuit.evaluate(null).warnings).toEqual([]);
      });

      test("has a MicroPython program", () => {
        expect(t.code.py.length).toBeGreaterThan(40);
      });

      test("control overrides only name real controls", () => {
        for (const [id, vals] of Object.entries(t.values ?? {})) {
          const comp = t.components.find((c) => c.id === id)!;
          const names = (devices[comp.type].controls ?? []).map((c) => c.id);
          for (const k of Object.keys(vals)) expect(names).toContain(k);
        }
      });
    });
  }
});
