"use client";

import { devices } from "@esp32-sim/devices";
import { useCircuit } from "../lib/store";

/** Sliders and toggles for every placed device that has controls (temperature, distance, motion, ...). */
export function Controls() {
  const components = useCircuit((s) => s.components);
  const values = useCircuit((s) => s.values);
  const setValue = useCircuit((s) => s.setValue);
  const withControls = components.filter((c) =>
    devices[c.type]?.controls?.some((x) => x.kind !== "momentary"),
  );
  if (withControls.length === 0) {
    return <p className="p-3 text-sm text-gray-500">Parts with sensors or knobs show their controls here.</p>;
  }
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="controls">
      {withControls.map((c) => (
        <fieldset key={c.id} className="rounded border border-gray-200 p-2">
          <legend className="px-1 text-xs font-medium text-gray-600">
            {devices[c.type].name} ({c.id})
          </legend>
          {devices[c.type].controls!.map((ctl) => {
            if (ctl.kind === "momentary") return null;
            const v = values[c.id]?.[ctl.id] ?? ctl.default;
            return (
              <label key={ctl.id} className="mb-1 flex items-center gap-2 text-sm">
                <span className="w-28 shrink-0">{ctl.label}</span>
                {ctl.kind === "toggle" ? (
                  <input
                    type="checkbox"
                    data-testid={`ctl-${c.id}-${ctl.id}`}
                    checked={v > 0.5}
                    onChange={(e) => setValue(c.id, ctl.id, e.target.checked ? 1 : 0)}
                  />
                ) : (
                  <>
                    <input
                      type="range"
                      className="min-w-0 flex-1"
                      data-testid={`ctl-${c.id}-${ctl.id}`}
                      min={ctl.min}
                      max={ctl.max}
                      step={ctl.step}
                      value={v}
                      onChange={(e) => setValue(c.id, ctl.id, Number(e.target.value))}
                    />
                    <span className="w-16 text-right tabular-nums">
                      {v.toFixed(ctl.step < 1 ? 2 : 0)}
                      {ctl.unit ? ` ${ctl.unit}` : ""}
                    </span>
                  </>
                )}
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
