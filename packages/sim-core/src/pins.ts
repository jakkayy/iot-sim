/**
 * Pin state shared between the user-code Worker (writer) and the UI main
 * thread (reader) through a SharedArrayBuffer. No React / DOM imports here:
 * this module must run inside a Worker and in plain `bun test`.
 */

export const PIN_COUNT = 40;

/** Int32 slots per pin. */
export const PinField = {
  Mode: 0,
  Level: 1,
  Analog: 2,
  Pwm: 3,
  /** Level the pin reads from the circuit (written by the UI thread after evaluating nets). */
  Input: 4,
  /** PWM frequency in Hz; 0 means PWM is off. Duty lives in `Pwm` (0..65535). */
  PwmFreq: 5,
} as const;
export const FIELDS_PER_PIN = 6;

/** Extra Int32 after the pin slots: bumped by the UI thread to wake a sleeping Worker. */
const WAKE_INDEX = PIN_COUNT * FIELDS_PER_PIN;

export const PinMode = {
  Unset: 0,
  Input: 1,
  Output: 2,
  InputPullup: 3,
  /** Drives low or releases the line; used for I2C / 1-Wire. */
  OpenDrain: 4,
  InputPulldown: 5,
} as const;

export function createPinBuffer(): SharedArrayBuffer {
  return new SharedArrayBuffer((PIN_COUNT * FIELDS_PER_PIN + 1) * Int32Array.BYTES_PER_ELEMENT);
}

export class PinState {
  readonly view: Int32Array;

  constructor(buffer: SharedArrayBuffer) {
    this.view = new Int32Array(buffer);
  }

  private idx(pin: number, field: number): number {
    if (!Number.isInteger(pin) || pin < 0 || pin >= PIN_COUNT) {
      throw new RangeError(`invalid pin ${pin}`);
    }
    return pin * FIELDS_PER_PIN + field;
  }

  get(pin: number, field: number): number {
    return Atomics.load(this.view, this.idx(pin, field));
  }

  set(pin: number, field: number, value: number): void {
    Atomics.store(this.view, this.idx(pin, field), value);
  }

  setMode(pin: number, mode: number): void {
    this.set(pin, PinField.Mode, mode);
  }

  writeDigital(pin: number, level: 0 | 1): void {
    this.set(pin, PinField.Level, level);
  }

  /** Level the code last wrote to the pin (its output latch). */
  readDigital(pin: number): number {
    return this.get(pin, PinField.Level);
  }

  /** What digitalRead() returns: the latch for outputs, the circuit level otherwise. */
  readPin(pin: number): number {
    const mode = this.get(pin, PinField.Mode);
    return mode === PinMode.Output ? this.get(pin, PinField.Level) : this.get(pin, PinField.Input);
  }

  /** UI thread: signal that inputs changed so a sleeping Worker can poll sooner. */
  notifyWake(): void {
    Atomics.add(this.view, WAKE_INDEX, 1);
    Atomics.notify(this.view, WAKE_INDEX);
  }

  /** Worker: block up to `ms` real milliseconds, returning early if notifyWake() is called. */
  waitWake(ms: number): void {
    if (ms <= 0) return;
    Atomics.wait(this.view, WAKE_INDEX, Atomics.load(this.view, WAKE_INDEX), ms);
  }
}
