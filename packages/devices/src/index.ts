export * from "./types";
export { esp32Devkit, gpioNumber, pinHint } from "./esp32";
export { button, led, resistor } from "./parts";
export * from "./modules";
export { devices, catalog } from "./registry";
export * from "./memory";
export * from "./topology";
export * from "./models/ssd1306";
export * from "./models/lcd";
export * from "./models/sensors";
export { attachDevices } from "./attach";

import type { DeviceDef, PinDir, PinGeometry } from "./types";

/** Direction a wire should leave a pin: explicit, else toward the nearest device edge. */
export function pinDir(def: DeviceDef, pin: PinGeometry): PinDir {
  if (pin.dir) return pin.dir;
  if (pin.x <= 0) return "left";
  if (pin.x >= def.width) return "right";
  return pin.y >= def.height ? "down" : "up";
}
