import { describe, expect, test } from "bun:test";
import { PIN_COUNT, PinMode, PinState, createPinBuffer } from "./pins";
import { sleepMs } from "./delay";

describe("PinState", () => {
  test("write then read digital level", () => {
    const pins = new PinState(createPinBuffer());
    pins.setMode(2, PinMode.Output);
    pins.writeDigital(2, 1);
    expect(pins.readDigital(2)).toBe(1);
    expect(pins.readDigital(3)).toBe(0);
  });

  test("rejects out-of-range pins", () => {
    const pins = new PinState(createPinBuffer());
    expect(() => pins.readDigital(PIN_COUNT)).toThrow(RangeError);
    expect(() => pins.readDigital(-1)).toThrow(RangeError);
  });

  test("state is shared across a Worker via SharedArrayBuffer", async () => {
    const buffer = createPinBuffer();
    const worker = new Worker(new URL("./test-worker.ts", import.meta.url));
    const done = new Promise<void>((resolve) => (worker.onmessage = () => resolve()));
    worker.postMessage(buffer);
    await done;
    worker.terminate();
    expect(new PinState(buffer).readDigital(2)).toBe(1);
  });
});

describe("sleepMs", () => {
  test("blocks for roughly the requested time", () => {
    const t0 = performance.now();
    sleepMs(30);
    expect(performance.now() - t0).toBeGreaterThanOrEqual(25);
  });
});
