/**
 * Logic-level circuit model: wires are merged into nets (union-find), each net
 * resolves to a level from the drivers on it. No electrical (SPICE) simulation.
 * No React / DOM imports: runs in a Worker and in plain `bun test`.
 *
 * Some devices change the netlist or drive nets depending on the levels they
 * see (relay contacts, powered sensors), so evaluation repeats until the
 * device states stop changing (a few passes at most).
 */
import { PinField, PinMode, PinState } from "./pins";

export type Endpoint = string; // "<componentId>:<PIN>"
export interface PlacedComponent {
  id: string;
  type: string;
}
export interface Wire {
  id: string;
  a: Endpoint;
  b: Endpoint;
}
export interface CircuitData {
  components: PlacedComponent[];
  wires: Wire[];
}

export interface BoardPin {
  /** GPIO number if the pin is a GPIO. */
  gpio?: number;
  /** Fixed supply rail. */
  supply?: { level: 0 | 1; volts: number };
}

/** How the engine treats a component type. Pin names refer to the device's pin list. */
export type ElementSpec =
  | { kind: "board"; pins: Record<string, BoardPin> }
  /** Passes the level through (resistor, pull-up/down). */
  | { kind: "resistor"; a: string; b: string }
  /** Connects a and b while closed (button, switch). */
  | { kind: "switch"; a: string; b: string }
  | { kind: "led"; anode: string; cathode: string }
  | { kind: "rgb-led"; r: string; g: string; b: string; common: string; commonType: "cathode" | "anode" }
  | { kind: "buzzer"; pos: string; neg: string; passive: boolean }
  /** Coil on `in` (active high, powered by vcc/gnd) switches com between no and nc. */
  | { kind: "relay"; vcc: string; gnd: string; in: string; com: string; no: string; nc: string }
  /** Powered source of an analog voltage; value comes from control `control` (0..1). */
  | { kind: "analog-out"; vcc: string; gnd: string; out: string; control: string }
  /** Powered source of a digital level; high when control > 0.5. */
  | { kind: "digital-out"; vcc: string; gnd: string; out: string; control: string }
  /** Reads PWM on `sig` (50 Hz, 0.5-2.5 ms pulse) and reports an angle. */
  | { kind: "servo"; vcc: string; gnd: string; sig: string }
  /** Protocol/sensor device: the engine only tracks its pins and power. */
  | { kind: "module"; pins: string[]; vcc: string; gnd: string };

export type Catalog = Record<string, ElementSpec>;

export type WarningCode = "short" | "led-no-resistor" | "five-volt-gpio" | "input-only-output";

export interface CircuitWarning {
  code: WarningCode;
  message: string;
  componentIds: string[];
  endpoints: Endpoint[];
}

export type Level = 0 | 1;
export type NetKind = "power" | "ground" | "signal";

/** Per-device live output numbers, keyed by name (e.g. {brightness}, {angle}, {on, freq}). */
export type DeviceOutput = Record<string, number>;

/** Control values set by the user: values[componentId][controlId]. */
export type ControlValues = Record<string, Record<string, number>>;

export interface Evaluation {
  /** Net id (root endpoint) per endpoint. */
  netOf: Map<Endpoint, string>;
  /** Resolved level per net id; missing = floating. */
  levels: Map<string, Level>;
  /** GPIO number -> level seen by that pin. */
  gpioInput: Map<number, Level>;
  /** GPIO number -> 12-bit ADC value seen by that pin. */
  gpioAnalog: Map<number, number>;
  /** LED brightness 0..1 per LED component (PWM duty when driven by PWM). */
  leds: Map<string, number>;
  /** Live outputs per component (rgb-led, buzzer, relay, servo, modules' `powered`). */
  outputs: Map<string, DeviceOutput>;
  /** Wire colouring: nets touching a supply high / low rail, otherwise signal. */
  netKind: Map<string, NetKind>;
  warnings: CircuitWarning[];
}

/** Pins that cannot be outputs on the ESP32. */
export const INPUT_ONLY_GPIOS: ReadonlySet<number> = new Set([34, 35, 36, 39]);

/** Add a warning unless the same code on the same endpoints is already listed. */
function addWarning(list: CircuitWarning[], w: CircuitWarning): void {
  const key = (x: CircuitWarning) => `${x.code}|${[...x.endpoints].sort().join(",")}`;
  if (!list.some((x) => key(x) === key(w))) list.push(w);
}

class UnionFind {
  private readonly parent = new Map<string, string>();
  add(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }
  find(x: string): string {
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    while (this.parent.get(x) !== root) {
      const next = this.parent.get(x)!;
      this.parent.set(x, root);
      x = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function pinsOf(spec: ElementSpec): string[] {
  switch (spec.kind) {
    case "board":
      return Object.keys(spec.pins);
    case "resistor":
    case "switch":
      return [spec.a, spec.b];
    case "led":
      return [spec.anode, spec.cathode];
    case "rgb-led":
      return [spec.r, spec.g, spec.b, spec.common];
    case "buzzer":
      return [spec.pos, spec.neg];
    case "relay":
      return [spec.vcc, spec.gnd, spec.in, spec.com, spec.no, spec.nc];
    case "analog-out":
    case "digital-out":
      return [spec.vcc, spec.gnd, spec.out];
    case "servo":
      return [spec.vcc, spec.gnd, spec.sig];
    case "module":
      return spec.pins;
  }
}

/** Device states derived from net levels; the netlist depends on them, so we iterate. */
interface Dynamic {
  /** relay id -> coil active */
  relay: Record<string, boolean>;
  /** component id -> powered (vcc high and gnd low) */
  powered: Record<string, boolean>;
}

interface NetInfo {
  endpoints: Endpoint[];
  strongHigh: boolean;
  strongLow: boolean;
  pullup: boolean;
  pulldown: boolean;
  gpios: Array<{ gpio: number; endpoint: Endpoint; mode: number }>;
  volts5: boolean;
  hasSupplyHigh: boolean;
  hasSupplyLow: boolean;
  /** PWM output driving this net high (duty 0..1 exclusive of 0 and 1). */
  pwm?: { freq: number; duty: number };
  /** 12-bit analog value from a powered analog source. */
  analog?: number;
}

interface Resolved {
  level: Level;
  strength: 1 | 2 | 3;
  pwm?: { freq: number; duty: number };
}

interface Solved {
  netOf: Map<Endpoint, string>;
  nets: Map<string, NetInfo>;
  resolved: Map<string, Resolved>;
  warnings: CircuitWarning[];
}

export class Circuit {
  constructor(
    readonly data: CircuitData,
    readonly catalog: Catalog,
  ) {
    this.validate();
  }

  private spec(c: PlacedComponent): ElementSpec {
    const spec = this.catalog[c.type];
    if (!spec) throw new Error(`unknown component type "${c.type}" (${c.id})`);
    return spec;
  }

  private validate(): void {
    const known = new Set<string>();
    for (const c of this.data.components) {
      for (const pin of pinsOf(this.spec(c))) known.add(`${c.id}:${pin}`);
    }
    for (const w of this.data.wires) {
      for (const e of [w.a, w.b]) {
        if (!known.has(e)) throw new Error(`wire ${w.id} references unknown endpoint ${e}`);
      }
    }
  }

  /**
   * Resolve every net. `switches` maps button/switch id -> closed; `values` holds
   * control values (potentiometer position, PIR motion, ...). `pins` supplies
   * GPIO modes/latches; pass null for static checks only.
   */
  evaluate(
    pins: PinState | null,
    switches: Record<string, boolean> = {},
    values: ControlValues = {},
  ): Evaluation {
    let dyn: Dynamic = { relay: {}, powered: {} };
    let solved = this.solve(pins, switches, values, dyn);
    for (let i = 0; i < 4; i++) {
      const next = this.derive(solved);
      if (JSON.stringify(next) === JSON.stringify(dyn)) break;
      dyn = next;
      solved = this.solve(pins, switches, values, dyn);
    }
    return this.finish(solved, dyn);
  }

  private level(s: Solved, endpoint: Endpoint): Level | undefined {
    return s.resolved.get(s.netOf.get(endpoint)!)?.level;
  }

  /** Device states for the next pass, from this pass's levels. */
  private derive(s: Solved): Dynamic {
    const next: Dynamic = { relay: {}, powered: {} };
    for (const c of this.data.components) {
      const spec = this.spec(c);
      const power = (vcc: string, gnd: string) =>
        this.level(s, `${c.id}:${vcc}`) === 1 && this.level(s, `${c.id}:${gnd}`) === 0;
      if (spec.kind === "relay") {
        const on = power(spec.vcc, spec.gnd);
        next.powered[c.id] = on;
        next.relay[c.id] = on && this.level(s, `${c.id}:${spec.in}`) === 1;
      } else if (
        spec.kind === "analog-out" ||
        spec.kind === "digital-out" ||
        spec.kind === "servo" ||
        spec.kind === "module"
      ) {
        next.powered[c.id] = power(spec.vcc, spec.gnd);
      }
    }
    return next;
  }

  private solve(
    pins: PinState | null,
    switches: Record<string, boolean>,
    values: ControlValues,
    dyn: Dynamic,
  ): Solved {
    const uf = new UnionFind();
    for (const c of this.data.components) {
      for (const pin of pinsOf(this.spec(c))) uf.add(`${c.id}:${pin}`);
    }
    for (const w of this.data.wires) uf.union(w.a, w.b);
    for (const c of this.data.components) {
      const spec = this.spec(c);
      if (spec.kind === "switch" && switches[c.id]) uf.union(`${c.id}:${spec.a}`, `${c.id}:${spec.b}`);
      if (spec.kind === "relay") {
        uf.union(`${c.id}:${spec.com}`, `${c.id}:${dyn.relay[c.id] ? spec.no : spec.nc}`);
      }
    }

    const netOf = new Map<Endpoint, string>();
    for (const c of this.data.components) {
      for (const pin of pinsOf(this.spec(c))) netOf.set(`${c.id}:${pin}`, uf.find(`${c.id}:${pin}`));
    }

    const nets = new Map<string, NetInfo>();
    const netInfo = (id: string): NetInfo => {
      let n = nets.get(id);
      if (!n) {
        n = {
          endpoints: [],
          strongHigh: false,
          strongLow: false,
          pullup: false,
          pulldown: false,
          gpios: [],
          volts5: false,
          hasSupplyHigh: false,
          hasSupplyLow: false,
        };
        nets.set(id, n);
      }
      return n;
    };

    const warnings: CircuitWarning[] = [];
    const warn = (w: CircuitWarning) => addWarning(warnings, w);
    const ownerIds = (n: NetInfo) => [...new Set(n.endpoints.map((e) => e.split(":")[0]))];

    for (const c of this.data.components) {
      const spec = this.spec(c);
      for (const pin of pinsOf(spec)) {
        const endpoint = `${c.id}:${pin}`;
        netInfo(netOf.get(endpoint)!).endpoints.push(endpoint);
      }

      if (spec.kind === "digital-out" && dyn.powered[c.id]) {
        const n = netInfo(netOf.get(`${c.id}:${spec.out}`)!);
        if ((values[c.id]?.[spec.control] ?? 0) > 0.5) n.strongHigh = true;
        else n.strongLow = true;
      }
      if (spec.kind === "analog-out" && dyn.powered[c.id]) {
        const v = Math.min(1, Math.max(0, values[c.id]?.[spec.control] ?? 0));
        netInfo(netOf.get(`${c.id}:${spec.out}`)!).analog = Math.round(v * 4095);
      }

      if (spec.kind !== "board") continue;
      for (const [pin, def] of Object.entries(spec.pins)) {
        const endpoint = `${c.id}:${pin}`;
        const n = netInfo(netOf.get(endpoint)!);
        if (def.supply) {
          if (def.supply.level) n.hasSupplyHigh = n.strongHigh = true;
          else n.hasSupplyLow = n.strongLow = true;
          if (def.supply.volts >= 5) n.volts5 = true;
        }
        if (def.gpio === undefined) continue;
        const mode = pins ? pins.get(def.gpio, PinField.Mode) : PinMode.Unset;
        n.gpios.push({ gpio: def.gpio, endpoint, mode });
        let latch = pins ? pins.get(def.gpio, PinField.Level) : 0;
        const pwmFreq = pins ? pins.get(def.gpio, PinField.PwmFreq) : 0;
        if (mode === PinMode.Output && pwmFreq > 0) {
          const duty = Math.min(1, Math.max(0, pins!.get(def.gpio, PinField.Pwm) / 65535));
          latch = duty > 0 ? 1 : 0;
          if (duty > 0) n.pwm = { freq: pwmFreq, duty };
        }
        if (mode === PinMode.Output) {
          if (latch) n.strongHigh = true;
          else n.strongLow = true;
        } else if (mode === PinMode.OpenDrain) {
          if (!latch) n.strongLow = true;
        } else if (mode === PinMode.InputPullup) {
          n.pullup = true;
        } else if (mode === PinMode.InputPulldown) {
          n.pulldown = true;
        }
        if (INPUT_ONLY_GPIOS.has(def.gpio) && (mode === PinMode.Output || mode === PinMode.OpenDrain)) {
          warn({
            code: "input-only-output",
            message: `GPIO${def.gpio} is input-only on the ESP32 and cannot be used as an output`,
            componentIds: [c.id],
            endpoints: [endpoint],
          });
        }
      }
    }

    // Strength 3 = strong driver, 2 = through a resistor / analog source, 1 = internal pull.
    const resolved = new Map<string, Resolved>();
    for (const [id, n] of nets) {
      if (n.strongHigh && n.strongLow) {
        warn({
          code: "short",
          message: "Two outputs/supplies drive this net to different levels (short circuit)",
          componentIds: ownerIds(n),
          endpoints: n.endpoints,
        });
        resolved.set(id, { level: 0, strength: 3 });
      } else if (n.strongHigh) {
        // PWM at duty < 1 keeps its duty; a plain high loses it.
        resolved.set(id, { level: 1, strength: 3, pwm: n.pwm && n.pwm.duty < 1 ? n.pwm : undefined });
      } else if (n.strongLow) resolved.set(id, { level: 0, strength: 3 });
      else if (n.analog !== undefined) resolved.set(id, { level: n.analog > 2047 ? 1 : 0, strength: 2 });
      else if (n.pullup && !n.pulldown) resolved.set(id, { level: 1, strength: 1 });
      else if (n.pulldown && !n.pullup) resolved.set(id, { level: 0, strength: 1 });
    }

    // Propagate through resistors until stable. A level only moves to nets with weaker strength.
    const resistors = this.data.components.flatMap((c) => {
      const s = this.spec(c);
      return s.kind === "resistor"
        ? [{ a: netOf.get(`${c.id}:${s.a}`)!, b: netOf.get(`${c.id}:${s.b}`)! }]
        : [];
    });
    for (let changed = true, guard = 0; changed && guard < 100; guard++) {
      changed = false;
      for (const r of resistors) {
        for (const [from, to] of [
          [r.a, r.b],
          [r.b, r.a],
        ] as const) {
          const src = resolved.get(from);
          if (!src || src.strength < 2) continue;
          const dst = resolved.get(to);
          if (!dst || dst.strength < 2) {
            resolved.set(to, { level: src.level, strength: 2, pwm: src.pwm });
            changed = true;
          }
        }
      }
    }

    return { netOf, nets, resolved, warnings };
  }

  private finish(s: Solved, dyn: Dynamic): Evaluation {
    const { netOf, nets, resolved, warnings } = s;
    const warn = (w: CircuitWarning) => addWarning(warnings, w);
    const levels = new Map<string, Level>();
    for (const [id, r] of resolved) levels.set(id, r.level);
    const res = (e: Endpoint) => resolved.get(netOf.get(e)!);
    const lvl = (e: Endpoint) => res(e)?.level;

    const gpioInput = new Map<number, Level>();
    const gpioAnalog = new Map<number, number>();
    for (const [id, n] of nets) {
      for (const g of n.gpios) {
        const level = levels.get(id) ?? 0;
        gpioInput.set(g.gpio, level);
        gpioAnalog.set(g.gpio, n.analog ?? (level ? 4095 : 0));
      }
    }

    const leds = new Map<string, number>();
    const outputs = new Map<string, DeviceOutput>();
    const direct = (net: NetInfo | undefined, high: boolean) =>
      !!net && (net.gpios.length > 0 || (high ? net.hasSupplyHigh : net.hasSupplyLow));
    const brightness = (anode: Endpoint, cathode: Endpoint) =>
      res(anode)?.level === 1 && res(cathode)?.level === 0 ? (res(anode)?.pwm?.duty ?? 1) : 0;

    for (const c of this.data.components) {
      const spec = this.spec(c);
      switch (spec.kind) {
        case "led": {
          const a = `${c.id}:${spec.anode}`;
          const k = `${c.id}:${spec.cathode}`;
          leds.set(c.id, brightness(a, k));
          if (direct(nets.get(netOf.get(a)!), true) && direct(nets.get(netOf.get(k)!), false)) {
            warn({
              code: "led-no-resistor",
              message: `LED ${c.id} is connected without a series resistor`,
              componentIds: [c.id],
              endpoints: [a, k],
            });
          }
          break;
        }
        case "rgb-led": {
          const common = `${c.id}:${spec.common}`;
          const channel = (pin: string) =>
            spec.commonType === "cathode"
              ? brightness(`${c.id}:${pin}`, common)
              : res(common)?.level === 1 && res(`${c.id}:${pin}`)?.level === 0
                ? (res(`${c.id}:${pin}`)?.pwm?.duty ?? 1)
                : 0;
          outputs.set(c.id, { r: channel(spec.r), g: channel(spec.g), b: channel(spec.b) });
          break;
        }
        case "buzzer": {
          const pos = `${c.id}:${spec.pos}`;
          const on = res(pos)?.level === 1 && lvl(`${c.id}:${spec.neg}`) === 0;
          const pwm = res(pos)?.pwm;
          outputs.set(c.id, { on: on ? 1 : 0, freq: spec.passive ? (pwm?.freq ?? 0) : 0 });
          break;
        }
        case "relay":
          outputs.set(c.id, { active: dyn.relay[c.id] ? 1 : 0, powered: dyn.powered[c.id] ? 1 : 0 });
          break;
        case "servo": {
          const sig = res(`${c.id}:${spec.sig}`);
          let angle = 0;
          if (dyn.powered[c.id] && sig?.pwm) {
            const pulseUs = sig.pwm.duty * (1_000_000 / sig.pwm.freq);
            angle = Math.min(180, Math.max(0, ((pulseUs - 500) / 2000) * 180));
          }
          outputs.set(c.id, { angle, powered: dyn.powered[c.id] ? 1 : 0 });
          break;
        }
        case "analog-out":
        case "digital-out":
        case "module":
          outputs.set(c.id, { powered: dyn.powered[c.id] ? 1 : 0 });
          break;
        default:
          break;
      }
    }

    for (const n of nets.values()) {
      if (n.volts5 && n.gpios.length > 0) {
        warn({
          code: "five-volt-gpio",
          message: "5V is connected to a GPIO pin (ESP32 GPIOs are 3.3V only)",
          componentIds: [...new Set(n.endpoints.map((e) => e.split(":")[0]))],
          endpoints: n.endpoints,
        });
      }
    }

    const netKind = new Map<string, NetKind>();
    for (const [id, n] of nets) {
      netKind.set(id, n.hasSupplyHigh ? "power" : n.hasSupplyLow ? "ground" : "signal");
    }

    return { netOf, levels, gpioInput, gpioAnalog, leds, outputs, netKind, warnings };
  }

  /** GPIO numbers wired (directly) to the net of `endpoint`. Used to map modules to board pins. */
  gpiosOnNet(endpoint: Endpoint, evaluation: Evaluation): number[] {
    const net = evaluation.netOf.get(endpoint);
    if (!net) return [];
    const gpios: number[] = [];
    for (const c of this.data.components) {
      const spec = this.spec(c);
      if (spec.kind !== "board") continue;
      for (const [pin, def] of Object.entries(spec.pins)) {
        if (def.gpio !== undefined && evaluation.netOf.get(`${c.id}:${pin}`) === net) gpios.push(def.gpio);
      }
    }
    return gpios;
  }

  /** Write the circuit-side level and ADC value of every GPIO into the shared pin buffer. */
  applyInputs(pins: PinState, evaluation: Evaluation): void {
    for (const [gpio, level] of evaluation.gpioInput) {
      pins.set(gpio, PinField.Input, level);
      pins.set(gpio, PinField.Analog, evaluation.gpioAnalog.get(gpio) ?? (level ? 4095 : 0));
    }
  }
}
