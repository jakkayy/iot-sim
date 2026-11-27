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

describe("net kinds (wire colouring)", () => {
  test("supply nets are power/ground, everything else is signal", () => {
    const c = build(
      [board, { id: "r", type: "res" }],
      [w("esp:3V3", "r:1"), w("r:2", "esp:GPIO4"), w("esp:GPIO5", "esp:GND")],
    );
    const ev = c.evaluate(null);
    expect(ev.netKind.get(ev.netOf.get("esp:3V3")!)).toBe("power");
    expect(ev.netKind.get(ev.netOf.get("esp:GND")!)).toBe("ground");
    expect(ev.netKind.get(ev.netOf.get("esp:GPIO4")!)).toBe("signal");
  });
});

describe("pull-down and PWM", () => {
  test("input with pull-down reads 0 and a pressed button to 3V3 reads 1", () => {
    const c = build(
      [board, { id: "b", type: "btn" }],
      [w("esp:GPIO4", "b:1"), w("b:2", "esp:3V3")],
    );
    const pins = newPins();
    pins.setMode(4, PinMode.InputPulldown);
    expect(c.evaluate(pins, { b: false }).gpioInput.get(4)).toBe(0);
    expect(c.evaluate(pins, { b: true }).gpioInput.get(4)).toBe(1);
  });

  test("PWM duty becomes LED brightness through a resistor", () => {
    const c = build(
      [board, { id: "r", type: "res" }, { id: "led", type: "led" }],
      [w("esp:GPIO2", "r:1"), w("r:2", "led:A"), w("led:K", "esp:GND")],
    );
    const pins = newPins();
    pins.setMode(2, PinMode.Output);
    pins.set(2, 5, 1000); // PwmFreq
    pins.set(2, 3, 16384); // Pwm duty ~25%
    expect(c.evaluate(pins).leds.get("led")).toBeCloseTo(0.25, 2);
    pins.set(2, 3, 65535);
    expect(c.evaluate(pins).leds.get("led")).toBe(1);
    pins.set(2, 3, 0);
    expect(c.evaluate(pins).leds.get("led")).toBe(0);
  });

  test("applyInputs also fills the logic-level ADC value", () => {
    const c = build([board], [w("esp:GPIO4", "esp:3V3")]);
    const pins = newPins();
    pins.setMode(4, PinMode.Input);
    c.applyInputs(pins, c.evaluate(pins));
    expect(pins.get(4, 2)).toBe(4095);
  });
});

describe("devices that read or drive nets", () => {
  const cat: Catalog = {
    ...catalog,
    pot: { kind: "analog-out", vcc: "VCC", gnd: "GND", out: "SIG", control: "pos" },
    pir: { kind: "digital-out", vcc: "VCC", gnd: "GND", out: "OUT", control: "motion" },
    relay: { kind: "relay", vcc: "VCC", gnd: "GND", in: "IN", com: "COM", no: "NO", nc: "NC" },
    buzzer: { kind: "buzzer", pos: "+", neg: "-", passive: true },
    abuzz: { kind: "buzzer", pos: "+", neg: "-", passive: false },
    rgb: { kind: "rgb-led", r: "R", g: "G", b: "B", common: "COM", commonType: "cathode" },
    servo: { kind: "servo", vcc: "VCC", gnd: "GND", sig: "SIG" },
    dht: { kind: "module", pins: ["VCC", "DATA", "GND"], vcc: "VCC", gnd: "GND" },
  };
  const make = (components: CircuitData["components"], wires: CircuitData["wires"]) =>
    new Circuit({ components, wires }, cat);
  const power = (id: string) => [w("esp:3V3", `${id}:VCC`), w(`${id}:GND`, "esp:GND")];

  test("potentiometer feeds the ADC only while powered", () => {
    const c = make(
      [board, { id: "p", type: "pot" }],
      [...power("p"), w("p:SIG", "esp:GPIO4")],
    );
    const pins = newPins();
    pins.setMode(4, PinMode.Input);
    const ev = c.evaluate(pins, {}, { p: { pos: 0.5 } });
    expect(ev.gpioAnalog.get(4)).toBe(Math.round(0.5 * 4095));
    c.applyInputs(pins, ev);
    expect(pins.get(4, 2)).toBe(Math.round(0.5 * 4095));
    // unpowered: no analog source, pin floats low
    const dead = make([board, { id: "p", type: "pot" }], [w("p:SIG", "esp:GPIO4")]);
    expect(dead.evaluate(pins, {}, { p: { pos: 0.9 } }).gpioAnalog.get(4)).toBe(0);
  });

  test("PIR drives its output high/low from the motion control", () => {
    const c = make([board, { id: "m", type: "pir" }], [...power("m"), w("m:OUT", "esp:GPIO4")]);
    const pins = newPins();
    pins.setMode(4, PinMode.Input);
    expect(c.evaluate(pins, {}, { m: { motion: 1 } }).gpioInput.get(4)).toBe(1);
    expect(c.evaluate(pins, {}, { m: { motion: 0 } }).gpioInput.get(4)).toBe(0);
  });

  test("relay switches COM between NO and NC and powers a load through it", () => {
    // GPIO4 drives the coil; 3V3 -> COM; NO -> resistor -> LED -> GND.
    const c = make(
      [board, { id: "rl", type: "relay" }, { id: "r", type: "res" }, { id: "led", type: "led" }],
      [
        ...power("rl"),
        w("esp:GPIO4", "rl:IN"),
        w("esp:3V3", "rl:COM"),
        w("rl:NO", "r:1"),
        w("r:2", "led:A"),
        w("led:K", "esp:GND"),
      ],
    );
    const pins = newPins();
    pins.setMode(4, PinMode.Output);
    pins.writeDigital(4, 0);
    let ev = c.evaluate(pins);
    expect(ev.outputs.get("rl")?.active).toBe(0);
    expect(ev.leds.get("led")).toBe(0);
    pins.writeDigital(4, 1);
    ev = c.evaluate(pins);
    expect(ev.outputs.get("rl")?.active).toBe(1);
    expect(ev.leds.get("led")).toBe(1);
  });

  test("buzzer: active sounds when powered, passive reports PWM frequency", () => {
    const c = make(
      [board, { id: "b", type: "buzzer" }],
      [w("esp:GPIO4", "b:+"), w("b:-", "esp:GND")],
    );
    const pins = newPins();
    pins.setMode(4, PinMode.Output);
    pins.writeDigital(4, 1);
    expect(c.evaluate(pins).outputs.get("b")).toEqual({ on: 1, freq: 0 });
    pins.set(4, 5, 440);
    pins.set(4, 3, 32768);
    expect(c.evaluate(pins).outputs.get("b")).toEqual({ on: 1, freq: 440 });
    pins.writeDigital(4, 0);
    pins.set(4, 5, 0);
    expect(c.evaluate(pins).outputs.get("b")?.on).toBe(0);
  });

  test("RGB LED channels are independent and honour PWM duty", () => {
    const c = make(
      [board, { id: "l", type: "rgb" }],
      [w("esp:GPIO2", "l:R"), w("esp:GPIO4", "l:G"), w("esp:GPIO5", "l:B"), w("l:COM", "esp:GND")],
    );
    const pins = newPins();
    for (const g of [2, 4, 5]) pins.setMode(g, PinMode.Output);
    pins.writeDigital(2, 1);
    pins.set(4, 5, 1000);
    pins.set(4, 3, 32768);
    const out = c.evaluate(pins).outputs.get("l")!;
    expect(out.r).toBe(1);
    expect(out.g).toBeCloseTo(0.5, 2);
    expect(out.b).toBe(0);
  });

  test("servo angle follows the PWM pulse width and needs power", () => {
    const c = make([board, { id: "s", type: "servo" }], [...power("s"), w("s:SIG", "esp:GPIO4")]);
    const pins = newPins();
    pins.setMode(4, PinMode.Output);
    pins.set(4, 5, 50);
    // 1.5 ms of a 20 ms period = 90 degrees
    pins.set(4, 3, Math.round((1500 / 20000) * 65535));
    expect(c.evaluate(pins).outputs.get("s")?.angle).toBeCloseTo(90, 0);
    pins.set(4, 3, Math.round((500 / 20000) * 65535));
    expect(c.evaluate(pins).outputs.get("s")?.angle).toBeCloseTo(0, 0);
    pins.set(4, 3, Math.round((2500 / 20000) * 65535));
    expect(c.evaluate(pins).outputs.get("s")?.angle).toBeCloseTo(180, 0);
    const dead = make([board, { id: "s", type: "servo" }], [w("s:SIG", "esp:GPIO4")]);
    expect(dead.evaluate(pins).outputs.get("s")?.angle).toBe(0);
  });

  test("module reports powered and gpiosOnNet maps its pins to the board", () => {
    const c = make(
      [board, { id: "d", type: "dht" }],
      [...power("d"), w("d:DATA", "esp:GPIO4")],
    );
    const ev = c.evaluate(newPins());
    expect(ev.outputs.get("d")?.powered).toBe(1);
    expect(c.gpiosOnNet("d:DATA", ev)).toEqual([4]);
    const unpowered = make([board, { id: "d", type: "dht" }], [w("d:DATA", "esp:GPIO4")]);
    expect(unpowered.evaluate(newPins()).outputs.get("d")?.powered).toBe(0);
  });
});
