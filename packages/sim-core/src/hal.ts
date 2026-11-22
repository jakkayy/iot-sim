/**
 * The hardware abstraction layer both runtimes (MicroPython, Arduino) call.
 * Runs inside the runtime Worker. Interrupts and timers are polled at every HAL
 * call and between slices of a delay, because Atomics.notify cannot interrupt
 * running wasm code.
 */
import { PinField, PinMode, PinState } from "./pins";
import { VirtualClock } from "./clock";

export type Edge = "rising" | "falling" | "change";

export interface HalOptions {
  pins: PinState;
  clock: VirtualClock;
  /** Block up to `realMs`, returning early if woken. Default: PinState.waitWake. Injected in tests. */
  sleep?: (realMs: number) => void;
}

interface Irq {
  edge: Edge;
  handler: () => void;
  last: number;
}
interface TimerEntry {
  periodMs: number;
  periodic: boolean;
  next: number;
  handler: () => void;
}

/** Longest stretch (virtual ms) a delay sleeps before polling interrupts/timers again. */
const SLICE_MS = 2;

export class SimHal {
  readonly pins: PinState;
  readonly clock: VirtualClock;
  private readonly sleepReal: (realMs: number) => void;
  private readonly irqs = new Map<number, Irq>();
  private readonly timers = new Map<number, TimerEntry>();
  private polling = false;

  constructor(opts: HalOptions) {
    this.pins = opts.pins;
    this.clock = opts.clock;
    this.sleepReal = opts.sleep ?? ((ms) => opts.pins.waitWake(ms));
  }

  // --- GPIO -------------------------------------------------------------
  pinMode(pin: number, mode: number): void {
    this.poll();
    this.pins.setMode(pin, mode);
  }

  digitalWrite(pin: number, level: number): void {
    this.poll();
    this.pins.writeDigital(pin, level ? 1 : 0);
  }

  digitalRead(pin: number): number {
    this.poll();
    return this.pins.readPin(pin);
  }

  // --- Analog / PWM -----------------------------------------------------
  /** 12-bit ADC value (0..4095). */
  analogRead(pin: number): number {
    this.poll();
    return this.pins.get(pin, PinField.Analog);
  }

  /** Start/update PWM. `duty16` is 0..65535. The pin becomes an output. */
  pwm(pin: number, freqHz: number, duty16: number): void {
    this.poll();
    if (this.pins.get(pin, PinField.Mode) !== PinMode.Output) this.pins.setMode(pin, PinMode.Output);
    this.pins.set(pin, PinField.PwmFreq, Math.max(1, Math.round(freqHz)));
    this.pins.set(pin, PinField.Pwm, Math.min(65535, Math.max(0, Math.round(duty16))));
  }

  pwmStop(pin: number): void {
    this.pins.set(pin, PinField.PwmFreq, 0);
    this.pins.set(pin, PinField.Pwm, 0);
  }

  // --- Time -------------------------------------------------------------
  millis(): number {
    this.poll();
    return Math.floor(this.clock.nowMs());
  }

  micros(): number {
    this.poll();
    return Math.floor(this.clock.nowMs() * 1000);
  }

  /**
   * Virtual delay. Polls interrupts and timers between slices; if `until`
   * returns true after a poll the delay ends early (used by MicroPython to
   * run Python handlers promptly).
   */
  delay(ms: number, until?: () => boolean): void {
    const target = this.clock.nowMs() + ms;
    for (;;) {
      this.poll();
      if (until?.()) return;
      const remaining = target - this.clock.nowMs();
      if (remaining <= 0) return;
      this.sleepReal(this.clock.realDelayFor(Math.min(remaining, SLICE_MS)));
    }
  }

  delayUs(us: number, until?: () => boolean): void {
    this.delay(us / 1000, until);
  }

  // --- Interrupts / timers ---------------------------------------------
  attachInterrupt(pin: number, edge: Edge, handler: () => void): void {
    this.irqs.set(pin, { edge, handler, last: this.pins.readPin(pin) });
  }

  detachInterrupt(pin: number): void {
    this.irqs.delete(pin);
  }

  timerStart(id: number, periodMs: number, periodic: boolean, handler: () => void): void {
    this.timers.set(id, { periodMs, periodic, next: this.clock.nowMs() + periodMs, handler });
  }

  timerStop(id: number): void {
    this.timers.delete(id);
  }

  /** Fire due interrupt edges and timers. Re-entrant calls (from a handler) are ignored. */
  poll(): void {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const [pin, irq] of this.irqs) {
        const cur = this.pins.readPin(pin);
        if (cur === irq.last) continue;
        const rising = cur > irq.last;
        irq.last = cur;
        if (irq.edge === "change" || (irq.edge === "rising") === rising) irq.handler();
      }
      if (this.timers.size > 0) {
        const now = this.clock.nowMs();
        for (const [id, t] of [...this.timers]) {
          if (now < t.next) continue;
          if (t.periodic) t.next = now - t.next > t.periodMs ? now + t.periodMs : t.next + t.periodMs;
          else this.timers.delete(id);
          t.handler();
        }
      }
    } finally {
      this.polling = false;
    }
  }
}
