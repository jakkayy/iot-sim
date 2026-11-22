import type { ElementSpec } from "@esp32-sim/sim-core";

/** Pin position in the device's local coordinate space (px at zoom 1). */
export interface PinGeometry {
  name: string;
  x: number;
  y: number;
  label?: string;
  /** Hover text lines (capabilities, warnings). */
  hint?: string[];
}

export interface ControlSpec {
  id: string;
  kind: "momentary";
  label: string;
}

export interface DeviceDef {
  type: string;
  name: string;
  category: "board" | "output" | "input" | "passive";
  width: number;
  height: number;
  pins: PinGeometry[];
  element: ElementSpec;
  controls?: ControlSpec[];
}
