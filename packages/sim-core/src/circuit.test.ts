import { describe, expect, test } from "bun:test";
import { Circuit, type Catalog, type CircuitData } from "./circuit";
import { PinMode, PinState, createPinBuffer } from "./pins";

const catalog: Catalog = {
  board: {
    kind: "board",
    pins: {
      GPIO2: { gpio: 2 },
      GPIO4: { gpio: 4 },
      GPIO5: { gpio: 5 },
      GPIO34: { gpio: 34 },
      "3V3": { supply: { level: 1, volts: 3.3 } },
      "5V": { supply: { level: 1, volts: 5 } },
      GND: { supply: { level: 0, volts: 0 } },
    },
  },
  led: { kind: "led", anode: "A", cathode: "K" },
  res: { kind: "resistor", a: "1", b: "2" },
  btn: { kind: "switch", a: "1", b: "2" },
};

let n = 0;
const w = (a: string, b: string) => ({ id: `w${n++}`, a, b });
const build = (components: CircuitData["components"], wires: CircuitData["wires"]) =>
  new Circuit({ components, wires }, catalog);
const board = { id: "esp", type: "board" };
const newPins = () => new PinState(createPinBuffer());
const codes = (c: Circuit, pins: PinState | null, sw = {}) =>
  c.evaluate(pins, sw).warnings.map((x) => x.code);

describe("LED through a resistor", () => {
  const circuit = build(
    [board, { id: "r", type: "res" }, { id: "led", type: "led" }],
    [w("esp:GPIO2", "r:1"), w("r:2", "led:A"), w("led:K", "esp:GND")],
  );

  test("lights when the GPIO is high, off when low, no warnings", () => {
    const pins = newPins();
    pins.setMode(2, PinMode.Output);
    pins.writeDigital(2, 1);
    let ev = circuit.evaluate(pins);
    expect(ev.leds.get("led")).toBe(1);
    expect(ev.warnings).toEqual([]);
    pins.writeDigital(2, 0);
    ev = circuit.evaluate(pins);
    expect(ev.leds.get("led")).toBe(0);
  });

  test("an unconfigured pin leaves the LED off", () => {
    expect(circuit.evaluate(newPins()).leds.get("led")).toBe(0);
  });
});

describe("pre-run checks", () => {
  test("LED wired straight to GPIO and GND warns", () => {
    const c = build(
      [board, { id: "led", type: "led" }],
      [w("esp:GPIO2", "led:A"), w("led:K", "esp:GND")],
    );
    expect(codes(c, null)).toContain("led-no-resistor");
  });

  test("resistor on the cathode side also counts as protected", () => {
    const c = build(
      [board, { id: "led", type: "led" }, { id: "r", type: "res" }],
      [w("esp:GPIO2", "led:A"), w("led:K", "r:1"), w("r:2", "esp:GND")],
    );
    expect(codes(c, null)).not.toContain("led-no-resistor");
  });

  test("5V on a GPIO net warns", () => {
    const c = build([board], [w("esp:5V", "esp:GPIO4")]);
    expect(codes(c, null)).toContain("five-volt-gpio");
  });

  test("3V3 wired to GND is a short", () => {
    const c = build([board], [w("esp:3V3", "esp:GND")]);
    expect(codes(c, null)).toContain("short");
  });

  test("output driven high into GND is a short; driven low is fine", () => {
    const c = build([board], [w("esp:GPIO4", "esp:GND")]);
    const pins = newPins();
    pins.setMode(4, PinMode.Output);
    pins.writeDigital(4, 1);
    expect(codes(c, pins)).toContain("short");
    pins.writeDigital(4, 0);
    expect(codes(c, pins)).not.toContain("short");
  });

  test("two outputs fighting on one net is a short", () => {
    const c = build([board], [w("esp:GPIO4", "esp:GPIO5")]);
    const pins = newPins();
    pins.setMode(4, PinMode.Output);
    pins.setMode(5, PinMode.Output);
    pins.writeDigital(4, 1);
    pins.writeDigital(5, 0);
    expect(codes(c, pins)).toContain("short");
  });

  test("input-only GPIO34 used as output warns", () => {
    const c = build([board], []);
    const pins = newPins();
    pins.setMode(34, PinMode.Output);
    expect(codes(c, pins)).toContain("input-only-output");
  });

  test("unknown endpoint or type is rejected", () => {
    expect(() => build([board], [w("esp:NOPE", "esp:GND")])).toThrow();
    expect(() => build([{ id: "x", type: "ghost" }], [])).toThrow();
  });
});

describe("button with internal pull-up", () => {
  const circuit = build(
    [board, { id: "b", type: "btn" }],
    [w("esp:GPIO4", "b:1"), w("b:2", "esp:GND")],
  );

  test("reads 1 released, 0 pressed", () => {
    const pins = newPins();
    pins.setMode(4, PinMode.InputPullup);
    expect(circuit.evaluate(pins, { b: false }).gpioInput.get(4)).toBe(1);
    expect(circuit.evaluate(pins, { b: true }).gpioInput.get(4)).toBe(0);
  });

  test("applyInputs writes the level into the shared buffer", () => {
    const pins = newPins();
    pins.setMode(4, PinMode.InputPullup);
    circuit.applyInputs(pins, circuit.evaluate(pins, { b: true }));
    expect(pins.readPin(4)).toBe(0);
    circuit.applyInputs(pins, circuit.evaluate(pins, { b: false }));
    expect(pins.readPin(4)).toBe(1);
  });

  test("a floating input reads 0", () => {
    const pins = newPins();
    pins.setMode(5, PinMode.Input);
    const c = build([board], []);
    expect(c.evaluate(pins).gpioInput.get(5)).toBe(0);
  });
});

describe("open-drain bus with external pull-up", () => {
  const circuit = build(
    [board, { id: "pu", type: "res" }],
    [w("esp:GPIO4", "esp:GPIO5"), w("esp:GPIO4", "pu:1"), w("pu:2", "esp:3V3")],
  );

  test("bus is high when released, low when either side pulls, never a short", () => {
    const pins = newPins();
    pins.setMode(4, PinMode.OpenDrain);
    pins.setMode(5, PinMode.OpenDrain);
    pins.writeDigital(4, 1);
    pins.writeDigital(5, 1);
    let ev = circuit.evaluate(pins);
    expect(ev.gpioInput.get(5)).toBe(1);
    pins.writeDigital(4, 0);
    ev = circuit.evaluate(pins);
    expect(ev.gpioInput.get(5)).toBe(0);
    pins.writeDigital(5, 0);
    expect(codes(circuit, pins)).not.toContain("short");
  });
});
