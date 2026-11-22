import { describe, expect, test } from "bun:test";
import {
  Circuit, PinField, PinState, SimHal, VirtualClock, createClockBuffer, createPinBuffer,
} from "@esp32-sim/sim-core";
import {
  DeviceMemory, attachDevices, buildTopology, catalog, lcdRow, ssd1306Pixel,
} from "@esp32-sim/devices";
import { loadSketch, runSketch } from "./index";

const fixture = (name: string) =>
  Bun.file(new URL(`../fixtures/${name}.wasm`, import.meta.url).pathname).arrayBuffer();

// One board wired to every kind of device the examples use.
const circuit = new Circuit(
  {
    components: [
      { id: "esp", type: "esp32-devkit" },
      { id: "oled", type: "ssd1306" },
      { id: "lcd", type: "lcd-i2c" },
      { id: "dht", type: "dht22" },
      { id: "us", type: "hcsr04" },
      { id: "servo", type: "servo" },
    ],
    wires: [
      { id: "1", a: "oled:SDA", b: "esp:GPIO21" },
      { id: "2", a: "oled:SCL", b: "esp:GPIO22" },
      { id: "3", a: "lcd:SDA", b: "esp:GPIO21" },
      { id: "4", a: "lcd:SCL", b: "esp:GPIO22" },
      { id: "5", a: "dht:DATA", b: "esp:GPIO4" },
      { id: "6", a: "us:TRIG", b: "esp:GPIO5" },
      { id: "7", a: "us:ECHO", b: "esp:GPIO18" },
      { id: "8", a: "servo:SIG", b: "esp:GPIO13" },
    ],
  },
  catalog,
);

function setup(opts: { onSleep?: (now: number, pins: PinState) => void } = {}) {
  let t = 0;
  const topo = buildTopology(circuit);
  const mem = DeviceMemory.create(topo.devices);
  const pins = new PinState(createPinBuffer());
  const clock = new VirtualClock(createClockBuffer(), () => t, true);
  const hal = new SimHal({
    pins,
    clock,
    sleep: (ms) => {
      t += ms;
      opts.onSleep?.(t, pins);
    },
  });
  attachDevices(hal, topo, mem);
  const lines: string[] = [];
  const load = async (name: string) => loadSketch(await fixture(name), hal, { onStdout: (l) => lines.push(l) });
  return { hal, pins, mem, lines, load, now: () => t };
}

describe("OLED with Adafruit_SSD1306 / Adafruit_GFX", () => {
  test("text, rectangle and circle reach the display", async () => {
    const { load, mem } = setup();
    runSketch(await load("oled"), { maxLoops: 1 });
    const f = mem.frame("oled")!;
    expect(f[0] & 1).toBe(1);
    const lit = (x0: number, y0: number, x1: number, y1: number) => {
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (ssd1306Pixel(f, x, y)) n++;
      return n;
    };
    expect(lit(0, 0, 60, 8)).toBeGreaterThan(40); // "Hello OLED" glyph pixels
    expect(ssd1306Pixel(f, 0, 20) && ssd1306Pixel(f, 59, 39)).toBe(true); // rectangle corners
    expect(ssd1306Pixel(f, 30, 30)).toBe(false); // inside the outlined rectangle
    expect(ssd1306Pixel(f, 100, 30)).toBe(true); // circle centre
    expect(ssd1306Pixel(f, 100, 60)).toBe(false);
  });

  test("a glyph is drawn with the standard 5x7 font ('H' = two verticals and a bar)", async () => {
    const { load, mem } = setup();
    runSketch(await load("oled"), { maxLoops: 1 });
    const f = mem.frame("oled")!;
    const col = (x: number) => Array.from({ length: 8 }, (_, y) => (ssd1306Pixel(f, x, y) ? 1 : 0)).join("");
    expect(col(0)).toBe("11111110"); // 0x7F: left stem
    expect(col(2)).toBe("00010000"); // 0x08: crossbar
    expect(col(4)).toBe("11111110"); // right stem
    expect(col(5)).toBe("00000000"); // spacing column
  });
});

describe("LiquidCrystal_I2C", () => {
  test("prints text and numbers on both rows", async () => {
    const { load, mem } = setup();
    runSketch(await load("lcd"), { maxLoops: 1 });
    const f = mem.frame("lcd")!;
    expect(lcdRow(f, 0)).toBe("Hello, LCD!     ");
    expect(lcdRow(f, 1)).toBe("42 3.50         ");
    expect(f[0] & 2).toBe(2); // backlight
  });
});

describe("DHT sensor library", () => {
  test("reads the sliders while powered", async () => {
    const { load, mem, lines } = setup();
    mem.set("dht", "powered", 1);
    mem.set("dht", "temperature", 23.5);
    mem.set("dht", "humidity", 61);
    runSketch(await load("dht"), { maxLoops: 1 });
    expect(lines).toEqual(["Temperature: 23.50 C, Humidity: 61.00 %"]);
  });

  test("reports a failed read (NaN) when unpowered", async () => {
    const { load, lines } = setup();
    runSketch(await load("dht"), { maxLoops: 1 });
    expect(lines).toEqual(["Failed to read from DHT sensor!"]);
  });
});

describe("ESP32Servo", () => {
  test("write(angle) becomes a 50 Hz pulse the servo model reads back", async () => {
    const pulses: number[] = [];
    const { load, pins } = setup({
      onSleep: (_now, p) => pulses.push(p.get(13, PinField.Pwm)),
    });
    runSketch(await load("servo"), { maxLoops: 1 });
    expect(pins.get(13, PinField.PwmFreq)).toBe(50);
    const us = (d: number) => (d / 65535) * 20000;
    expect(us(pulses[0])).toBeCloseTo(500, -1);
    // second delay(1000) (slices ~500..1000) is the 90 degree pose: 1500 us
    expect(us(pulses[750])).toBeCloseTo(1500, -1);
    expect(us(pulses.at(-1)!)).toBeCloseTo(2500, -1);
  });
});

describe("pulseIn / interrupts / ADC / PWM", () => {
  test("HC-SR04 distance through pulseIn", async () => {
    const { load, mem, lines } = setup();
    mem.set("us", "powered", 1);
    mem.set("us", "distance", 100);
    runSketch(await load("ultrasonic"), { maxLoops: 1 });
    expect(lines).toEqual(["distance=100.0 cm"]);
  });

  test("no sensor power: pulseIn times out and prints 0", async () => {
    const { load, lines } = setup();
    runSketch(await load("ultrasonic"), { maxLoops: 1 });
    expect(lines).toEqual(["distance=0.0 cm"]);
  });

  test("attachInterrupt handler runs on each falling edge, even inside delay()", async () => {
    // The button is released (1), then pressed (0) at t=150ms and t=450ms.
    const { load, lines, pins } = setup({
      onSleep: (now, p) => {
        const pressed = (now >= 150 && now < 250) || (now >= 450 && now < 550);
        p.set(4, PinField.Input, pressed ? 0 : 1);
      },
    });
    pins.set(4, PinField.Input, 1);
    runSketch(await load("interrupt"), { maxLoops: 7 });
    expect(lines.at(-1)).toBe("presses=2");
    expect(lines[0]).toBe("presses=0");
  });

  test("analogRead + LEDC PWM + tone", async () => {
    const { load, lines, pins, hal } = setup();
    pins.set(32, PinField.Analog, 2048);
    runSketch(await load("analog"), { maxLoops: 1 });
    expect(lines).toEqual(["2048"]);
    // map(2048, 0..4095 -> 0..255) = 127 of 255 -> ~49.8% duty on pin 2 at 5 kHz
    expect(pins.get(2, PinField.PwmFreq)).toBe(5000);
    expect(pins.get(2, PinField.Pwm)).toBeCloseTo((127 / 255) * 65535, -2);
    // tone(25, 440, 50) started 440 Hz and its timer stopped it during the 100 ms delay
    expect(pins.get(25, PinField.PwmFreq)).toBe(0);
    void hal;
  });
});
