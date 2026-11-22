import { describe, expect, test } from "bun:test";
import {
  PinField,
  PinMode,
  PinState,
  SimHal,
  VirtualClock,
  createClockBuffer,
  createPinBuffer,
} from "@esp32-sim/sim-core";
import { demangle, loadSketch, runSketch } from "./index";

export const fixture = (name: string) =>
  Bun.file(new URL(`../fixtures/${name}.wasm`, import.meta.url).pathname).arrayBuffer();

/** A HAL on a fake clock; `onSleep` scripts the outside world. */
export function makeHal(onSleep?: (now: number, pins: PinState) => void) {
  let t = 0;
  const pins = new PinState(createPinBuffer());
  const clock = new VirtualClock(createClockBuffer(), () => t, true);
  const hal = new SimHal({
    pins,
    clock,
    sleep: (ms) => {
      t += ms;
      onSleep?.(t, pins);
    },
  });
  return { hal, pins, clock, now: () => t };
}

describe("blink", () => {
  test("drives LED_BUILTIN (pin 2) through the HAL with virtual delays", async () => {
    const levels: number[] = [];
    const { hal, pins, clock } = makeHal((_now, p) => levels.push(p.readDigital(2)));
    const sketch = await loadSketch(await fixture("blink"), hal);
    runSketch(sketch, { maxLoops: 2 });
    expect(pins.get(2, PinField.Mode)).toBe(PinMode.Output);
    expect(clock.nowMs()).toBeGreaterThanOrEqual(2000);
    expect(levels[0]).toBe(1);
    expect(new Set(levels)).toEqual(new Set([0, 1]));
  });

  test("shouldStop ends the loop", async () => {
    const { hal } = makeHal();
    const sketch = await loadSketch(await fixture("blink"), hal);
    let loops = 0;
    runSketch(sketch, { shouldStop: () => loops++ >= 2 });
    expect(loops).toBe(3);
  });
});

describe("Serial, String, printf and math", () => {
  test("output matches what a real board prints", async () => {
    const { hal } = makeHal();
    const lines: string[] = [];
    const sketch = await loadSketch(await fixture("serial"), hal, { onStdout: (l) => lines.push(l) });
    runSketch(sketch, { maxLoops: 1 });
    expect(lines).toEqual([
      "HELLO, WORLD",
      "42 3.142",
      "-7   2.6 str 00ff Z",
      "2.50",
      "1234567890",
      "FF",
      "ab",
      "1.4142",
      "1.00",
      "511",
      "1",
    ]);
  });
});

describe("unsupported functions", () => {
  test("loading a sketch that calls something the shim lacks gives a readable error", async () => {
    const { hal } = makeHal();
    await expect(loadSketch(await fixture("unsupported"), hal)).rejects.toThrow(/thisIsNotInTheShim/);
  });

  test("demangle turns C++ symbols into readable names", () => {
    expect(demangle("_ZN9WiFiClass5beginEPKcS1_")).toBe("WiFiClass::begin");
    expect(demangle("_Z7foo_barv")).toBe("foo_bar");
    expect(demangle("plain_c")).toBe("plain_c");
  });
});
