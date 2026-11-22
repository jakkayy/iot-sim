/**
 * Logic-level circuit model: wires are merged into nets (union-find), each net
 * resolves to a level from the drivers on it. No electrical (SPICE) simulation.
 * No React / DOM imports: runs in a Worker and in plain `bun test`.
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

/** How the engine treats a component type. */
export type ElementSpec =
  | { kind: "board"; pins: Record<string, BoardPin> }
  /** Passes the level through (resistor, pull-up/down). */
  | { kind: "resistor"; a: string; b: string }
  /** Connects a and b while closed (button, switch). */
  | { kind: "switch"; a: string; b: string }
  | { kind: "led"; anode: string; cathode: string };

export type Catalog = Record<string, ElementSpec>;

export type WarningCode =
  | "short"
  | "led-no-resistor"
  | "five-volt-gpio"
  | "input-only-output";

export interface CircuitWarning {
  code: WarningCode;
  message: string;
  componentIds: string[];
  endpoints: Endpoint[];
}

export type Level = 0 | 1;

export interface Evaluation {
  /** Net id (root endpoint) per endpoint. */
  netOf: Map<Endpoint, string>;
  /** Resolved level per net id; missing = floating. */
  levels: Map<string, Level>;
  /** GPIO number -> level seen by that pin. */
  gpioInput: Map<number, Level>;
  /** 0 or 1 per LED component. */
  leds: Map<string, Level>;
  warnings: CircuitWarning[];
}

/** Pins that cannot be outputs on the ESP32. */
export const INPUT_ONLY_GPIOS: ReadonlySet<number> = new Set([34, 35, 36, 39]);

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
  }
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
   * Resolve every net. `switches` maps component id -> closed.
   * `pins` supplies GPIO modes/latches; omit for static checks only.
   */
  evaluate(pins: PinState | null, switches: Record<string, boolean> = {}): Evaluation {
    const uf = new UnionFind();
    for (const c of this.data.components) {
      for (const pin of pinsOf(this.spec(c))) uf.add(`${c.id}:${pin}`);
    }
    for (const w of this.data.wires) uf.union(w.a, w.b);
    for (const c of this.data.components) {
      const spec = this.spec(c);
      if (spec.kind === "switch" && switches[c.id]) uf.union(`${c.id}:${spec.a}`, `${c.id}:${spec.b}`);
    }

    const netOf = new Map<Endpoint, string>();
    for (const c of this.data.components) {
      for (const pin of pinsOf(this.spec(c))) netOf.set(`${c.id}:${pin}`, uf.find(`${c.id}:${pin}`));
    }

    interface NetInfo {
      endpoints: Endpoint[];
      strongHigh: boolean;
      strongLow: boolean;
      pullup: boolean;
      gpios: Array<{ gpio: number; endpoint: Endpoint; mode: number }>;
      volts5: boolean;
      hasSupplyHigh: boolean;
      hasSupplyLow: boolean;
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
    const warn = (w: CircuitWarning) => {
      const key = `${w.code}|${[...w.endpoints].sort().join(",")}`;
      if (!warnings.some((x) => `${x.code}|${[...x.endpoints].sort().join(",")}` === key)) warnings.push(w);
    };

    for (const c of this.data.components) {
      const spec = this.spec(c);
      for (const pin of pinsOf(spec)) {
        const endpoint = `${c.id}:${pin}`;
        netInfo(netOf.get(endpoint)!).endpoints.push(endpoint);
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
        const latch = pins ? pins.get(def.gpio, PinField.Level) : 0;
        if (mode === PinMode.Output) {
          if (latch) n.strongHigh = true;
          else n.strongLow = true;
        } else if (mode === PinMode.OpenDrain) {
          if (!latch) n.strongLow = true;
        } else if (mode === PinMode.InputPullup) {
          n.pullup = true;
        }
        if (
          INPUT_ONLY_GPIOS.has(def.gpio) &&
          (mode === PinMode.Output || mode === PinMode.OpenDrain)
        ) {
          warn({
            code: "input-only-output",
            message: `GPIO${def.gpio} is input-only on the ESP32 and cannot be used as an output`,
            componentIds: [c.id],
            endpoints: [endpoint],
          });
        }
      }
    }

    // Resolve levels. Strength 3 = strong driver, 2 = through a resistor, 1 = internal pull-up.
    const resolved = new Map<string, { level: Level; strength: 1 | 2 | 3 }>();
    for (const [id, n] of nets) {
      if (n.strongHigh && n.strongLow) {
        warn({
          code: "short",
          message: "Two outputs/supplies drive this net to different levels (short circuit)",
          componentIds: [...new Set(n.endpoints.map((e) => e.split(":")[0]))],
          endpoints: n.endpoints,
        });
        resolved.set(id, { level: 0, strength: 3 });
      } else if (n.strongHigh) resolved.set(id, { level: 1, strength: 3 });
      else if (n.strongLow) resolved.set(id, { level: 0, strength: 3 });
      else if (n.pullup) resolved.set(id, { level: 1, strength: 1 });
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
            resolved.set(to, { level: src.level, strength: 2 });
            changed = true;
          }
        }
      }
    }

    const levels = new Map<string, Level>();
    for (const [id, r] of resolved) levels.set(id, r.level);

    // GPIO inputs.
    const gpioInput = new Map<number, Level>();
    for (const [id, n] of nets) {
      for (const g of n.gpios) gpioInput.set(g.gpio, levels.get(id) ?? 0);
    }

    // Components that read nets.
    const leds = new Map<string, Level>();
    for (const c of this.data.components) {
      const spec = this.spec(c);
      if (spec.kind !== "led") continue;
      const an = netOf.get(`${c.id}:${spec.anode}`)!;
      const ca = netOf.get(`${c.id}:${spec.cathode}`)!;
      leds.set(c.id, levels.get(an) === 1 && levels.get(ca) === 0 ? 1 : 0);

      const direct = (net: NetInfo | undefined, high: boolean) =>
        !!net && (net.gpios.length > 0 || (high ? net.hasSupplyHigh : net.hasSupplyLow));
      if (direct(nets.get(an), true) && direct(nets.get(ca), false)) {
        warn({
          code: "led-no-resistor",
          message: `LED ${c.id} is connected without a series resistor`,
          componentIds: [c.id],
          endpoints: [`${c.id}:${spec.anode}`, `${c.id}:${spec.cathode}`],
        });
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

    return { netOf, levels, gpioInput, leds, warnings };
  }

  /** Write the circuit-side level of every GPIO into the shared pin buffer. */
  applyInputs(pins: PinState, evaluation: Evaluation): void {
    for (const [gpio, level] of evaluation.gpioInput) pins.set(gpio, PinField.Input, level);
  }
}
