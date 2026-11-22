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

      test("has a program in both languages", () => {
        expect(t.code.py.length).toBeGreaterThan(40);
        expect(t.code.ino).toContain("void setup()");
        expect(t.code.ino).toContain("void loop()");
      });

      // Optional live check: COMPILE_URL=http://localhost:8788 bun test lib/templates.test.ts
      test.skipIf(!process.env.COMPILE_URL)("the Arduino version compiles on the real service", async () => {
        const res = await fetch(`${process.env.COMPILE_URL}/compile`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: process.env.COMPILE_ORIGIN ?? "http://localhost:3111" },
          body: JSON.stringify({ files: [{ name: "sketch.ino", content: t.code.ino }] }),
        });
        const body = (await res.json()) as { ok: boolean; diags: unknown[] };
        expect(body.diags.filter((d) => (d as { severity: string }).severity === "error")).toEqual([]);
        expect(body.ok).toBe(true);
      }, 60000);

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
