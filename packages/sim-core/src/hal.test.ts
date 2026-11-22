import { describe, expect, test } from "bun:test";
import { VirtualClock, createClockBuffer } from "./clock";
import { SimHal } from "./hal";
import { PinField, PinMode, PinState, createPinBuffer } from "./pins";

/** HAL on a fake clock: sleeping advances time and can run a scripted hook. */
function setup(opts: { onSleep?: (now: number) => void } = {}) {
  let t = 0;
  const clock = new VirtualClock(createClockBuffer(), () => t, true);
  const pins = new PinState(createPinBuffer());
  const hal = new SimHal({
    pins,
    clock,
    sleep: (realMs) => {
      t += realMs;
      opts.onSleep?.(t);
    },
  });
  return { hal, pins, clock, now: () => t, advance: (ms: number) => (t += ms) };
}

describe("SimHal time", () => {
  test("delay advances virtual time by the requested amount", () => {
    const { hal, clock } = setup();
    hal.delay(100);
    expect(clock.nowMs()).toBeGreaterThanOrEqual(100);
    expect(clock.nowMs()).toBeLessThan(103);
  });

  test("delay is shorter in real time at higher speed", () => {
    const { hal, clock, now } = setup();
    clock.setSpeed(10);
    hal.delay(100);
    expect(now()).toBeLessThan(11);
    expect(clock.nowMs()).toBeGreaterThanOrEqual(100);
  });

  test("millis/micros read the virtual clock", () => {
    const { hal, advance, clock } = setup();
    clock.setSpeed(2);
    advance(500);
    expect(hal.millis()).toBe(1000);
    expect(hal.micros()).toBe(1_000_000);
  });

  test("until ends a delay early", () => {
    const { hal, clock } = setup();
    let polls = 0;
    hal.delay(1000, () => ++polls >= 3);
    expect(clock.nowMs()).toBeLessThan(10);
  });
});

describe("SimHal GPIO", () => {
  test("digitalRead returns the latch for outputs and the circuit level for inputs", () => {
    const { hal, pins } = setup();
    hal.pinMode(2, PinMode.Output);
    hal.digitalWrite(2, 1);
    expect(hal.digitalRead(2)).toBe(1);
    hal.pinMode(4, PinMode.Input);
    pins.set(4, PinField.Input, 1);
    expect(hal.digitalRead(4)).toBe(1);
  });

  test("analogRead reads the analog slot", () => {
    const { hal, pins } = setup();
    pins.set(32, PinField.Analog, 2048);
    expect(hal.analogRead(32)).toBe(2048);
  });

  test("pwm makes the pin an output and stores freq/duty; pwmStop clears", () => {
    const { hal, pins } = setup();
    hal.pwm(2, 1000, 32768);
    expect(pins.get(2, PinField.Mode)).toBe(PinMode.Output);
    expect(pins.get(2, PinField.PwmFreq)).toBe(1000);
    expect(pins.get(2, PinField.Pwm)).toBe(32768);
    hal.pwmStop(2);
    expect(pins.get(2, PinField.PwmFreq)).toBe(0);
  });
});

describe("SimHal interrupts", () => {
  test("a rising edge during a delay fires the handler", () => {
    let pinsRef!: PinState;
    const ctx = setup({
      onSleep: (now) => {
        if (now >= 20) pinsRef.set(4, PinField.Input, 1);
      },
    });
    pinsRef = ctx.pins;
    const fired: number[] = [];
    ctx.hal.pinMode(4, PinMode.Input);
    ctx.hal.attachInterrupt(4, "rising", () => fired.push(Math.floor(ctx.clock.nowMs())));
    ctx.hal.delay(100);
    expect(fired.length).toBe(1);
    expect(fired[0]).toBeGreaterThanOrEqual(20);
    expect(fired[0]).toBeLessThan(30);
  });

  test("edge filters: falling ignores rising; change fires for both", () => {
    const { hal, pins } = setup();
    const falling: number[] = [];
    const change: number[] = [];
    hal.attachInterrupt(4, "falling", () => falling.push(1));
    hal.attachInterrupt(5, "change", () => change.push(1));
    pins.set(4, PinField.Input, 1);
    pins.set(5, PinField.Input, 1);
    hal.poll();
    pins.set(4, PinField.Input, 0);
    pins.set(5, PinField.Input, 0);
    hal.poll();
    expect(falling.length).toBe(1);
    expect(change.length).toBe(2);
  });

  test("busy loops see interrupts at the next HAL call", () => {
    const { hal, pins } = setup();
    let fired = 0;
    hal.attachInterrupt(4, "rising", () => fired++);
    pins.set(4, PinField.Input, 1);
    hal.digitalRead(0); // any HAL call polls
    expect(fired).toBe(1);
  });

  test("detach stops delivery; handlers may call the HAL without recursion", () => {
    const { hal, pins } = setup();
    let fired = 0;
    hal.attachInterrupt(4, "change", () => {
      fired++;
      hal.digitalRead(4);
    });
    pins.set(4, PinField.Input, 1);
    hal.poll();
    hal.detachInterrupt(4);
    pins.set(4, PinField.Input, 0);
    hal.poll();
    expect(fired).toBe(1);
  });
});

describe("SimHal timers", () => {
  test("periodic timer fires every period; one-shot fires once", () => {
    const { hal } = setup();
    let periodic = 0;
    let once = 0;
    hal.timerStart(0, 10, true, () => periodic++);
    hal.timerStart(1, 15, false, () => once++);
    hal.delay(50);
    expect(periodic).toBeGreaterThanOrEqual(4);
    expect(periodic).toBeLessThanOrEqual(5);
    expect(once).toBe(1);
  });

  test("timerStop cancels", () => {
    const { hal } = setup();
    let n = 0;
    hal.timerStart(0, 5, true, () => n++);
    hal.timerStop(0);
    hal.delay(30);
    expect(n).toBe(0);
  });
});

describe("PinState wake cell", () => {
  test("waitWake returns early when the UI thread notifies", async () => {
    const buf = createPinBuffer();
    const worker = new Worker(new URL("./wake-worker.ts", import.meta.url));
    const result = new Promise<number>((resolve) => (worker.onmessage = (e) => resolve(e.data)));
    worker.postMessage(buf);
    await new Promise((r) => setTimeout(r, 100)); // let the worker start waiting
    new PinState(buf).notifyWake();
    const elapsed = await result;
    worker.terminate();
    expect(elapsed).toBeLessThan(1500);
  });
});

describe("SimHal I2C and sensors", () => {
  const slave = (addr: number, log: number[][] = []) => ({
    addr,
    write: (b: Uint8Array) => (log.push([...b]), true),
    read: (n: number) => new Uint8Array(n).fill(7),
  });

  test("writes reach the slave on the matching SDA/SCL pair; others NACK", () => {
    const { hal } = setup();
    const log: number[][] = [];
    hal.attachI2cSlave(21, 22, slave(0x3c, log));
    expect(hal.i2cWrite(21, 22, 0x3c, new Uint8Array([1, 2]))).toBe(true);
    expect(log).toEqual([[1, 2]]);
    expect(hal.i2cWrite(21, 22, 0x27, new Uint8Array([1]))).toBe(false); // wrong address
    expect(hal.i2cWrite(4, 5, 0x3c, new Uint8Array([1]))).toBe(false); // wrong bus
  });

  test("read and scan", () => {
    const { hal } = setup();
    hal.attachI2cSlave(21, 22, slave(0x3c));
    hal.attachI2cSlave(21, 22, slave(0x27));
    expect([...hal.i2cRead(21, 22, 0x27, 3)!]).toEqual([7, 7, 7]);
    expect(hal.i2cRead(21, 22, 0x50, 1)).toBeNull();
    expect(hal.i2cScan(21, 22)).toEqual([0x27, 0x3c]);
    expect(hal.i2cScan(1, 2)).toEqual([]);
  });

  test("sensorRead returns the model reading or null", () => {
    const { hal } = setup();
    hal.attachSensor("dht22", 4, { read: () => ({ temperature: 21.5, humidity: 40 }) });
    expect(hal.sensorRead("dht22", 4)).toEqual({ temperature: 21.5, humidity: 40 });
    expect(hal.sensorRead("dht22", 5)).toBeNull();
  });

  test("pulseIn returns the echo time and advances the virtual clock; no sensor times out", () => {
    const { hal, clock } = setup();
    hal.attachSensor("hcsr04-echo", 18, { read: () => ({ echoUs: 5800 }) });
    const t0 = clock.nowMs();
    expect(hal.pulseIn(18, 1, 30000)).toBe(5800);
    expect(clock.nowMs() - t0).toBeGreaterThan(5.79);
    expect(clock.nowMs() - t0).toBeLessThan(9);
    const t1 = clock.nowMs();
    expect(hal.pulseIn(19, 1, 30000)).toBe(-2);
    expect(clock.nowMs() - t1).toBeGreaterThan(29.9);
    // an echo longer than the timeout also times out
    hal.attachSensor("hcsr04-echo", 20, { read: () => ({ echoUs: 40000 }) });
    expect(hal.pulseIn(20, 1, 30000)).toBe(-2);
  });
});
