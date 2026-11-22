"use client";

import type { CircuitWarning } from "@esp32-sim/sim-core";

const LABEL: Record<CircuitWarning["code"], string> = {
  short: "Short circuit",
  "led-no-resistor": "LED without resistor",
  "five-volt-gpio": "5V on GPIO",
  "input-only-output": "Input-only pin as output",
};

export function Warnings({ warnings }: { warnings: CircuitWarning[] }) {
  return (
    <section className="w-72 shrink-0 border-l border-gray-300 bg-white p-3" aria-label="Circuit checks">
      <h2 className="mb-2 text-sm font-semibold">Circuit checks</h2>
      {warnings.length === 0 ? (
        <p className="text-sm text-green-700" data-testid="no-warnings">
          No problems found
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="warnings">
          {warnings.map((w, i) => (
            <li key={i} className="rounded border border-amber-300 bg-amber-50 p-2 text-sm" data-code={w.code}>
              <div className="font-medium">{LABEL[w.code]}</div>
              <div className="text-gray-700">{w.message}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
