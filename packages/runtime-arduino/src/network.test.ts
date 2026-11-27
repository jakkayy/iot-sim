import { describe, expect, test } from "bun:test";
import { PinField, PinState, SimHal, VirtualClock, createClockBuffer, createPinBuffer, type WorkerNet } from "@esp32-sim/sim-core";
import { loadSketch, runSketch } from "./index";

const fixture = (name: string) => Bun.file(new URL(`../fixtures/${name}.wasm`, import.meta.url).pathname).arrayBuffer();

function boot(opts: { wifiFail?: boolean; connectOk?: boolean; httpStatus?: number } = {}) {
  let t = 0;
  const log = { connect: [] as unknown[], published: [] as Array<[string, string, boolean]>, subs: [] as string[], http: [] as unknown[] };
  const inbox: Array<{ topic: string; payload: Uint8Array }> = [];
  let up = false;
  const net = {
    wifiShouldFail: () => !!opts.wifiFail,
    mqttConnected: () => up,
    mqttConnect: (a: unknown) => (log.connect.push(a), (up = opts.connectOk !== false), { ok: up }),
    mqttSubscribe: (topic: string) => (log.subs.push(topic), true),
    mqttPublish: (topic: string, p: Uint8Array, retain: boolean) => (log.published.push([topic, new TextDecoder().decode(p), retain]), true),
    mqttPoll: () => inbox.shift() ?? null,
    mqttDisconnect: () => void (up = false),
    httpRequest: (r: unknown) => (log.http.push(r), { status: opts.httpStatus ?? 200, body: '{"ok":true}' }),
  } as unknown as WorkerNet;
  const pins = new PinState(createPinBuffer());
  const hal = new SimHal({ pins, clock: new VirtualClock(createClockBuffer(), () => t, true), sleep: (ms) => (t += ms), net });
  hal.attachSensor("dht22", 4, { read: () => ({ temperature: 23.5, humidity: 50 }) });
  const lines: string[] = [];
  return { hal, pins, log, inbox, lines, load: async (n: string) => loadSketch(await fixture(n), hal, { onStdout: (l) => lines.push(l) }) };
}

describe("WiFi + PubSubClient", () => {
  test("connects, subscribes, publishes the DHT reading and reacts to a command", async () => {
    const { load, log, inbox, pins, lines } = boot();
    const sketch = await load("mqtt");
    sketch.setup();
    expect(lines[0]).toBe("192.168.1.50");
    expect(log.connect[0]).toMatchObject({ host: "broker.example", port: 1883, clientId: "esp32-sim" });
    expect(log.subs).toEqual(["sim/demo/relay"]);
    for (let i = 0; i < 120; i++) sketch.loop(); // ~2.4 s of loop() calls
    expect(log.published[0]).toEqual(["sim/demo/temp", "23.5", false]);
    inbox.push({ topic: "sim/demo/relay", payload: new TextEncoder().encode("1") });
    sketch.loop();
    expect(lines.at(-1)).toBe("got sim/demo/relay: 1");
    expect(pins.get(5, PinField.Level)).toBe(1);
    inbox.push({ topic: "sim/demo/relay", payload: new TextEncoder().encode("0") });
    sketch.loop();
    expect(pins.get(5, PinField.Level)).toBe(0);
  });

  test("with Wi-Fi failing the sketch keeps waiting and never touches the broker", async () => {
    const { hal, load, log } = boot({ wifiFail: true });
    const sketch = await load("mqtt");
    let waited = 0;
    const origDelay = hal.delay.bind(hal);
    hal.delay = (ms: number, until?: () => boolean) => {
      if (++waited > 40) throw new Error("stop");
      origDelay(ms, until);
    };
    expect(() => sketch.setup()).toThrow("stop");
    expect(log.connect).toEqual([]);
  });
});

describe("HTTPClient", () => {
  test("POST with headers returns the status and body", async () => {
    const { load, log, lines } = boot();
    runSketch(await load("http"), { maxLoops: 1 });
    expect(lines).toEqual(["200", '{"ok":true}']);
    expect(log.http[0]).toMatchObject({
      method: "POST",
      url: "https://api.example/data",
      headers: { "Content-Type": "application/json" },
      body: '{"t":25}',
    });
  });

  test("a failed request prints a negative code", async () => {
    const { load, lines } = boot({ httpStatus: -1 });
    runSketch(await load("http"), { maxLoops: 1 });
    expect(lines[0]).toBe("-1");
  });
});
