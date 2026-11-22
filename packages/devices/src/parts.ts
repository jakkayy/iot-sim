import type { DeviceDef } from "./types";

export const led: DeviceDef = {
  type: "led",
  name: "LED",
  category: "output",
  width: 40,
  height: 60,
  pins: [
    { name: "A", x: 10, y: 60, label: "+", hint: ["Anode (long leg)"] },
    { name: "K", x: 30, y: 60, label: "-", hint: ["Cathode (short leg)"] },
  ],
  element: { kind: "led", anode: "A", cathode: "K" },
};

export const resistor: DeviceDef = {
  type: "resistor",
  name: "Resistor",
  category: "passive",
  width: 70,
  height: 16,
  pins: [
    { name: "1", x: 0, y: 8 },
    { name: "2", x: 70, y: 8 },
  ],
  element: { kind: "resistor", a: "1", b: "2" },
};

export const button: DeviceDef = {
  type: "button",
  name: "Push button",
  category: "input",
  width: 50,
  height: 50,
  pins: [
    { name: "1", x: 0, y: 25 },
    { name: "2", x: 50, y: 25 },
  ],
  element: { kind: "switch", a: "1", b: "2" },
  controls: [{ id: "press", kind: "momentary", label: "Press" }],
};
