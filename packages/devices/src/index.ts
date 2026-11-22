import type { Catalog } from "@esp32-sim/sim-core";
import { esp32Devkit } from "./esp32";
import { button, led, resistor } from "./parts";
import type { DeviceDef, PinDir, PinGeometry } from "./types";

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

/** Direction a wire should leave a pin: explicit, else toward the nearest device edge. */
export function pinDir(def: DeviceDef, pin: PinGeometry): PinDir {
  if (pin.dir) return pin.dir;
  if (pin.x <= 0) return "left";
  if (pin.x >= def.width) return "right";
  return pin.y >= def.height ? "down" : "up";
}
