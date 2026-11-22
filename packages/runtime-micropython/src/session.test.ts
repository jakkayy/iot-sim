import { describe, expect, test } from "bun:test";
import { PinField, PinMode, PinState, SimHal, VirtualClock, createClockBuffer, createPinBuffer } from "@esp32-sim/sim-core";
import { startMicroPython } from "./session";
import { lockdownGlobals } from "./lockdown";

const loaderUrl = new URL(
  "../node_modules/@micropython/micropython-webassembly-pyscript/micropython.mjs",
  import.meta.url,
).href;

/** A real MicroPython wasm on a HAL with a fake clock; `onSleep` scripts the outside world. */
async function boot(opts: { onSleep?: (now: number, pins: PinState) => void } = {}) {
  let t = 0;
  const clock = new VirtualClock(createClockBuffer(), () => t, true);
  const pins = new PinState(createPinBuffer());
  const hal = new SimHal({
    pins,
    clock,
    sleep: (ms) => {
      t += ms;
      opts.onSleep?.(t, pins);
    },
  });
  const out: string[] = [];
  const err: string[] = [];
  const session = await startMicroPython({
    loaderUrl,
    hal,
    lockdown: false,
    onStdout: (l) => out.push(l),
    onStderr: (l) => err.push(l),
  });
  return { session, pins, hal, out, err, now: () => t };
}

describe("machine.Pin + time", () => {
  test("blink toggles the output latch with virtual delays", async () => {
    const levels: number[] = [];
    const ctx = await boot({ onSleep: (_t, pins) => levels.push(pins.readDigital(2)) });
    const res = ctx.session.run(`
from machine import Pin
import time
led = Pin(2, Pin.OUT)
for _ in range(2):
    led.value(1)
    time.sleep_ms(100)
    led.off()
    time.sleep_ms(100)
`);
    expect(res).toEqual({ ok: true });
    expect(ctx.pins.get(2, PinField.Mode)).toBe(PinMode.Output);
    // First sleep slices see level 1, later ones 0.
    expect(levels[0]).toBe(1);
    expect(levels.at(-1)).toBe(0);
    expect(ctx.now()).toBeGreaterThanOrEqual(400);
  });

  test("input pull-up maps to InputPullup and reads the circuit level", async () => {
    const ctx = await boot();
    ctx.pins.set(4, PinField.Input, 1);
    const res = ctx.session.run(`
from machine import Pin
b = Pin(4, Pin.IN, Pin.PULL_UP)
print('v', b.value())
`);
    expect(res.ok).toBe(true);
    expect(ctx.pins.get(4, PinField.Mode)).toBe(PinMode.InputPullup);
    expect(ctx.out).toContain("v 1");
  });

  test("Pin.irq handler runs inside sleep_ms when the input changes", async () => {
    const ctx = await boot({
      onSleep: (now, pins) => {
        if (now >= 20) pins.set(4, PinField.Input, 1);
      },
    });
    const res = ctx.session.run(`
from machine import Pin
import time
hits = []
p = Pin(4, Pin.IN)
p.irq(lambda pin: hits.append(time.ticks_ms()), Pin.IRQ_RISING)
time.sleep_ms(100)
print('hits', len(hits))
`);
    expect(res.ok).toBe(true);
    expect(ctx.out).toContain("hits 1");
  });

  test("Timer fires periodically", async () => {
    const ctx = await boot();
    const res = ctx.session.run(`
from machine import Timer
import time
n = [0]
def tick(t):
    n[0] += 1
t = Timer(0)
t.init(period=10, mode=Timer.PERIODIC, callback=tick)
time.sleep_ms(55)
t.deinit()
print('ticks', n[0])
`);
    expect(res.ok).toBe(true);
    const ticks = Number(ctx.out.find((l) => l.startsWith("ticks"))?.split(" ")[1]);
    expect(ticks).toBeGreaterThanOrEqual(4);
    expect(ticks).toBeLessThanOrEqual(6);
  });

  test("PWM and ADC", async () => {
    const ctx = await boot();
    ctx.pins.set(32, PinField.Analog, 2048);
    const res = ctx.session.run(`
from machine import Pin, PWM, ADC
pwm = PWM(Pin(2), freq=1000, duty=512)
print('adc', ADC(Pin(32)).read())
`);
    expect(res.ok).toBe(true);
    expect(ctx.pins.get(2, PinField.PwmFreq)).toBe(1000);
    expect(ctx.pins.get(2, PinField.Pwm)).toBe(512 * 64);
    expect(ctx.out).toContain("adc 2048");
  });

  test("time.ticks_* follow the virtual clock", async () => {
    const ctx = await boot();
    const res = ctx.session.run(`
import time
a = time.ticks_ms()
time.sleep(0.25)
b = time.ticks_ms()
print('diff', time.ticks_diff(b, a))
`);
    expect(res.ok).toBe(true);
    const diff = Number(ctx.out.find((l) => l.startsWith("diff"))?.split(" ")[1]);
    expect(diff).toBeGreaterThanOrEqual(250);
    expect(diff).toBeLessThan(260);
  });
});

describe("errors and isolation", () => {
  test("NameError is reported at the user's line", async () => {
    const ctx = await boot();
    const res = ctx.session.run("x = 1\ny = x + nope\n");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.type).toBe("NameError");
      expect(res.error.line).toBe(2);
    }
    expect(ctx.err.join("")).toContain("NameError");
  });

  test("SyntaxError carries a line", async () => {
    const ctx = await boot();
    const res = ctx.session.run("a = 1\nb = (\n");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.type).toBe("SyntaxError");
  });

  test("machine.reset() ends the program without an error", async () => {
    const ctx = await boot();
    expect(ctx.session.run("import machine\nmachine.reset()")).toEqual({ ok: true });
  });

  test("import js / jsffi are blocked with an ImportError", async () => {
    const ctx = await boot();
    for (const code of ["import js\njs.globalThis", "from js import fetch", "import jsffi\njsffi.create_proxy"]) {
      const res = ctx.session.run(code);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.type).toBe("ImportError");
    }
  });

  test("lockdownGlobals removes network/spawn globals from a target", () => {
    const target: Record<string, unknown> = { fetch: () => 1, WebSocket: class {}, keep: 1 };
    const removed = lockdownGlobals(target);
    expect(removed.sort()).toEqual(["WebSocket", "fetch"]);
    expect(target.fetch).toBeUndefined();
    expect(target.keep).toBe(1);
  });
});
