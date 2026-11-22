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
import { loadSketch, runSketch } from "./index";

const blink = await Bun.file(new URL("../fixtures/blink.wasm", import.meta.url).pathname).arrayBuffer();

function makeHal(onSleep?: (now: number, pins: PinState) => void) {
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

describe("arduino runtime", () => {
  test("blink sketch drives LED_BUILTIN (pin 2) through the HAL with virtual delays", async () => {
    const levels: number[] = [];
    const { hal, pins, clock } = makeHal((_now, p) => levels.push(p.readDigital(2)));
    const sketch = await loadSketch(blink, hal);
    runSketch(sketch, { maxLoops: 2 });
    expect(pins.get(2, PinField.Mode)).toBe(PinMode.Output);
    expect(clock.nowMs()).toBeGreaterThanOrEqual(2000);
    expect(levels[0]).toBe(1);
    expect(new Set(levels)).toEqual(new Set([0, 1]));
  });

  test("shouldStop ends the loop", async () => {
    const { hal } = makeHal();
    const sketch = await loadSketch(blink, hal);
    let loops = 0;
    runSketch(sketch, { shouldStop: () => loops++ >= 2 });
    expect(loops).toBe(3);
  });
});
