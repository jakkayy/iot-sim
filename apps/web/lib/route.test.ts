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
  // right-facing pin at (0,0) to a down-facing pin at (100,60)
  expect(routeWire({ x: 0, y: 0 }, { x: 100, y: 60 }, "right", "down")).toBe(
    "M 0 0 L 14 0 L 100 0 L 100 74 L 100 60",
  );
  // two right-facing pins: bend at the midpoint of the stubs
  expect(routeWire({ x: 0, y: 0 }, { x: 100, y: 40 }, "right", "left")).toBe(
    "M 0 0 L 14 0 L 50 0 L 50 40 L 86 40 L 100 40",
  );
});
