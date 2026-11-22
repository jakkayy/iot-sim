import { PinMode, WIFI_IP, type SimHal } from "@esp32-sim/sim-core";

export interface Sketch {
  setup(): void;
  loop(): void;
  /** Emit any partial serial line (called on delay and at exit). */
  flush(): void;
}

export interface SketchIO {
  /** One complete line of Serial output (without the line ending). */
  onStdout?: (line: string) => void;
}

// Arduino-ESP32 pinMode() constants -> sim-core PinMode.
function toSimMode(arduinoMode: number): number {
  switch (arduinoMode) {
    case 0x01:
      return PinMode.Input;
    case 0x03:
      return PinMode.Output;
    case 0x04: // PULLUP alone: treat like INPUT_PULLUP
    case 0x05:
      return PinMode.InputPullup;
    case 0x08:
    case 0x09:
      return PinMode.InputPulldown;
    case 0x10:
    case 0x12:
      return PinMode.OpenDrain;
    default:
      throw new RangeError(`unsupported pinMode ${arduinoMode}`);
  }
}

const MATH: Array<(a: number, b: number) => number> = [
  (a) => Math.sin(a),
  (a) => Math.cos(a),
  (a) => Math.tan(a),
  (a) => Math.asin(a),
  (a) => Math.acos(a),
  (a) => Math.atan(a),
  (a, b) => Math.atan2(a, b),
  (a) => Math.exp(a),
  (a) => Math.log(a),
  (a) => Math.log10(a),
  (a, b) => Math.pow(a, b),
  (a, b) => a % b,
  (a) => Math.round(a),
];

/** `_ZN8WiFiClass5beginEPKc` -> `WiFiClass::begin`; plain C names pass through. */
export function demangle(name: string): string {
  if (!name.startsWith("_Z")) return name;
  let i = 2;
  const parts: string[] = [];
  if (name[i] === "N") i++;
  while (i < name.length && /\d/.test(name[i])) {
    let n = 0;
    while (/\d/.test(name[i])) n = n * 10 + Number(name[i++]);
    parts.push(name.slice(i, i + n));
    i += n;
  }
  return parts.length ? parts.join("::") : name;
}

/** Instantiate a sketch compiled against arduino-shim; every import is a HAL call. */
export async function loadSketch(wasm: BufferSource, hal: SimHal, io: SketchIO = {}): Promise<Sketch> {
  const module = await WebAssembly.compile(wasm);
  let memory: WebAssembly.Memory;
  let table: WebAssembly.Table;
  let bus = { sda: 21, scl: 22 };
  const decoder = new TextDecoder();
  let partial = "";

  const emit = (text: string) => {
    partial += text;
    let nl: number;
    while ((nl = partial.indexOf("\n")) >= 0) {
      io.onStdout?.(partial.slice(0, nl).replace(/\r$/, ""));
      partial = partial.slice(nl + 1);
    }
  };
  const flush = () => {
    if (partial) {
      io.onStdout?.(partial.replace(/\r$/, ""));
      partial = "";
    }
  };
  const bytes = (ptr: number, len: number) => new Uint8Array(memory.buffer, ptr, len);
  const cstr = (ptr: number) => {
    if (!ptr) return "";
    const mem = new Uint8Array(memory.buffer);
    let end = ptr;
    while (mem[end]) end++;
    return decoder.decode(mem.subarray(ptr, end));
  };
  /** Copy `data` into a C buffer of `cap` bytes, always NUL-terminated; returns bytes copied. */
  const putBytes = (ptr: number, cap: number, data: Uint8Array) => {
    if (cap <= 0) return 0;
    const n = Math.min(data.length, cap - 1);
    const mem = new Uint8Array(memory.buffer);
    mem.set(data.subarray(0, n), ptr);
    mem[ptr + n] = 0;
    return n;
  };
  const encoder = new TextEncoder();
  const WIFI_CODE = { idle: 0, connecting: 0, connected: 2, failed: 3 } as const;

  const env: Record<string, (...args: number[]) => number | void> = {
    pinMode: (pin, mode) => hal.pinMode(pin, toSimMode(mode)),
    digitalWrite: (pin, val) => hal.digitalWrite(pin, val),
    digitalRead: (pin) => hal.digitalRead(pin),
    analogRead: (pin) => hal.analogRead(pin),
    delayMicroseconds: (us) => hal.delayUs(us >>> 0),
    millis: () => hal.millis() >>> 0,
    micros: () => hal.micros() >>> 0,
    simDelay: (ms) => {
      flush();
      hal.delay(ms >>> 0);
    },
    simSerialWrite: (ptr, len) => emit(decoder.decode(bytes(ptr, len), { stream: true })),
    simPwmWrite: (pin, freq, duty) => hal.pwm(pin, freq, duty),
    simPwmStop: (pin) => hal.pwmStop(pin),
    simTone: (pin, freq, durationMs) => {
      hal.pwm(pin, freq, 32768);
      if (durationMs > 0) hal.timerStart(1000 + pin, durationMs, false, () => hal.pwmStop(pin));
      else hal.timerStop(1000 + pin);
    },
    simPulseIn: (pin, state, timeoutUs) => {
      const r = hal.pulseIn(pin, state, timeoutUs >>> 0);
      return r < 0 ? 0 : r;
    },
    simAttachInterrupt: (pin, fnIndex, mode) => {
      const fn = table.get(fnIndex) as () => void;
      hal.attachInterrupt(pin, mode === 1 ? "rising" : mode === 2 ? "falling" : "change", () => fn());
    },
    simDetachInterrupt: (pin) => hal.detachInterrupt(pin),
    simI2cBegin: (sda, scl) => {
      bus = { sda, scl };
    },
    // Wire.endTransmission() status: 0 = success, 2 = NACK on address.
    simI2cWrite: (addr, ptr, len) => (hal.i2cWrite(bus.sda, bus.scl, addr, bytes(ptr, len).slice()) ? 0 : 2),
    simI2cRead: (addr, ptr, len) => {
      const data = hal.i2cRead(bus.sda, bus.scl, addr, len);
      if (!data) return 0;
      bytes(ptr, data.length).set(data);
      return data.length;
    },
    // kind: 22 = DHT22/DHT21, 11 = DHT11. which: 0 = temperature (C), 1 = humidity (%).
    simSensorRead: (kind, pin, which) => {
      const r = hal.sensorRead("dht22", pin);
      if (!r) return NaN;
      const v = which === 0 ? r.temperature : r.humidity;
      return kind === 11 ? Math.trunc(v) : v;
    },
    simMath: (fn, a, b) => (MATH[fn] ?? (() => NaN))(a, b),

    // --- Wi-Fi, MQTT, HTTP ---------------------------------------------------
    simWifiBegin: (ssid) => hal.wifiBegin(cstr(ssid)),
    simWifiStatus: () => WIFI_CODE[hal.wifiStatus()],
    simWifiDisconnect: () => hal.wifiDisconnect(),
    simWifiLocalIp: (ptr, cap) => void putBytes(ptr, cap, encoder.encode(WIFI_IP)),
    simMqttConnect: (host, port, id, user, pass, keepalive) => {
      if (!hal.net || hal.wifiStatus() !== "connected") return 1;
      const r = hal.net.mqttConnect({
        host: cstr(host),
        port,
        clientId: cstr(id),
        username: cstr(user) || undefined,
        password: cstr(pass) || undefined,
        keepalive,
      });
      return r.ok ? 0 : 5;
    },
    simMqttConnected: () => (hal.net?.mqttConnected() ? 1 : 0),
    simMqttPublish: (topic, ptr, len, retain, qos) =>
      hal.net?.mqttPublish(cstr(topic), bytes(ptr, len).slice(), !!retain, qos) ? 1 : 0,
    simMqttSubscribe: (topic, qos) => (hal.net?.mqttSubscribe(cstr(topic), qos) ? 1 : 0),
    simMqttPoll: (tbuf, tcap, pbuf, pcap) => {
      const m = hal.net?.mqttPoll();
      if (!m) return -1;
      putBytes(tbuf, tcap, encoder.encode(m.topic));
      return putBytes(pbuf, pcap, m.payload);
    },
    simMqttDisconnect: () => hal.net?.mqttDisconnect(),
    simHttp: (method, url, headers, body, bodyLen, out, outCap) => {
      if (!hal.net || hal.wifiStatus() !== "connected") return -1;
      const hs: Record<string, string> = {};
      for (const line of cstr(headers).split("\n")) {
        const i = line.indexOf(":");
        if (i > 0) hs[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      const r = hal.net.httpRequest({
        method: cstr(method),
        url: cstr(url),
        headers: hs,
        body: bodyLen ? decoder.decode(bytes(body, bodyLen).slice()) : undefined,
      });
      if (r.error || r.status <= 0) return -1;
      putBytes(out, outCap, encoder.encode(r.body));
      return r.status;
    },
  };

  const missing = WebAssembly.Module.imports(module)
    .filter((i) => i.module !== "env" || !(i.name in env))
    .map((i) => demangle(i.name));
  if (missing.length) {
    throw new Error(
      `This sketch uses functions the simulator does not support: ${[...new Set(missing)].join(", ")}`,
    );
  }

  const instance = await WebAssembly.instantiate(module, { env });
  memory = instance.exports.memory as WebAssembly.Memory;
  table = instance.exports.__indirect_function_table as WebAssembly.Table;
  const { sim_setup, sim_loop } = instance.exports as { sim_setup: () => void; sim_loop: () => void };
  return { setup: sim_setup, loop: sim_loop, flush };
}

/** Run setup() then loop() until `shouldStop` or `maxLoops` (tests). Normal stop = Worker.terminate(). */
export function runSketch(
  sketch: Sketch,
  opts: { shouldStop?: () => boolean; maxLoops?: number } = {},
): void {
  sketch.setup();
  for (let i = 0; opts.maxLoops === undefined || i < opts.maxLoops; i++) {
    if (opts.shouldStop?.()) break;
    sketch.loop();
  }
  sketch.flush();
}
