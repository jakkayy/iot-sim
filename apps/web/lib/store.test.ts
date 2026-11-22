import { beforeEach, describe, expect, test } from "bun:test";
import { useCircuit } from "./store";

const s = () => useCircuit.getState();
beforeEach(() => {
  s().load([], []);
  s().clearHistory();
});

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

describe("undo / redo", () => {
  test("undo reverts an add and redo restores it", () => {
    s().addComponent("led", 0, 0);
    s().addComponent("resistor", 0, 0);
    s().undo();
    expect(s().components.map((c) => c.id)).toEqual(["led1"]);
    s().redo();
    expect(s().components.map((c) => c.id)).toEqual(["led1", "r1"]);
  });

  test("undo reverts wiring and removal (component + wires come back together)", () => {
    s().addComponent("led", 0, 0);
    s().addComponent("resistor", 0, 0);
    s().startWire("led1:A");
    s().finishWire("r1:2");
    expect(s().wires.length).toBe(1);
    s().undo();
    expect(s().wires.length).toBe(0);
    s().redo();
    s().select({ kind: "component", id: "led1" });
    s().removeSelected();
    expect(s().wires.length).toBe(0);
    s().undo();
    expect(s().components.map((c) => c.id).sort()).toEqual(["led1", "r1"]);
    expect(s().wires.length).toBe(1);
  });

  test("a new change after undo drops the redo stack", () => {
    s().addComponent("led", 0, 0);
    s().undo();
    s().addComponent("button", 0, 0);
    s().redo();
    expect(s().components.map((c) => c.id)).toEqual(["btn1"]);
  });

  test("commit() before a drag makes the whole move one undo step", () => {
    const id = s().addComponent("led", 10, 10);
    s().commit();
    s().moveComponent(id, 20, 20);
    s().moveComponent(id, 30, 30);
    s().undo();
    expect(s().components[0]).toMatchObject({ x: 10, y: 10 });
  });

  test("history is capped and undo on an empty stack is a no-op", () => {
    s().undo();
    expect(s().components).toEqual([]);
    for (let i = 0; i < 130; i++) s().commit();
    expect(s().past.length).toBe(100);
  });

  test("control values survive undo/redo and new parts get defaults", () => {
    s().addComponent("dht22", 0, 0);
    s().setValue("dht1", "temperature", 33);
    s().addComponent("led", 0, 0);
    s().undo();
    expect(s().values.dht1.temperature).toBe(33);
    s().redo();
    expect(s().values.led1).toEqual({});
  });
});
