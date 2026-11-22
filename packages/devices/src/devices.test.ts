import { describe, expect, test } from "bun:test";
import { Circuit, PinMode, PinState, createPinBuffer } from "@esp32-sim/sim-core";
import { catalog, devices, esp32Devkit, gpioNumber, pinDir, pinHint } from "./index";

describe("device definitions", () => {
  test("geometry pins match element pins for every device", () => {
    for (const d of Object.values(devices)) {
      const geo = d.pins.map((p) => p.name).sort();
      const el = d.element;
      const expected =
        el.kind === "board"
          ? Object.keys(el.pins)
          : el.kind === "led"
            ? [el.anode, el.cathode]
            : [el.a, el.b];
      expect(geo).toEqual([...expected].sort());
    }
  });

  test("ESP32 has the 30 DevKit pins and unique GPIOs", () => {
    expect(esp32Devkit.pins.length).toBe(30);
    const gpios = esp32Devkit.pins.map((p) => gpioNumber(p.name)).filter((g) => g !== undefined);
    expect(new Set(gpios).size).toBe(gpios.length);
  });

  test("pin hints describe capabilities", () => {
    expect(pinHint("GPIO34")).toContain("Input-only (no output, no pull-up)");
    expect(pinHint("GPIO32").join()).toContain("ADC1");
    expect(pinHint("GPIO4").join()).toContain("ADC2");
    expect(pinHint("5V").join()).toContain("never");
  });
});

describe("pin directions", () => {
  test("wires leave pins toward the device edge", () => {
    const find = (d: (typeof devices)[string], n: string) => d.pins.find((p) => p.name === n)!;
    expect(pinDir(esp32Devkit, find(esp32Devkit, "GPIO2"))).toBe("right");
    expect(pinDir(esp32Devkit, find(esp32Devkit, "GPIO34"))).toBe("left");
    expect(pinDir(devices.led, find(devices.led, "A"))).toBe("down");
    expect(pinDir(devices.resistor, find(devices.resistor, "2"))).toBe("right");
  });
});

describe("Blink circuit built from the real catalog", () => {
  test("GPIO2 -> resistor -> LED -> GND lights up", () => {
    const circuit = new Circuit(
      {
        components: [
          { id: "esp", type: "esp32-devkit" },
          { id: "r1", type: "resistor" },
          { id: "led1", type: "led" },
        ],
        wires: [
          { id: "a", a: "esp:GPIO2", b: "r1:1" },
          { id: "b", a: "r1:2", b: "led1:A" },
          { id: "c", a: "led1:K", b: "esp:GND.2" },
        ],
      },
      catalog,
    );
    const pins = new PinState(createPinBuffer());
    pins.setMode(2, PinMode.Output);
    pins.writeDigital(2, 1);
    const ev = circuit.evaluate(pins);
    expect(ev.leds.get("led1")).toBe(1);
    expect(ev.warnings).toEqual([]);
  });
});
