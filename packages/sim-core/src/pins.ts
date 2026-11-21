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
} as const;
export const FIELDS_PER_PIN = 4;

export const PinMode = {
  Unset: 0,
  Input: 1,
  Output: 2,
  InputPullup: 3,
} as const;

export function createPinBuffer(): SharedArrayBuffer {
  return new SharedArrayBuffer(PIN_COUNT * FIELDS_PER_PIN * Int32Array.BYTES_PER_ELEMENT);
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

  readDigital(pin: number): number {
    return this.get(pin, PinField.Level);
  }
}
