/**
 * Network bridge between the runtime Worker (which blocks while user code runs) and the
 * UI thread (which owns the real sockets: mqtt.js, fetch).
 *
 * Worker -> UI : `postMessage({type:"net", id, op, args})`, then the Worker blocks with
 *                Atomics.wait until the UI writes the result and bumps RESP_ID.
 * UI -> Worker : incoming MQTT messages go into a ring buffer the Worker polls.
 * No DOM / mqtt.js here: transports are injected, so everything is testable under bun.
 */

// ---- shared layout --------------------------------------------------------
const CTL = {
  RESP_ID: 0, // id of the last answered request
  RESP_LEN: 1,
  WIFI_FAIL: 2, // UI -> Worker: make Wi-Fi connections fail
  MQTT_UP: 3, // UI -> Worker: 1 while the broker connection is open
  IN_WRITE: 4, // ring write position (UI)
  IN_READ: 5, // ring read position (Worker)
  SIZE: 8,
} as const;
const RESP_BYTES = 128 * 1024;
const RING_BYTES = 64 * 1024;
const MAX_PAYLOAD = 16 * 1024;

export interface NetShared {
  buffer: SharedArrayBuffer;
}

export function createNetShared(): NetShared {
  return { buffer: new SharedArrayBuffer(CTL.SIZE * 4 + RESP_BYTES + RING_BYTES) };
}

class Views {
  readonly ctl: Int32Array;
  readonly resp: Uint8Array;
  readonly ring: Uint8Array;
  constructor(shared: NetShared) {
    this.ctl = new Int32Array(shared.buffer, 0, CTL.SIZE);
    this.resp = new Uint8Array(shared.buffer, CTL.SIZE * 4, RESP_BYTES);
    this.ring = new Uint8Array(shared.buffer, CTL.SIZE * 4 + RESP_BYTES, RING_BYTES);
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ---- protocol types ----------------------------------------------------------
export interface MqttConnectArgs {
  host: string;
  port: number;
  clientId: string;
  username?: string;
  password?: string;
  keepalive?: number;
}
export interface HttpRequestArgs {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}
export interface HttpResponse {
  status: number;
  body: string;
}

export type NetOp =
  | { op: "mqtt.connect"; args: MqttConnectArgs }
  | { op: "mqtt.subscribe"; args: { topic: string; qos: number } }
  | { op: "mqtt.unsubscribe"; args: { topic: string } }
  | { op: "mqtt.publish"; args: { topic: string; payload: string /* base64 */; retain: boolean; qos: number } }
  | { op: "mqtt.disconnect"; args: Record<string, never> }
  | { op: "http"; args: HttpRequestArgs };

export type NetRequest = { type: "net"; id: number } & NetOp;

export interface NetResponse {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** An incoming MQTT message as seen by firmware. */
export interface MqttMessage {
  topic: string;
  payload: Uint8Array;
}

// ---- worker side ----------------------------------------------------------------
export class WorkerNet {
  private readonly v: Views;
  private seq = 0;

  constructor(
    shared: NetShared,
    private readonly post: (msg: NetRequest) => void,
  ) {
    this.v = new Views(shared);
  }

  /** Should Wi-Fi connections fail (the user's "simulate failure" switch)? */
  wifiShouldFail(): boolean {
    return Atomics.load(this.v.ctl, CTL.WIFI_FAIL) === 1;
  }

  mqttConnected(): boolean {
    return Atomics.load(this.v.ctl, CTL.MQTT_UP) === 1;
  }

  private call(req: NetOp, timeoutMs: number): NetResponse {
    const id = ++this.seq;
    this.post({ type: "net", id, ...req } as NetRequest);
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      const seen = Atomics.load(this.v.ctl, CTL.RESP_ID);
      if (seen === id) break;
      const left = deadline - performance.now();
      if (left <= 0) return { ok: false, error: "timeout" };
      Atomics.wait(this.v.ctl, CTL.RESP_ID, seen, left);
    }
    const len = Atomics.load(this.v.ctl, CTL.RESP_LEN);
    return JSON.parse(dec.decode(this.v.resp.slice(0, len))) as NetResponse;
  }

  mqttConnect(args: MqttConnectArgs, timeoutMs = 10_000): NetResponse {
    return this.call({ op: "mqtt.connect", args }, timeoutMs);
  }
  mqttSubscribe(topic: string, qos = 0): boolean {
    return this.call({ op: "mqtt.subscribe", args: { topic, qos } }, 10_000).ok;
  }
  mqttUnsubscribe(topic: string): boolean {
    return this.call({ op: "mqtt.unsubscribe", args: { topic } }, 10_000).ok;
  }
  /** Fire and forget (ordering with later calls is preserved). Returns whether the broker link is up. */
  mqttPublish(topic: string, payload: Uint8Array, retain = false, qos = 0): boolean {
    if (!this.mqttConnected() || payload.length > MAX_PAYLOAD) return false;
    this.post({ type: "net", id: 0, op: "mqtt.publish", args: { topic, payload: toB64(payload), retain, qos } });
    return true;
  }
  mqttDisconnect(): void {
    this.post({ type: "net", id: 0, op: "mqtt.disconnect", args: {} });
  }

  /** Next incoming message, or null. */
  mqttPoll(): MqttMessage | null {
    const { ctl, ring } = this.v;
    const r = Atomics.load(ctl, CTL.IN_READ);
    if (r === Atomics.load(ctl, CTL.IN_WRITE)) return null;
    const at = (i: number) => ring[(r + i) % RING_BYTES];
    const topicLen = at(0) | (at(1) << 8);
    const payloadLen = at(2) | (at(3) << 8) | (at(4) << 16);
    const read = (from: number, n: number) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = at(from + i);
      return out;
    };
    const topic = dec.decode(read(5, topicLen));
    const payload = read(5 + topicLen, payloadLen);
    Atomics.store(ctl, CTL.IN_READ, (r + 5 + topicLen + payloadLen) % RING_BYTES);
    return { topic, payload };
  }

  httpRequest(req: HttpRequestArgs): { status: number; body: string; error?: string } {
    const r = this.call({ op: "http", args: req }, (req.timeoutMs ?? 10_000) + 2000);
    if (!r.ok) return { status: -1, body: "", error: r.error };
    return r.value as HttpResponse;
  }
}

// ---- UI side ------------------------------------------------------------------------
export interface MqttConnection {
  publish(topic: string, payload: Uint8Array, opts: { retain: boolean; qos: number }): void;
  subscribe(topic: string, qos: number): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
  end(): void;
}
export interface MqttTransport {
  connect(
    args: MqttConnectArgs,
    handlers: { onMessage(topic: string, payload: Uint8Array): void; onClose(): void },
  ): Promise<MqttConnection>;
}
export interface HttpTransport {
  request(req: HttpRequestArgs): Promise<HttpResponse>;
}

export interface MqttLogEntry {
  dir: "out" | "in" | "sys";
  topic: string;
  payload: string;
  time: number;
}

export class NetHost {
  private readonly v: Views;
  private conn: MqttConnection | null = null;
  private generation = 0;

  constructor(
    shared: NetShared,
    private readonly transports: { mqtt: MqttTransport; http: HttpTransport },
    private readonly onLog: (e: MqttLogEntry) => void = () => {},
    private readonly now: () => number = () => Date.now(),
  ) {
    this.v = new Views(shared);
  }

  setWifiFail(fail: boolean): void {
    Atomics.store(this.v.ctl, CTL.WIFI_FAIL, fail ? 1 : 0);
  }

  private log(dir: MqttLogEntry["dir"], topic: string, payload: string) {
    this.onLog({ dir, topic, payload, time: this.now() });
  }

  private respond(id: number, res: NetResponse): void {
    if (id === 0) return; // fire-and-forget
    const bytes = enc.encode(JSON.stringify(res));
    const body = bytes.length <= RESP_BYTES ? bytes : enc.encode(JSON.stringify({ ok: false, error: "response too large" }));
    this.v.resp.set(body);
    Atomics.store(this.v.ctl, CTL.RESP_LEN, body.length);
    Atomics.store(this.v.ctl, CTL.RESP_ID, id);
    Atomics.notify(this.v.ctl, CTL.RESP_ID);
  }

  private push(topic: string, payload: Uint8Array): void {
    const { ctl, ring } = this.v;
    const t = enc.encode(topic);
    if (payload.length > MAX_PAYLOAD || t.length > 0xffff) return;
    const need = 5 + t.length + payload.length;
    const w = Atomics.load(ctl, CTL.IN_WRITE);
    const r = Atomics.load(ctl, CTL.IN_READ);
    const used = (w - r + RING_BYTES) % RING_BYTES;
    if (used + need >= RING_BYTES) return; // inbox full: drop, like a slow real client would
    const put = (i: number, b: number) => {
      ring[(w + i) % RING_BYTES] = b;
    };
    put(0, t.length & 0xff);
    put(1, t.length >> 8);
    put(2, payload.length & 0xff);
    put(3, (payload.length >> 8) & 0xff);
    put(4, (payload.length >> 16) & 0xff);
    t.forEach((b, i) => put(5 + i, b));
    payload.forEach((b, i) => put(5 + t.length + i, b));
    Atomics.store(ctl, CTL.IN_WRITE, (w + need) % RING_BYTES);
  }

  /** Handle one request from the Worker. Never throws; failures are sent back as `ok:false`. */
  async handle(req: NetRequest): Promise<void> {
    try {
      switch (req.op) {
        case "mqtt.connect": {
          this.close();
          const gen = ++this.generation;
          this.log("sys", "", `connecting to ${req.args.host}:${req.args.port} as ${req.args.clientId}`);
          const conn = await this.transports.mqtt.connect(req.args, {
            onMessage: (topic, payload) => {
              if (gen !== this.generation) return;
              this.log("in", topic, dec.decode(payload));
              this.push(topic, payload);
            },
            onClose: () => {
              if (gen !== this.generation) return;
              Atomics.store(this.v.ctl, CTL.MQTT_UP, 0);
              this.log("sys", "", "disconnected");
            },
          });
          if (gen !== this.generation) {
            conn.end();
            return this.respond(req.id, { ok: false, error: "superseded" });
          }
          this.conn = conn;
          Atomics.store(this.v.ctl, CTL.MQTT_UP, 1);
          this.log("sys", "", "connected");
          return this.respond(req.id, { ok: true });
        }
        case "mqtt.subscribe":
          await this.conn?.subscribe(req.args.topic, req.args.qos);
          this.log("sys", req.args.topic, "subscribed");
          return this.respond(req.id, { ok: !!this.conn });
        case "mqtt.unsubscribe":
          await this.conn?.unsubscribe(req.args.topic);
          return this.respond(req.id, { ok: !!this.conn });
        case "mqtt.publish": {
          const payload = fromB64(req.args.payload);
          this.conn?.publish(req.args.topic, payload, { retain: req.args.retain, qos: req.args.qos });
          this.log("out", req.args.topic, dec.decode(payload));
          return this.respond(req.id, { ok: !!this.conn });
        }
        case "mqtt.disconnect":
          this.close();
          return this.respond(req.id, { ok: true });
        case "http": {
          const value = await this.transports.http.request(req.args);
          return this.respond(req.id, { ok: true, value });
        }
      }
    } catch (e) {
      this.respond(req.id, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  private close(): void {
    this.generation++;
    this.conn?.end();
    this.conn = null;
    Atomics.store(this.v.ctl, CTL.MQTT_UP, 0);
  }

  dispose(): void {
    this.close();
  }
}
