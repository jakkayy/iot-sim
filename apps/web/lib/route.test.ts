import { expect, test } from "bun:test";
import { routeWire } from "./route";

test("straight line when ends share a y", () => {
  expect(routeWire({ x: 0, y: 5 }, { x: 40, y: 5 })).toBe("M 0 5 H 40");
});

test("bends at the horizontal midpoint otherwise", () => {
  expect(routeWire({ x: 0, y: 0 }, { x: 100, y: 60 })).toBe("M 0 0 H 50 V 60 H 100");
  expect(routeWire({ x: 100, y: 60 }, { x: 0, y: 0 })).toBe("M 100 60 H 50 V 0 H 0");
});

test("with directions the wire leaves each pin outward first", () => {
  // right-facing pin at (0,0) to a down-facing pin at (100,60): the pin is approached from below
  expect(routeWire({ x: 0, y: 0 }, { x: 100, y: 60 }, "right", "down")).toBe(
    "M 0 0 L 14 0 L 14 74 L 100 74 L 100 60",
  );
  // two right-facing pins: bend at the midpoint of the stubs
  expect(routeWire({ x: 0, y: 0 }, { x: 100, y: 40 }, "right", "left")).toBe(
    "M 0 0 L 14 0 L 50 0 L 50 40 L 86 40 L 100 40",
  );
});

test("same-direction pins share a channel beyond both stubs (no doubling back)", () => {
  // both face right: a stub at x=14, b stub at x=114 -> channel at 114
  expect(routeWire({ x: 0, y: 0 }, { x: 100, y: 60 }, "right", "right")).toBe(
    "M 0 0 L 14 0 L 114 0 L 114 60 L 114 60 L 100 60",
  );
  expect(routeWire({ x: 100, y: 0 }, { x: 0, y: 60 }, "left", "left")).toBe(
    "M 100 0 L 86 0 L -14 0 L -14 60 L -14 60 L 0 60",
  );
});

test("a down pin is approached from below: detour when the other pin is above it", () => {
  // board pin at (0,0) facing right, device pin at (100,100) facing down: it is below, so go straight there
  expect(routeWire({ x: 0, y: 150 }, { x: 100, y: 100 }, "right", "down")).toBe(
    "M 0 150 L 14 150 L 100 150 L 100 114 L 100 100",
  );
  // the board pin is above the device pin: drop first, then run underneath the device
  expect(routeWire({ x: 0, y: 20 }, { x: 100, y: 100 }, "right", "down")).toBe(
    "M 0 20 L 14 20 L 14 114 L 100 114 L 100 100",
  );
});
