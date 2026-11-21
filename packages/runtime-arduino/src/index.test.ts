import { describe, expect, test } from "bun:test";
import { PinField, PinMode, PinState, createPinBuffer } from "@esp32-sim/sim-core";
import { loadSketch, runSketch } from "./index";

const blink = await Bun.file(new URL("../fixtures/blink.wasm", import.meta.url).pathname).arrayBuffer();

describe("arduino runtime", () => {
  test("blink sketch drives LED_BUILTIN (pin 2) through the HAL", async () => {
    const pins = new PinState(createPinBuffer());
    const delays: number[] = [];
    const levelAtDelay: number[] = [];
    const sketch = await loadSketch(blink, {
      pins,
      delay: (ms) => {
        delays.push(ms);
        levelAtDelay.push(pins.readDigital(2));
      },
    });
    runSketch(sketch, { maxLoops: 2 });
    expect(pins.get(2, PinField.Mode)).toBe(PinMode.Output);
    expect(levelAtDelay).toEqual([1, 0, 1, 0]);
    expect(delays).toEqual([500, 500, 500, 500]);
  });

  test("shouldStop ends the loop", async () => {
    const pins = new PinState(createPinBuffer());
    let calls = 0;
    const sketch = await loadSketch(blink, { pins, delay: () => calls++ });
    runSketch(sketch, { shouldStop: () => calls >= 2 });
    expect(calls).toBe(2);
  });
});
