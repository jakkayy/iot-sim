import { beforeEach, describe, expect, test } from "bun:test";
import { useCircuit } from "./store";

const s = () => useCircuit.getState();
beforeEach(() => s().load([], []));

describe("circuit store", () => {
  test("assigns readable ids per type", () => {
    expect(s().addComponent("led", 0, 0)).toBe("led1");
    expect(s().addComponent("led", 0, 0)).toBe("led2");
    expect(s().addComponent("resistor", 0, 0)).toBe("r1");
  });

  test("only one ESP32 board is allowed", () => {
    const a = s().addComponent("esp32-devkit", 0, 0);
    const b = s().addComponent("esp32-devkit", 50, 50);
    expect(a).toBe(b);
    expect(s().components.length).toBe(1);
  });

  test("wiring: start, finish, reject duplicates and self-connections", () => {
    s().startWire("led1:A");
    expect(s().finishWire("led1:A")).toBe(false);
    s().startWire("led1:A");
    expect(s().finishWire("r1:2")).toBe(true);
    s().startWire("r1:2");
    expect(s().finishWire("led1:A")).toBe(false); // same wire, reversed
    expect(s().wires.length).toBe(1);
    expect(s().pendingWire).toBeNull();
  });

  test("removing a component removes its wires", () => {
    s().addComponent("led", 0, 0);
    s().addComponent("resistor", 0, 0);
    s().startWire("led1:A");
    s().finishWire("r1:2");
    s().select({ kind: "component", id: "led1" });
    s().removeSelected();
    expect(s().components.map((c) => c.id)).toEqual(["r1"]);
    expect(s().wires).toEqual([]);
  });

  test("removing a wire keeps components", () => {
    s().addComponent("led", 0, 0);
    s().startWire("led1:A");
    s().finishWire("led1:K");
    s().select({ kind: "wire", id: s().wires[0].id });
    s().removeSelected();
    expect(s().wires).toEqual([]);
    expect(s().components.length).toBe(1);
  });

  test("move updates position; toCircuitData drops geometry", () => {
    const id = s().addComponent("button", 1, 2);
    s().moveComponent(id, 30, 40);
    expect(s().components[0]).toMatchObject({ x: 30, y: 40 });
    expect(s().toCircuitData().components[0]).toEqual({ id: "btn1", type: "button" });
  });
});
