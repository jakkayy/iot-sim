import { describe, expect, test } from "bun:test";
import {
  NetHost, createNetShared,
  type HttpTransport, type MqttConnection, type MqttConnectArgs, type MqttLogEntry, type MqttTransport, type NetRequest,
} from "./net";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** In-memory broker: remembers what was published/subscribed and echoes onto subscribed topics. */
function fakeMqtt(opts: { connectDelay?: number; echo?: boolean; neverConnect?: boolean } = {}) {
  const state = {
    connects: [] as MqttConnectArgs[],
    published: [] as Array<{ topic: string; payload: string; retain: boolean }>,
    subs: [] as string[],
    ended: 0,
    deliver: (_t: string, _p: Uint8Array) => {},
    close: () => {},
  };
  const transport: MqttTransport = {
    async connect(args, handlers) {
      state.connects.push(args);
      if (opts.neverConnect) return new Promise<MqttConnection>(() => {});
      if (opts.connectDelay) await sleep(opts.connectDelay);
      state.deliver = handlers.onMessage;
      state.close = handlers.onClose;
      const enc = new TextEncoder();
      return {
        publish(topic, payload, o) {
          state.published.push({ topic, payload: new TextDecoder().decode(payload), retain: o.retain });
          if (opts.echo && state.subs.includes(topic.replace("/temp", "/cmd"))) handlers.onMessage(topic.replace("/temp", "/cmd"), enc.encode("echo:" + new TextDecoder().decode(payload)));
        },
        async subscribe(topic) {
          state.subs.push(topic);
        },
        async unsubscribe() {},
        end() {
          state.ended++;
        },
      };
    },
  };
  return { transport, state };
}

const http: HttpTransport = {
  async request(req) {
    if (req.url.startsWith("https://blocked.test")) throw new Error("host not allowed");
    return { status: 200, body: `ok:${req.method}` };
  },
};

/** Run a scenario in a real Worker while this thread acts as the UI. */
async function run(scenario: string, host: NetHost, shared = createNetShared()) {
  const worker = new Worker(new URL("./net-test-worker.ts", import.meta.url));
  const result = new Promise<Record<string, unknown>>((resolve) => {
    worker.onmessage = (e) => {
      if (e.data.done) resolve(e.data.out);
      else void host.handle(e.data as NetRequest);
    };
  });
  worker.postMessage({ shared, scenario });
  const out = await result;
  worker.terminate();
  return out;
}

function setup(mqtt = fakeMqtt(), logs: MqttLogEntry[] = []) {
  const shared = createNetShared();
  const host = new NetHost(shared, { mqtt: mqtt.transport, http }, (e) => logs.push(e));
  return { shared, host, mqtt, logs, run: (s: string) => run(s, host, shared) };
}

describe("blocking MQTT from a Worker", () => {
  test("connect (slow broker), subscribe, publish and receive, all while the worker blocks", async () => {
    const t = setup(fakeMqtt({ connectDelay: 80, echo: true }));
    const out = await t.run("basic");
    expect(out.connect).toEqual({ ok: true });
    expect(out.up).toBe(true);
    expect(out.sub).toBe(true);
    expect(out.pub).toBe(true);
    expect(out.msg).toEqual({ topic: "sim/x/cmd", payload: "echo:25.5" });
    expect(out.empty).toBeNull();
    expect(t.mqtt.state.connects[0]).toMatchObject({ host: "h", port: 1883, clientId: "c1" });
    expect(t.mqtt.state.published).toEqual([{ topic: "sim/x/temp", payload: "25.5", retain: true }]);
  });

  test("the log records connect, subscribe, publish and incoming messages", async () => {
    const t = setup(fakeMqtt({ echo: true }));
    await t.run("basic");
    const kinds = t.logs.map((l) => `${l.dir}:${l.topic}:${l.payload}`);
    expect(kinds).toContain("out:sim/x/temp:25.5");
    expect(kinds).toContain("in:sim/x/cmd:echo:25.5");
    expect(t.logs.some((l) => l.dir === "sys" && l.payload === "connected")).toBe(true);
  });

  test("a broker that never answers makes connect time out instead of hanging", async () => {
    const t = setup(fakeMqtt({ neverConnect: true }));
    const out = await t.run("timeout");
    expect(out.res).toEqual({ ok: false, error: "timeout" });
    expect(out.ms as number).toBeGreaterThanOrEqual(140);
    expect(out.ms as number).toBeLessThan(1500);
  });

  test("publishing while disconnected reports failure and sends nothing", async () => {
    const t = setup();
    const out = await t.run("notConnected");
    expect(out.pub).toBe(false);
    expect(out.up).toBe(false);
    expect(t.mqtt.state.published).toEqual([]);
  });

  test("a second connect replaces the first; disconnect clears the link flag", async () => {
    const t = setup();
    const out = await t.run("reconnect");
    expect(out.first).toEqual({ ok: true });
    expect(out.second).toEqual({ ok: true });
    expect(out.up).toBe(true);
    expect(out.upAfter).toBe(false);
    expect(t.mqtt.state.ended).toBeGreaterThanOrEqual(2); // first connection closed, then the second
  });

  test("a burst of messages is delivered in order through the ring buffer (with wraparound)", async () => {
    const t = setup();
    const worker = new Worker(new URL("./net-test-worker.ts", import.meta.url));
    const result = new Promise<Record<string, unknown>>((resolve) => {
      worker.onmessage = async (e) => {
        if (e.data.done) return resolve(e.data.out);
        await t.host.handle(e.data as NetRequest);
        if (e.data.op === "mqtt.publish") {
          for (let i = 0; i < 400; i++) t.mqtt.state.deliver("flood", new TextEncoder().encode(`m${i}-${"x".repeat(200)}`));
        }
      };
    });
    worker.postMessage({ shared: t.shared, scenario: "flood" });
    const out = await result;
    worker.terminate();
    // 400 * ~210 bytes exceeds the 64 KB ring, so the worker must drain while we deliver
    expect(out.count).toBeGreaterThan(100);
    expect(out.inOrder).toBe(true);
  });

  test("oversized messages are dropped rather than corrupting the ring", async () => {
    const t = setup();
    await t.host.handle({ type: "net", id: 0, op: "mqtt.connect", args: { host: "h", port: 1, clientId: "c" } });
    expect(t.mqtt.state.connects.length).toBe(1);
    t.mqtt.state.deliver("big", new Uint8Array(20_000));
    t.mqtt.state.deliver("ok", new TextEncoder().encode("fine"));
    const { WorkerNet } = await import("./net");
    const wn = new WorkerNet(t.shared, () => {});
    expect(wn.mqttPoll()).toMatchObject({ topic: "ok" });
    expect(wn.mqttPoll()).toBeNull();
  });
});

describe("Wi-Fi switch and HTTP", () => {
  test("the UI can make Wi-Fi fail; the worker sees it", async () => {
    const t = setup();
    expect((await t.run("wifi")).fail).toBe(false);
    t.host.setWifiFail(true);
    expect((await t.run("wifi")).fail).toBe(true);
  });

  test("HTTP goes through the host transport; transport errors come back as errors", async () => {
    const t = setup();
    const out = await t.run("http");
    expect(out.res).toEqual({ status: 200, body: "ok:GET" });
    expect(out.bad).toMatchObject({ status: -1, error: "host not allowed" });
  });
});
