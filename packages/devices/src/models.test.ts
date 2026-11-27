import { describe, expect, test } from "bun:test";
import { Circuit, PinMode, PinState, SimHal, VirtualClock, createClockBuffer, createPinBuffer } from "@esp32-sim/sim-core";
import {
  DeviceMemory, Lcd1602, Ssd1306, attachDevices, buildTopology, catalog, computeLayout, lcdRow, ssd1306Pixel,
} from "./index";

const frameOf = (size: number) => new Uint8Array(size);

describe("Ssd1306", () => {
  const init = [0x00, 0xae, 0x20, 0x00, 0x21, 0, 127, 0x22, 0, 7, 0xaf];

  test("display on/off and invert flags", () => {
    const f = frameOf(1026);
    const d = new Ssd1306(f);
    d.write(new Uint8Array([0x00, 0xaf]));
    expect(f[0] & 1).toBe(1);
    d.write(new Uint8Array([0x00, 0xa7]));
    expect(f[0] & 2).toBe(2);
    d.write(new Uint8Array([0x00, 0xae, 0xa6]));
    expect(f[0]).toBe(0);
  });

  test("horizontal mode: data fills pages left to right and wraps to the next page", () => {
    const f = frameOf(1026);
    const d = new Ssd1306(f);
    d.write(new Uint8Array(init));
    const data = new Uint8Array(1 + 130);
    data[0] = 0x40;
    for (let i = 0; i < 130; i++) data[1 + i] = (i + 1) & 0xff;
    d.write(data);
    expect(f[2 + 0]).toBe(1);
    expect(f[2 + 127]).toBe(128);
    expect(f[2 + 128]).toBe(129); // wrapped to page 1, column 0
    expect(f[2 + 129]).toBe(130);
  });

  test("a full-screen write of 0xFF lights every pixel; pixel lookup honours bit order and invert", () => {
    const f = frameOf(1026);
    const d = new Ssd1306(f);
    d.write(new Uint8Array(init));
    const all = new Uint8Array(1 + 1024).fill(0xff);
    all[0] = 0x40;
    d.write(all);
    expect(ssd1306Pixel(f, 0, 0) && ssd1306Pixel(f, 127, 63)).toBe(true);
    d.write(new Uint8Array([0x00, 0xa7]));
    expect(ssd1306Pixel(f, 5, 5)).toBe(false);
    // LSB is the top pixel of each 8-row page
    const g = frameOf(1026);
    const e = new Ssd1306(g);
    e.write(new Uint8Array([0x00, 0x20, 0x00])); // horizontal addressing
    e.write(new Uint8Array([0x40, 0b00000101])); // data goes in its own transfer
    expect(ssd1306Pixel(g, 0, 0)).toBe(true);
    expect(ssd1306Pixel(g, 0, 1)).toBe(false);
    expect(ssd1306Pixel(g, 0, 2)).toBe(true);
  });

  test("page mode (power-on default) uses set-page and column nibbles", () => {
    const f = frameOf(1026);
    const d = new Ssd1306(f);
    d.write(new Uint8Array([0x00, 0xb3, 0x02, 0x11])); // page 3, column 0x12
    d.write(new Uint8Array([0x40, 0xaa]));
    expect(f[2 + 3 * 128 + 0x12]).toBe(0xaa);
  });

  test("commands with arguments consume them (contrast), single control bytes work", () => {
    const f = frameOf(1026);
    const d = new Ssd1306(f);
    d.write(new Uint8Array([0x00, 0x81, 0x33]));
    expect(f[1]).toBe(0x33);
    d.write(new Uint8Array([0x80, 0xaf, 0xc0, 0x55]));
    expect(f[0] & 1).toBe(1);
    expect(d.write(new Uint8Array([0x13]))).toBe(false); // bad control byte
  });
});

describe("Lcd1602 (PCF8574 backpack)", () => {
  /** Send a nibble the way a real driver does: data on P7..P4 with E pulsed high then low. */
  const nibble = (n: number, rs: number, bl = 0x08) => [(n << 4) | bl | 4 | rs, (n << 4) | bl | rs];
  const byte = (b: number, rs: number) => [...nibble(b >> 4, rs), ...nibble(b & 15, rs)];
  const boot = () => {
    const f = frameOf(34);
    const lcd = new Lcd1602(f);
    lcd.write(new Uint8Array([...nibble(3, 0), ...nibble(3, 0), ...nibble(3, 0), ...nibble(2, 0)]));
    lcd.write(new Uint8Array([...byte(0x28, 0), ...byte(0x0c, 0), ...byte(0x06, 0), ...byte(0x01, 0)]));
    return { f, lcd };
  };
  const print = (lcd: Lcd1602, s: string) => lcd.write(new Uint8Array([...s].flatMap((c) => byte(c.charCodeAt(0), 1))));

  test("prints text on row 0 and row 1 via DDRAM addresses", () => {
    const { f, lcd } = boot();
    print(lcd, "Hello");
    lcd.write(new Uint8Array(byte(0xc0, 0))); // DDRAM 0x40 = row 1
    print(lcd, "World");
    expect(lcdRow(f, 0)).toBe("Hello           ");
    expect(lcdRow(f, 1)).toBe("World           ");
  });

  test("clear, cursor placement and display flags", () => {
    const { f, lcd } = boot();
    print(lcd, "abc");
    lcd.write(new Uint8Array(byte(0x01, 0)));
    expect(lcdRow(f, 0)).toBe(" ".repeat(16));
    lcd.write(new Uint8Array(byte(0x80 | 5, 0)));
    print(lcd, "X");
    expect(lcdRow(f, 0)[5]).toBe("X");
    expect(f[0] & 1).toBe(1); // display on
    lcd.write(new Uint8Array(byte(0x08, 0))); // display off
    expect(f[0] & 1).toBe(0);
  });

  test("backlight bit follows P3", () => {
    const { f, lcd } = boot();
    lcd.write(new Uint8Array([0x00]));
    expect(f[0] & 2).toBe(0);
    lcd.write(new Uint8Array([0x08]));
    expect(f[0] & 2).toBe(2);
  });

  test("ignores traffic until the 4-bit handshake", () => {
    const f = frameOf(34);
    const lcd = new Lcd1602(f);
    lcd.write(new Uint8Array(byte(0x41, 1))); // before init: dropped
    expect(lcdRow(f, 0)).toBe(" ".repeat(16));
  });
});

describe("topology and attachment from a real circuit", () => {
  const circuit = new Circuit(
    {
      components: [
        { id: "esp", type: "esp32-devkit" },
        { id: "oled", type: "ssd1306" },
        { id: "d", type: "dht22" },
        { id: "us", type: "hcsr04" },
      ],
      wires: [
        { id: "1", a: "oled:SDA", b: "esp:GPIO21" },
        { id: "2", a: "oled:SCL", b: "esp:GPIO22" },
        { id: "3", a: "oled:VCC", b: "esp:3V3" },
        { id: "4", a: "oled:GND", b: "esp:GND.1" },
        { id: "5", a: "d:DATA", b: "esp:GPIO4" },
        { id: "6", a: "us:ECHO", b: "esp:GPIO18" },
      ],
    },
    catalog,
  );

  test("buildTopology maps modules to GPIOs", () => {
    const t = buildTopology(circuit);
    expect(t.i2c).toEqual([{ id: "oled", type: "ssd1306", sda: 21, scl: 22 }]);
    expect(t.dht).toEqual([{ id: "d", gpio: 4 }]);
    expect(t.hcsr04).toEqual([{ id: "us", echoGpio: 18 }]);
  });

  test("attached models are reachable through the HAL and follow shared memory", () => {
    const topo = buildTopology(circuit);
    const mem = DeviceMemory.create(topo.devices);
    let t = 0;
    const hal = new SimHal({
      pins: new PinState(createPinBuffer()),
      clock: new VirtualClock(createClockBuffer(), () => t, true),
      sleep: (ms) => (t += ms),
    });
    attachDevices(hal, topo, mem);
    expect(hal.i2cScan(21, 22)).toEqual([0x3c]);
    expect(hal.i2cWrite(21, 22, 0x3c, new Uint8Array([0x00, 0xaf]))).toBe(true);
    expect(mem.frame("oled")![0] & 1).toBe(1);

    // sensors need power and follow the sliders
    expect(hal.sensorRead("dht22", 4)).toBeNull();
    mem.set("d", "powered", 1);
    mem.set("d", "temperature", 31.5);
    expect(hal.sensorRead("dht22", 4)).toEqual({ temperature: 31.5, humidity: 50 });
    mem.set("us", "powered", 1);
    mem.set("us", "distance", 100);
    expect(hal.pulseIn(18, 1, 30000)).toBe(5800);
  });

  test("layout is identical on both sides and defaults are seeded", () => {
    const refs = [{ id: "d", type: "dht22" }, { id: "o", type: "ssd1306" }];
    expect(computeLayout(refs)).toEqual(computeLayout(refs));
    const mem = DeviceMemory.create(refs);
    expect(mem.get("d", "temperature")).toBe(25);
    expect(mem.get("d", "humidity")).toBe(50);
    expect(mem.frame("o")!.length).toBe(1026);
    expect(mem.frame("d")).toBeNull();
    const other = new DeviceMemory(mem.buffer, computeLayout(refs));
    mem.set("d", "temperature", 9);
    expect(other.get("d", "temperature")).toBe(9);
  });

  test("a pin mode is untouched by attaching devices", () => {
    const pins = new PinState(createPinBuffer());
    expect(pins.get(4, 0)).toBe(PinMode.Unset);
  });
});
