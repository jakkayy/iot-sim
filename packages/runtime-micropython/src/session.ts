import { WIFI_IP, type SimHal } from "@esp32-sim/sim-core";
import { PRELUDE } from "./prelude";
import { PYTHON_BLOCK, lockdownGlobals } from "./lockdown";
import { USER_FILE, parseTraceback, type PythonErrorInfo } from "./traceback";

export interface SessionOptions {
  /**
   * URL of micropython.mjs. Served as a static file, never bundled: the
   * emscripten loader references Node modules that webpack cannot resolve.
   */
  loaderUrl: string;
  /** URL of micropython.wasm (same origin under COEP). Defaults to next to the loader. */
  wasmUrl?: string;
  hal: SimHal;
  onStdout?: (line: string) => void;
  onStderr?: (text: string) => void;
  /** Remove network/spawn globals before user code runs. Default true. */
  lockdown?: boolean;
}

export type RunResult = { ok: true } | { ok: false; error: PythonErrorInfo };

interface MicroPython {
  runPython(code: string): unknown;
  registerJsModule(name: string, module: object): void;
}
type LoadMicroPython = (options: {
  url?: string;
  linebuffer?: boolean;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}) => Promise<MicroPython>;

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

/** The JS side of `_hal`: the only host functions Python can call. */
function makeHalModule(hal: SimHal) {
  const pending: string[] = [];
  return {
    pin_mode: (pin: number, mode: number) => hal.pinMode(pin, mode),
    write: (pin: number, v: number) => hal.digitalWrite(pin, v),
    read: (pin: number) => hal.digitalRead(pin),
    adc: (pin: number) => hal.analogRead(pin),
    pwm: (pin: number, freq: number, duty: number) => hal.pwm(pin, freq, duty),
    pwm_stop: (pin: number) => hal.pwmStop(pin),
    irq: (pin: number, trigger: number) => {
      if (trigger === 0) hal.detachInterrupt(pin);
      else {
        const edge = trigger === 1 ? "rising" : trigger === 2 ? "falling" : "change";
        hal.attachInterrupt(pin, edge, () => pending.push(`p${pin}`));
      }
    },
    timer: (id: number, periodMs: number, periodic: boolean) =>
      hal.timerStart(id, periodMs, periodic, () => pending.push(`t${id}`)),
    timer_stop: (id: number) => hal.timerStop(id),
    take: () => {
      const s = pending.join(",");
      pending.length = 0;
      return s;
    },
    millis: () => hal.millis(),
    micros: () => hal.micros(),
    i2c_write: (sda: number, scl: number, addr: number, hex: string) =>
      hal.i2cWrite(sda, scl, addr, fromHex(hex)),
    i2c_read: (sda: number, scl: number, addr: number, n: number) => {
      const data = hal.i2cRead(sda, scl, addr, n);
      return data ? toHex(data) : "";
    },
    i2c_scan: (sda: number, scl: number) => hal.i2cScan(sda, scl).join(","),
    sensor_read: (kind: string, gpio: number) => {
      const r = hal.sensorRead(kind, gpio);
      return r ? `${r.temperature},${r.humidity}` : "";
    },
    pulse_in: (pin: number, level: number, timeoutUs: number) => hal.pulseIn(pin, level, timeoutUs),
    wifi_begin: (ssid: string) => hal.wifiBegin(ssid),
    wifi_status: () => hal.wifiStatus(),
    wifi_disconnect: () => hal.wifiDisconnect(),
    wifi_ssid: () => hal.wifiSsid(),
    wifi_ip: () => WIFI_IP,
    mqtt_connect: (host: string, port: number, clientId: string, user: string, pass: string, keepalive: number) => {
      const net = hal.net;
      if (!net) return 1;
      const r = net.mqttConnect({ host, port, clientId, username: user || undefined, password: pass || undefined, keepalive });
      return r.ok ? 0 : 5; // 5 = not authorized / refused, like a CONNACK return code
    },
    mqtt_connected: () => hal.net?.mqttConnected() ?? false,
    mqtt_publish: (topicHex: string, payloadHex: string, retain: boolean, qos: number) =>
      hal.net?.mqttPublish(new TextDecoder().decode(fromHex(topicHex)), fromHex(payloadHex), retain, qos) ?? false,
    mqtt_subscribe: (topicHex: string, qos: number) => hal.net?.mqttSubscribe(new TextDecoder().decode(fromHex(topicHex)), qos) ?? false,
    mqtt_disconnect: () => hal.net?.mqttDisconnect(),
    mqtt_poll: () => {
      const m = hal.net?.mqttPoll();
      return m ? `${toHex(new TextEncoder().encode(m.topic))}:${toHex(m.payload)}` : "";
    },
    http: (method: string, url: string, headersJson: string, body: string, timeoutMs: number) => {
      const net = hal.net;
      if (!net) return JSON.stringify({ error: "no network" });
      let headers: Record<string, string> = {};
      try {
        headers = JSON.parse(headersJson);
      } catch {
        /* ignore malformed headers */
      }
      const r = net.httpRequest({ method, url, headers, body: body || undefined, timeoutMs });
      return JSON.stringify(r.error ? { error: r.error } : { status: r.status, body: r.body });
    },
    /** Sleep, returning early when an interrupt/timer is pending so Python can run its handler. */
    delay_ms: (ms: number) => hal.delay(ms, () => pending.length > 0),
  };
}

export class MicroPythonSession {
  constructor(
    private readonly mp: MicroPython,
    private readonly onStderr?: (text: string) => void,
  ) {}

  /** Run user code as main.py. Blocks until it finishes (or forever for `while True`). */
  run(code: string): RunResult {
    try {
      this.mp.runPython(
        `exec(compile(${JSON.stringify(code)}, ${JSON.stringify(USER_FILE)}, 'exec'), {'__name__': '__main__'})`,
      );
      return { ok: true };
    } catch (e) {
      const err = e as { type?: string; message?: string };
      if (err.type === "SystemExit") return { ok: true };
      const info = parseTraceback(String(err.message ?? e), err.type ?? "Error");
      this.onStderr?.(String(err.message ?? e));
      return { ok: false, error: info };
    }
  }
}

export async function startMicroPython(opts: SessionOptions): Promise<MicroPythonSession> {
  const { loadMicroPython } = (await import(/* webpackIgnore: true */ opts.loaderUrl)) as {
    loadMicroPython: LoadMicroPython;
  };
  const mp = await loadMicroPython({
    url: opts.wasmUrl,
    linebuffer: true,
    stdout: opts.onStdout,
    stderr: opts.onStderr,
  });
  mp.registerJsModule("_hal", makeHalModule(opts.hal));
  mp.runPython(PYTHON_BLOCK);
  mp.runPython(PRELUDE);
  if (opts.lockdown !== false) lockdownGlobals();
  return new MicroPythonSession(mp, opts.onStderr);
}
