import type { Catalog } from "@esp32-sim/sim-core";
import { esp32Devkit } from "./esp32";
import { button, led, resistor } from "./parts";
import {
  buzzer,
  buzzerPassive,
  dht22,
  hcsr04,
  lcdI2c,
  ldr,
  pir,
  potentiometer,
  relay,
  rgbLed,
  servo,
  ssd1306,
} from "./modules";
import type { DeviceDef } from "./types";

export const devices: Record<string, DeviceDef> = Object.fromEntries(
  [
    esp32Devkit,
    led,
    resistor,
    button,
    potentiometer,
    ldr,
    pir,
    relay,
    buzzer,
    buzzerPassive,
    rgbLed,
    servo,
    dht22,
    hcsr04,
    ssd1306,
    lcdI2c,
  ].map((d) => [d.type, d]),
);

/** What the simulation engine needs: type -> element semantics. */
export const catalog: Catalog = Object.fromEntries(
  Object.values(devices).map((d) => [d.type, d.element]),
);

