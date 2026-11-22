import { describe, expect, test } from "bun:test";
import { VirtualClock, createClockBuffer } from "./clock";

function fakeClock() {
  let t = 1000;
  const clock = new VirtualClock(createClockBuffer(), () => t, true);
  return { clock, advance: (ms: number) => (t += ms) };
}

describe("VirtualClock", () => {
  test("tracks real time at speed 1", () => {
    const { clock, advance } = fakeClock();
    advance(250);
    expect(clock.nowMs()).toBe(250);
  });

  test("speed change does not jump virtual time", () => {
    const { clock, advance } = fakeClock();
    advance(100);
    clock.setSpeed(4);
    expect(clock.nowMs()).toBe(100);
    advance(100);
    expect(clock.nowMs()).toBe(500);
    clock.setSpeed(0.5);
    advance(100);
    expect(clock.nowMs()).toBe(550);
  });

  test("delay is scaled by speed", () => {
    const { clock } = fakeClock();
    clock.setSpeed(10);
    expect(clock.realDelayFor(1000)).toBe(100);
  });

  test("rejects invalid speed", () => {
    const { clock } = fakeClock();
    expect(() => clock.setSpeed(0)).toThrow(RangeError);
    expect(() => clock.setSpeed(NaN)).toThrow(RangeError);
  });

  test("two views of one buffer agree (UI sets speed, Worker reads)", () => {
    let t = 0;
    const buf = createClockBuffer();
    const ui = new VirtualClock(buf, () => t, true);
    const worker = new VirtualClock(buf, () => t);
    ui.setSpeed(2);
    t += 50;
    expect(worker.nowMs()).toBe(100);
  });
});
