import { describe, expect, test } from "bun:test";
import { Circuit, PinMode, PinState, createPinBuffer } from "@esp32-sim/sim-core";
import { catalog, defaultValues, devices, esp32Devkit, gpioNumber, pinDir, pinHint } from "./index";

describe("device definitions", () => {
  test("geometry pins match element pins for every device", () => {
    for (const d of Object.values(devices)) {
      const geo = d.pins.map((p) => p.name).sort();
      const el = d.element;
      const expected: string[] =
        el.kind === "board"
          ? Object.keys(el.pins)
          : el.kind === "led"
            ? [el.anode, el.cathode]
            : el.kind === "resistor" || el.kind === "switch"
              ? [el.a, el.b]
              : el.kind === "rgb-led"
                ? [el.r, el.g, el.b, el.common]
                : el.kind === "buzzer"
                  ? [el.pos, el.neg]
                  : el.kind === "relay"
                    ? [el.vcc, el.gnd, el.in, el.com, el.no, el.nc]
                    : el.kind === "analog-out" || el.kind === "digital-out"
                      ? [el.vcc, el.gnd, el.out]
                      : el.kind === "servo"
                        ? [el.vcc, el.gnd, el.sig]
                        : el.pins;
      expect(geo, d.type).toEqual([...expected].sort());
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

describe("round-2 device catalog", () => {
  test("every plan device exists", () => {
    for (const t of [
      "potentiometer", "buzzer", "relay", "rgb-led", "dht22", "pir", "ldr",
      "hcsr04", "servo", "ssd1306", "lcd-i2c",
    ]) {
      expect(devices[t], t).toBeDefined();
    }
  });

  test("controls have sane defaults inside their range", () => {
    for (const d of Object.values(devices)) {
      for (const c of d.controls ?? []) {
        if (c.kind === "slider") {
          expect(c.default).toBeGreaterThanOrEqual(c.min);
          expect(c.default).toBeLessThanOrEqual(c.max);
        }
      }
    }
    expect(defaultValues(devices.dht22.controls)).toEqual({ temperature: 25, humidity: 50 });
    expect(defaultValues(devices.button.controls)).toEqual({});
  });

  test("every pin sits on the device boundary or inside its box", () => {
    for (const d of Object.values(devices)) {
      for (const p of d.pins) {
        expect(p.x, `${d.type}:${p.name}`).toBeGreaterThanOrEqual(0);
        expect(p.x, `${d.type}:${p.name}`).toBeLessThanOrEqual(d.width);
        expect(p.y, `${d.type}:${p.name}`).toBeGreaterThanOrEqual(0);
        expect(p.y, `${d.type}:${p.name}`).toBeLessThanOrEqual(d.height);
      }
    }
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
