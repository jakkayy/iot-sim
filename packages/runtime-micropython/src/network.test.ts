import { describe, expect, test } from "bun:test";
import { PinState, SimHal, VirtualClock, createClockBuffer, createPinBuffer, type WorkerNet } from "@esp32-sim/sim-core";
import { startMicroPython } from "./session";

const loaderUrl = new URL("../node_modules/@micropython/micropython-webassembly-pyscript/micropython.mjs", import.meta.url).href;

/** A stand-in for the UI-side bridge: loops published messages back on subscribed topics. */
function fakeNet(opts: { connectOk?: boolean; wifiFail?: boolean } = {}) {
  const log = { connect: [] as unknown[], published: [] as Array<[string, string, boolean]>, subs: [] as string[], http: [] as unknown[] };
  const inbox: Array<{ topic: string; payload: Uint8Array }> = [];
  let up = false;
  const dec = new TextDecoder();
  const net = {
    wifiShouldFail: () => !!opts.wifiFail,
    mqttConnected: () => up,
    mqttConnect: (a: unknown) => {
      log.connect.push(a);
      up = opts.connectOk !== false;
      return { ok: up };
    },
    mqttSubscribe: (t: string) => (log.subs.push(t), true),
    mqttPublish: (t: string, p: Uint8Array, retain: boolean) => {
      log.published.push([t, dec.decode(p), retain]);
      if (log.subs.includes(t)) inbox.push({ topic: t, payload: p });
      return true;
    },
    mqttPoll: () => inbox.shift() ?? null,
    mqttDisconnect: () => void (up = false),
    httpRequest: (r: { method: string; url: string; body?: string }) => {
      log.http.push(r);
      return r.url.includes("fail") ? { status: -1, body: "", error: "host not allowed" } : { status: 200, body: JSON.stringify({ echo: r.body ?? null, m: r.method }) };
    },
  } as unknown as WorkerNet;
  return { net, log };
}

async function boot(netOpts?: Parameters<typeof fakeNet>[0]) {
  let t = 0;
  const { net, log } = fakeNet(netOpts);
  const hal = new SimHal({
    pins: new PinState(createPinBuffer()),
    clock: new VirtualClock(createClockBuffer(), () => t, true),
    sleep: (ms) => (t += ms),
    net,
  });
  const out: string[] = [];
  const session = await startMicroPython({ loaderUrl, hal, lockdown: false, onStdout: (l) => out.push(l) });
  return { session, out, log, now: () => t };
}

const CONNECT = `import network, time
wlan = network.WLAN(network.STA_IF)
wlan.active(True)
wlan.connect('home', 'secret')
while not wlan.isconnected():
    time.sleep_ms(100)
`;

describe("network.WLAN", () => {
  test("connects after a virtual delay and reports the simulated IP", async () => {
    const { session, out, now } = await boot();
    const res = session.run(`${CONNECT}print(wlan.isconnected(), wlan.ifconfig()[0], wlan.status())`);
    expect(res.ok).toBe(true);
    expect(out).toContain("True 192.168.1.50 1010");
    expect(now()).toBeGreaterThanOrEqual(1500);
  });

  test("the failure switch keeps it disconnected", async () => {
    const { session, out } = await boot({ wifiFail: true });
    session.run(`import network, time
w = network.WLAN(network.STA_IF)
w.active(True)
w.connect('home', 'x')
time.sleep(3)
print(w.isconnected(), w.status())`);
    expect(out).toContain("False 201");
  });

  test("connect() before active(True) raises like the real port", async () => {
    const { session } = await boot();
    const res = session.run("import network\nnetwork.WLAN(network.STA_IF).connect('a','b')");
    expect(res.ok).toBe(false);
  });
});

describe("umqtt.simple", () => {
  test("connect, subscribe, publish and receive through check_msg with the user's credentials", async () => {
    const { session, out, log } = await boot();
    const res = session.run(`${CONNECT}from umqtt.simple import MQTTClient
got = []
def cb(topic, msg):
    got.append((topic, msg))
c = MQTTClient('esp1', 'broker.example', port=1883, user='u', password='p')
c.set_callback(cb)
c.connect()
c.subscribe(b'sim/p/cmd')
c.publish('sim/p/cmd', '{"relay":1}', retain=True)
print('empty' if not got else 'early')
c.check_msg()
print(got)
c.disconnect()
`);
    expect(res).toEqual({ ok: true });
    expect(out).toContain("empty");
    expect(out).toContain("[(b'sim/p/cmd', b'{\"relay\":1}')]");
    expect(log.connect[0]).toMatchObject({ host: "broker.example", port: 1883, clientId: "esp1", username: "u", password: "p" });
    expect(log.published).toEqual([["sim/p/cmd", '{"relay":1}', true]]);
  });

  test("wait_msg blocks (in virtual time) until a message arrives", async () => {
    const { session, out } = await boot();
    session.run(`${CONNECT}from umqtt.simple import MQTTClient
c = MQTTClient('e', 'b')
c.set_callback(lambda t, m: print('got', t, m))
c.connect()
c.subscribe(b'x')
c.publish(b'x', b'hello')
c.wait_msg()
`);
    expect(out).toContain("got b'x' b'hello'");
  });

  test("connecting without Wi-Fi raises OSError; a refused broker raises MQTTException", async () => {
    const a = await boot();
    const r1 = a.session.run("from umqtt.simple import MQTTClient\nMQTTClient('e','b').connect()");
    expect(r1.ok).toBe(false);
    const b = await boot({ connectOk: false });
    const r2 = b.session.run(`${CONNECT}from umqtt.simple import MQTTClient, MQTTException
try:
    MQTTClient('e', 'b').connect()
except MQTTException as e:
    print('refused', e.args[0])`);
    expect(r2.ok).toBe(true);
    expect(b.out).toContain("refused 5");
  });

  test("publishing while disconnected raises OSError", async () => {
    const { session } = await boot();
    const r = session.run(`${CONNECT}from umqtt.simple import MQTTClient
MQTTClient('e', 'b').publish('t', 'x')`);
    expect(r.ok).toBe(false);
  });
});

describe("urequests", () => {
  test("GET and POST with JSON through the HTTP bridge", async () => {
    const { session, out, log } = await boot();
    const res = session.run(`${CONNECT}import urequests
r = urequests.get('https://api.example/x')
print(r.status_code, r.json()['m'])
r.close()
r = urequests.post('https://api.example/y', json={'t': 25})
print(r.json()['echo'])
`);
    expect(res.ok).toBe(true);
    expect(out).toContain("200 GET");
    expect(out).toContain('{"t": 25}');
    expect((log.http[1] as { headers: Record<string, string> }).headers["Content-Type"]).toBe("application/json");
  });

  test("blocked hosts and a missing Wi-Fi link raise OSError", async () => {
    const { session, out } = await boot();
    session.run(`${CONNECT}import urequests
try:
    urequests.get('https://fail.example')
except OSError as e:
    print('blocked', e.args[0])`);
    expect(out).toContain("blocked host not allowed");
    const b = await boot();
    expect(b.session.run("import urequests\nurequests.get('https://a')").ok).toBe(false);
  });
});
