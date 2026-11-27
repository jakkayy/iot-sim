import type { ElementSpec } from "@esp32-sim/sim-core";

/** Pin position in the device's local coordinate space (px at zoom 1). */
export type PinDir = "left" | "right" | "up" | "down";

export interface PinGeometry {
  name: string;
  x: number;
  y: number;
  label?: string;
  /** Direction a wire leaves the pin; defaults from the pin position (see pinDir). */
  dir?: PinDir;
  /** Hover text lines (capabilities, warnings). */
  hint?: string[];
}

export type ControlSpec =
  | { id: string; kind: "momentary"; label: string }
  | { id: string; kind: "toggle"; label: string; default: number }
  | { id: string; kind: "slider"; label: string; min: number; max: number; step: number; default: number; unit?: string };

/** The default control values of a freshly placed device. */
export function defaultValues(controls: ControlSpec[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of controls ?? []) if (c.kind !== "momentary") out[c.id] = c.default;
  return out;
}

export interface DeviceDef {
  type: string;
  name: string;
  category: "board" | "output" | "input" | "passive" | "sensor" | "display";
  width: number;
  height: number;
  pins: PinGeometry[];
  element: ElementSpec;
  controls?: ControlSpec[];
}
