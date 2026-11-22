import { describe, expect, test } from "bun:test";
import { createAutosaver, parseProject, PROJECT_VERSION, type SavedProject } from "./persist";

const good: SavedProject = {
  version: PROJECT_VERSION,
  components: [
    { id: "esp1", type: "esp32-devkit", x: 1, y: 2 },
    { id: "led1", type: "led", x: 3, y: 4 },
  ],
  wires: [{ id: "w1", a: "esp1:GPIO2", b: "led1:A" }],
  values: { led1: {} },
  lang: "py",
  code: { py: "print(1)", ino: "" },
};

describe("parseProject", () => {
  test("round-trips a valid project", () => {
    expect(parseProject(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });

  test("rejects wrong version and non-objects", () => {
    expect(parseProject(null)).toBeNull();
    expect(parseProject("x")).toBeNull();
    expect(parseProject({ ...good, version: 99 })).toBeNull();
    expect(parseProject({ version: PROJECT_VERSION })).toBeNull();
  });

  test("drops unknown device types and wires to missing pins", () => {
    const p = parseProject({
      ...good,
      components: [...good.components, { id: "x1", type: "flux-capacitor", x: 0, y: 0 }],
      wires: [...good.wires, { id: "w2", a: "x1:A", b: "led1:K" }, { id: "w3", a: "esp1:NOPE", b: "led1:K" }],
    })!;
    expect(p.components.map((c) => c.id)).toEqual(["esp1", "led1"]);
    expect(p.wires.map((w) => w.id)).toEqual(["w1"]);
  });

  test("drops duplicate ids, bad numbers and values of deleted parts", () => {
    const p = parseProject({
      ...good,
      components: [good.components[0], { ...good.components[0], x: 9 }, { id: "led1", type: "led", x: "no", y: NaN }],
      values: { led1: { a: 1, b: "x", c: Infinity }, ghost: { a: 1 } },
    })!;
    expect(p.components.length).toBe(2);
    expect(p.components[1]).toMatchObject({ x: 0, y: 0 });
    expect(p.values).toEqual({ led1: { a: 1 } });
  });

  test("defaults language and code when missing", () => {
    const p = parseProject({ ...good, lang: "cobol", code: undefined })!;
    expect(p.lang).toBe("py");
    expect(p.code).toEqual({ py: "", ino: "" });
  });
});

describe("createAutosaver", () => {
  const fakeStorage = () => {
    const saved: SavedProject[] = [];
    return { saved, storage: { load: async () => null, save: async (p: SavedProject) => void saved.push(p) } };
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  test("debounces bursts and saves the latest state", async () => {
    const { saved, storage } = fakeStorage();
    let n = 0;
    const saver = createAutosaver(storage, () => ({ ...good, code: { py: `v${n}`, ino: "" } }), 30);
    for (n = 1; n <= 5; n++) saver.schedule();
    await sleep(80);
    expect(saved.length).toBe(1);
    expect(saved[0].code.py).toBe("v6"); // snapshot is taken when the timer fires
  });

  test("flush writes immediately and cancel drops a pending write", async () => {
    const { saved, storage } = fakeStorage();
    const saver = createAutosaver(storage, () => good, 1000);
    saver.schedule();
    saver.flush();
    await sleep(5);
    expect(saved.length).toBe(1);
    saver.schedule();
    saver.cancel();
    await sleep(20);
    expect(saved.length).toBe(1);
  });

  test("storage errors go to onError instead of throwing", async () => {
    const errors: unknown[] = [];
    const saver = createAutosaver({ load: async () => null, save: async () => Promise.reject(new Error("quota")) }, () => good, 5, (e) => errors.push(e));
    saver.schedule();
    await sleep(30);
    expect(errors.length).toBe(1);
  });
});
