import type { DeviceDef, PinGeometry } from "./types";

/** Pins in a row along the bottom edge, wires leaving downwards. */
function bottomPins(names: string[], width: number, height: number): PinGeometry[] {
  const gap = width / (names.length + 1);
  return names.map((name, i) => ({ name, x: Math.round(gap * (i + 1)), y: height, label: name }));
}

export const potentiometer: DeviceDef = {
  type: "potentiometer",
  name: "Potentiometer",
  category: "input",
  width: 70,
  height: 70,
  pins: bottomPins(["GND", "SIG", "VCC"], 70, 70),
  element: { kind: "analog-out", vcc: "VCC", gnd: "GND", out: "SIG", control: "pos" },
  controls: [{ id: "pos", kind: "slider", label: "Position", min: 0, max: 1, step: 0.01, default: 0.5 }],
};

export const ldr: DeviceDef = {
  type: "ldr",
  name: "LDR module",
  category: "sensor",
  width: 70,
  height: 56,
  pins: bottomPins(["VCC", "GND", "AO"], 70, 56),
  element: { kind: "analog-out", vcc: "VCC", gnd: "GND", out: "AO", control: "light" },
  controls: [{ id: "light", kind: "slider", label: "Light", min: 0, max: 1, step: 0.01, default: 0.5 }],
};

export const pir: DeviceDef = {
  type: "pir",
  name: "PIR sensor",
  category: "sensor",
  width: 70,
  height: 70,
  pins: bottomPins(["VCC", "OUT", "GND"], 70, 70),
  element: { kind: "digital-out", vcc: "VCC", gnd: "GND", out: "OUT", control: "motion" },
  controls: [{ id: "motion", kind: "toggle", label: "Motion detected", default: 0 }],
};

export const relay: DeviceDef = {
  type: "relay",
  name: "Relay module",
  category: "output",
  width: 110,
  height: 70,
  pins: [
    { name: "VCC", x: 0, y: 14, label: "VCC", dir: "left" },
    { name: "GND", x: 0, y: 34, label: "GND", dir: "left" },
    { name: "IN", x: 0, y: 54, label: "IN", dir: "left" },
    { name: "NC", x: 110, y: 14, label: "NC", dir: "right" },
    { name: "COM", x: 110, y: 34, label: "COM", dir: "right" },
    { name: "NO", x: 110, y: 54, label: "NO", dir: "right" },
  ],
  element: { kind: "relay", vcc: "VCC", gnd: "GND", in: "IN", com: "COM", no: "NO", nc: "NC" },
};

export const buzzer: DeviceDef = {
  type: "buzzer",
  name: "Active buzzer",
  category: "output",
  width: 50,
  height: 56,
  pins: [
    { name: "+", x: 14, y: 56, label: "+", hint: ["Positive"] },
    { name: "-", x: 36, y: 56, label: "-", hint: ["Negative"] },
  ],
  element: { kind: "buzzer", pos: "+", neg: "-", passive: false },
};

export const buzzerPassive: DeviceDef = {
  ...buzzer,
  type: "buzzer-passive",
  name: "Passive buzzer",
  element: { kind: "buzzer", pos: "+", neg: "-", passive: true },
};

export const rgbLed: DeviceDef = {
  type: "rgb-led",
  name: "RGB LED",
  category: "output",
  width: 56,
  height: 66,
  pins: [
    { name: "R", x: 8, y: 66, label: "R" },
    { name: "COM", x: 21, y: 66, label: "-" },
    { name: "G", x: 35, y: 66, label: "G" },
    { name: "B", x: 48, y: 66, label: "B" },
  ],
  element: { kind: "rgb-led", r: "R", g: "G", b: "B", common: "COM", commonType: "cathode" },
};

export const servo: DeviceDef = {
  type: "servo",
  name: "Servo",
  category: "output",
  width: 100,
  height: 60,
  pins: [
    { name: "GND", x: 0, y: 14, label: "GND", dir: "left" },
    { name: "VCC", x: 0, y: 30, label: "V+", dir: "left" },
    { name: "SIG", x: 0, y: 46, label: "SIG", dir: "left" },
  ],
  element: { kind: "servo", vcc: "VCC", gnd: "GND", sig: "SIG" },
};

export const dht22: DeviceDef = {
  type: "dht22",
  name: "DHT22",
  category: "sensor",
  width: 60,
  height: 70,
  pins: bottomPins(["VCC", "DATA", "GND"], 60, 70),
  element: { kind: "module", pins: ["VCC", "DATA", "GND"], vcc: "VCC", gnd: "GND" },
  controls: [
    { id: "temperature", kind: "slider", label: "Temperature", min: -40, max: 80, step: 0.1, default: 25, unit: "°C" },
    { id: "humidity", kind: "slider", label: "Humidity", min: 0, max: 100, step: 0.1, default: 50, unit: "%" },
  ],
};

export const hcsr04: DeviceDef = {
  type: "hcsr04",
  name: "HC-SR04",
  category: "sensor",
  width: 100,
  height: 56,
  pins: bottomPins(["VCC", "TRIG", "ECHO", "GND"], 100, 56),
  element: { kind: "module", pins: ["VCC", "TRIG", "ECHO", "GND"], vcc: "VCC", gnd: "GND" },
  controls: [
    { id: "distance", kind: "slider", label: "Distance", min: 2, max: 400, step: 1, default: 100, unit: "cm" },
  ],
};

export const ssd1306: DeviceDef = {
  type: "ssd1306",
  name: "OLED SSD1306",
  category: "display",
  width: 150,
  height: 110,
  pins: bottomPins(["GND", "VCC", "SCL", "SDA"], 150, 110),
  element: { kind: "module", pins: ["GND", "VCC", "SCL", "SDA"], vcc: "VCC", gnd: "GND" },
};

export const lcdI2c: DeviceDef = {
  type: "lcd-i2c",
  name: "LCD 16x2 I2C",
  category: "display",
  width: 190,
  height: 90,
  pins: bottomPins(["GND", "VCC", "SDA", "SCL"], 190, 90),
  element: { kind: "module", pins: ["GND", "VCC", "SDA", "SCL"], vcc: "VCC", gnd: "GND" },
};
