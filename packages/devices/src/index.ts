import type { Catalog } from "@esp32-sim/sim-core";
import { esp32Devkit } from "./esp32";
import { button, led, resistor } from "./parts";
import type { DeviceDef } from "./types";

export * from "./types";
export { esp32Devkit, gpioNumber, pinHint } from "./esp32";
export { button, led, resistor } from "./parts";

export const devices: Record<string, DeviceDef> = Object.fromEntries(
  [esp32Devkit, led, resistor, button].map((d) => [d.type, d]),
);

/** What the simulation engine needs: type -> element semantics. */
export const catalog: Catalog = Object.fromEntries(
  Object.values(devices).map((d) => [d.type, d.element]),
);
