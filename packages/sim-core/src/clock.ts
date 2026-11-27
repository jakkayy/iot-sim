/**
 * Virtual clock shared through a SharedArrayBuffer so the UI thread can change
 * the speed while the runtime Worker reads time. Layout (Float64):
 * [0] real time at last re-anchor (ms), [1] virtual time at that moment (ms), [2] speed.
 * millis()/micros() must read this clock rather than performance.now().
 */
export function createClockBuffer(): SharedArrayBuffer {
  return new SharedArrayBuffer(3 * Float64Array.BYTES_PER_ELEMENT);
}

export class VirtualClock {
  private readonly v: Float64Array;

  constructor(
    buffer: SharedArrayBuffer,
    private readonly realNow: () => number = () => performance.now(),
    init = false,
  ) {
    this.v = new Float64Array(buffer);
    if (init) {
      this.v[0] = this.realNow();
      this.v[1] = 0;
      this.v[2] = 1;
    }
  }

  get speed(): number {
    return this.v[2];
  }

  /** Virtual milliseconds since the clock was created. */
  nowMs(): number {
    return this.v[1] + (this.realNow() - this.v[0]) * this.v[2];
  }

  /** Change speed without a jump in virtual time (UI thread only). */
  setSpeed(speed: number): void {
    if (!(speed > 0) || !Number.isFinite(speed)) throw new RangeError(`invalid speed ${speed}`);
    const virtual = this.nowMs();
    this.v[0] = this.realNow();
    this.v[1] = virtual;
    this.v[2] = speed;
  }

  /** Real milliseconds a virtual delay of `ms` takes at the current speed. */
  realDelayFor(ms: number): number {
    return ms / this.v[2];
  }

  /** Blocking virtual delay (Worker only). */
  sleep(ms: number): void {
    const real = this.realDelayFor(ms);
    if (real <= 0) return;
    const cell = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(cell, 0, 0, real);
  }
}
