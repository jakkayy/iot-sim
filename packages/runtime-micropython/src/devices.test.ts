import { describe, expect, test } from "bun:test";
import {
  Circuit, PinState, SimHal, VirtualClock, createClockBuffer, createPinBuffer,
} from "@esp32-sim/sim-core";
import {
  DeviceMemory, attachDevices, buildTopology, catalog, lcdRow, ssd1306Pixel,
} from "@esp32-sim/devices";
import { startMicroPython } from "./session";

const loaderUrl = new URL(
  "../node_modules/@micropython/micropython-webassembly-pyscript/micropython.mjs",
  import.meta.url,
).href;

// ESP32 wired to an OLED + LCD on I2C (21/22), a DHT22 on GPIO4 and an HC-SR04 (trig 5, echo 18).
const circuit = new Circuit(
  {
    components: [
      { id: "esp", type: "esp32-devkit" },
      { id: "oled", type: "ssd1306" },
      { id: "lcd", type: "lcd-i2c" },
      { id: "dht", type: "dht22" },
      { id: "us", type: "hcsr04" },
    ],
    wires: [
      { id: "1", a: "oled:SDA", b: "esp:GPIO21" },
      { id: "2", a: "oled:SCL", b: "esp:GPIO22" },
      { id: "3", a: "lcd:SDA", b: "esp:GPIO21" },
      { id: "4", a: "lcd:SCL", b: "esp:GPIO22" },
      { id: "5", a: "dht:DATA", b: "esp:GPIO4" },
      { id: "6", a: "us:TRIG", b: "esp:GPIO5" },
      { id: "7", a: "us:ECHO", b: "esp:GPIO18" },
    ],
  },
  catalog,
);

async function boot() {
  let t = 0;
  const topo = buildTopology(circuit);
  const mem = DeviceMemory.create(topo.devices);
  const clock = new VirtualClock(createClockBuffer(), () => t, true);
  const hal = new SimHal({ pins: new PinState(createPinBuffer()), clock, sleep: (ms) => (t += ms) });
  attachDevices(hal, topo, mem);
  const out: string[] = [];
  const session = await startMicroPython({
    loaderUrl,
    hal,
    lockdown: false,
    onStdout: (l) => out.push(l),
    onStderr: (l) => out.push(`ERR ${l}`),
  });
  return { session, mem, out };
}

const I2C = "from machine import Pin, I2C\ni2c = I2C(0, scl=Pin(22), sda=Pin(21))\n";

describe("I2C", () => {
  test("scan finds both displays on the wired pins and nothing elsewhere", async () => {
    const { session, out } = await boot();
    const res = session.run(`${I2C}print(i2c.scan())
print(I2C(1, scl=Pin(26), sda=Pin(25)).scan())
`);
    expect(res.ok).toBe(true);
    expect(out).toContain("[39, 60]");
    expect(out).toContain("[]");
  });

  test("writing to an absent address raises OSError(19) like real hardware", async () => {
    const { session, out } = await boot();
    const res = session.run(`${I2C}try:
    i2c.writeto(0x50, b'\\x00')
except OSError as e:
    print('errno', e.args[0])
`);
    expect(res.ok).toBe(true);
    expect(out).toContain("errno 19");
  });
});

describe("SSD1306 driver", () => {
  test("text appears in the shared frame buffer", async () => {
    const { session, mem } = await boot();
    const res = session.run(`${I2C}from ssd1306 import SSD1306_I2C
oled = SSD1306_I2C(128, 64, i2c)
oled.fill(0)
oled.text("Hi", 0, 0)
oled.show()
`);
    expect(res.ok).toBe(true);
    const frame = mem.frame("oled")!;
    expect(frame[0] & 1).toBe(1); // display on
    let lit = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) if (ssd1306Pixel(frame, x, y)) lit++;
    expect(lit).toBeGreaterThan(10);
    expect(ssd1306Pixel(frame, 100, 50)).toBe(false);
  });

  test("fill(1) lights the whole screen and invert flips it", async () => {
    const { session, mem } = await boot();
    const frame = mem.frame("oled")!;
    session.run(`${I2C}from ssd1306 import SSD1306_I2C
oled = SSD1306_I2C(128, 64, i2c)
oled.fill(1)
oled.show()
`);
    expect(ssd1306Pixel(frame, 0, 0) && ssd1306Pixel(frame, 127, 63)).toBe(true);
    session.run(`${I2C}from ssd1306 import SSD1306_I2C
SSD1306_I2C(128, 64, i2c).invert(1)
`);
    // a new driver instance re-inits the panel (clears), then invert flips the flag
    expect(frame[0] & 2).toBe(2);
  });
});

describe("LCD 16x2 driver", () => {
  test("putstr and move_to write both rows", async () => {
    const { session, mem } = await boot();
    const res = session.run(`${I2C}from i2c_lcd import I2cLcd
lcd = I2cLcd(i2c, 0x27, 2, 16)
lcd.putstr("Hello")
lcd.move_to(0, 1)
lcd.putstr("World")
`);
    expect(res.ok).toBe(true);
    const f = mem.frame("lcd")!;
    expect(lcdRow(f, 0)).toBe("Hello           ");
    expect(lcdRow(f, 1)).toBe("World           ");
    expect(f[0] & 2).toBe(2); // backlight on
  });

  test("clear and backlight_off", async () => {
    const { session, mem } = await boot();
    session.run(`${I2C}from i2c_lcd import I2cLcd
lcd = I2cLcd(i2c, 0x27, 2, 16)
lcd.putstr("abc")
lcd.clear()
lcd.backlight_off()
`);
    const f = mem.frame("lcd")!;
    expect(lcdRow(f, 0)).toBe(" ".repeat(16));
    expect(f[0] & 2).toBe(0);
  });
});

describe("DHT22 and HC-SR04", () => {
  test("DHT22 measures the slider values while powered, times out when unpowered", async () => {
    const { session, mem, out } = await boot();
    const code = `import dht
from machine import Pin
d = dht.DHT22(Pin(4))
try:
    d.measure()
    print('T', d.temperature(), 'H', d.humidity())
except OSError as e:
    print('timeout', e.args[0])
`;
    session.run(code);
    expect(out).toContain("timeout 110");
    mem.set("dht", "powered", 1);
    mem.set("dht", "temperature", 31.5);
    session.run(code);
    expect(out).toContain("T 31.5 H 50.0");
  });

  test("HC-SR04: time_pulse_us returns distance_cm * 58", async () => {
    const { session, mem, out } = await boot();
    mem.set("us", "powered", 1);
    mem.set("us", "distance", 100);
    const res = session.run(`from machine import Pin, time_pulse_us
import time
trig = Pin(5, Pin.OUT)
echo = Pin(18, Pin.IN)
trig.value(1)
time.sleep_us(10)
trig.value(0)
d = time_pulse_us(echo, 1, 30000)
print('cm', d / 58)
`);
    expect(res.ok).toBe(true);
    expect(out).toContain("cm 100.0");
  });

  test("HC-SR04 without power times out with -2", async () => {
    const { session, out } = await boot();
    session.run(`from machine import Pin, time_pulse_us
print('t', time_pulse_us(Pin(18, Pin.IN), 1, 30000))
`);
    expect(out).toContain("t -2");
  });
});
