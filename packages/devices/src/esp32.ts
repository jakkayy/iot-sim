import type { BoardPin } from "@esp32-sim/sim-core";
import type { DeviceDef, PinGeometry } from "./types";

// ESP32 DevKit V1 (30-pin). Top to bottom as printed on the board.
const LEFT = [
  "EN", "GPIO36", "GPIO39", "GPIO34", "GPIO35", "GPIO32", "GPIO33", "GPIO25",
  "GPIO26", "GPIO27", "GPIO14", "GPIO12", "GPIO13", "GND.1", "5V",
] as const;
const RIGHT = [
  "3V3", "GND.2", "GPIO15", "GPIO2", "GPIO4", "GPIO16", "GPIO17", "GPIO5",
  "GPIO18", "GPIO19", "GPIO21", "GPIO3", "GPIO1", "GPIO22", "GPIO23",
] as const;

const ADC1 = new Set([32, 33, 34, 35, 36, 39]);
const ADC2 = new Set([0, 2, 4, 12, 13, 14, 15, 25, 26, 27]);
const TOUCH = new Set([0, 2, 4, 12, 13, 14, 15, 27, 32, 33]);
const INPUT_ONLY = new Set([34, 35, 36, 39]);
const STRAPPING = new Set([0, 2, 5, 12, 15]);

export function gpioNumber(pinName: string): number | undefined {
  const m = /^GPIO(\d+)$/.exec(pinName);
  return m ? Number(m[1]) : undefined;
}

/** Capability lines shown when hovering a pin. */
export function pinHint(pinName: string): string[] {
  const gpio = gpioNumber(pinName);
  if (gpio === undefined) {
    if (pinName === "3V3") return ["3.3V output"];
    if (pinName === "5V") return ["5V (VIN) - never connect to a GPIO"];
    if (pinName.startsWith("GND")) return ["Ground"];
    if (pinName === "EN") return ["Chip enable (reset)"];
    return [];
  }
  const lines = [`GPIO${gpio}`];
  if (ADC1.has(gpio)) lines.push("ADC1 (safe with WiFi)");
  if (ADC2.has(gpio)) lines.push("ADC2 (unavailable while WiFi is on)");
  if (TOUCH.has(gpio)) lines.push("Touch");
  if (INPUT_ONLY.has(gpio)) lines.push("Input-only (no output, no pull-up)");
  if (STRAPPING.has(gpio)) lines.push("Strapping pin (affects boot)");
  return lines;
}

const PITCH = 20;
const TOP = 36;
const WIDTH = 110;

const geometry: PinGeometry[] = [
  ...LEFT.map((name, i) => ({ name, x: 0, y: TOP + i * PITCH })),
  ...RIGHT.map((name, i) => ({ name, x: WIDTH, y: TOP + i * PITCH })),
].map((p) => ({ ...p, label: p.name.replace(/^GPIO/, "").replace(/\.\d$/, ""), hint: pinHint(p.name) }));

const boardPins: Record<string, BoardPin> = {};
for (const p of geometry) {
  if (p.name === "3V3") boardPins[p.name] = { supply: { level: 1, volts: 3.3 } };
  else if (p.name === "5V") boardPins[p.name] = { supply: { level: 1, volts: 5 } };
  else if (p.name.startsWith("GND")) boardPins[p.name] = { supply: { level: 0, volts: 0 } };
  else if (gpioNumber(p.name) !== undefined) boardPins[p.name] = { gpio: gpioNumber(p.name)! };
  else boardPins[p.name] = {};
}

export const esp32Devkit: DeviceDef = {
  type: "esp32-devkit",
  name: "ESP32 DevKit",
  category: "board",
  width: WIDTH,
  height: TOP + LEFT.length * PITCH,
  pins: geometry,
  element: { kind: "board", pins: boardPins },
};
