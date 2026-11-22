import { describe, expect, test } from "bun:test";
import { SerialLog } from "./serial";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("SerialLog", () => {
  test("batches many pushes into one notification", async () => {
    const log = new SerialLog(5000, 20);
    let notified = 0;
    log.subscribe(() => notified++);
    for (let i = 0; i < 1000; i++) log.push(`line ${i}`);
    expect(notified).toBe(0);
    await sleep(60);
    expect(notified).toBe(1);
    expect(log.getSnapshot().length).toBe(1000);
  });

  test("keeps only the newest maxLines", async () => {
    const log = new SerialLog(100, 10);
    for (let i = 0; i < 250; i++) log.push(`l${i}`);
    await sleep(40);
    const snap = log.getSnapshot();
    expect(snap.length).toBe(100);
    expect(snap[0]).toBe("l150");
    expect(snap.at(-1)).toBe("l249");
  });

  test("splits multi-line text and clear() empties immediately", async () => {
    const log = new SerialLog(100, 10);
    log.push("a\nb");
    await sleep(30);
    expect(log.getSnapshot()).toEqual(["a", "b"]);
    log.clear();
    expect(log.getSnapshot()).toEqual([]);
  });

  test("snapshot identity is stable between flushes", async () => {
    const log = new SerialLog(100, 10);
    log.push("x");
    await sleep(30);
    expect(log.getSnapshot()).toBe(log.getSnapshot());
  });
});
