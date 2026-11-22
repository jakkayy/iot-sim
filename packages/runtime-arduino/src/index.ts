import { PinMode, type SimHal } from "@esp32-sim/sim-core";

export interface Sketch {
  setup(): void;
  loop(): void;
}

// Arduino-ESP32 pinMode() constants -> sim-core PinMode.
function toSimMode(arduinoMode: number): number {
  switch (arduinoMode) {
    case 0x01:
      return PinMode.Input;
    case 0x03:
      return PinMode.Output;
    case 0x05:
      return PinMode.InputPullup;
    case 0x09:
      return PinMode.InputPulldown;
    case 0x12:
      return PinMode.OpenDrain;
    default:
      throw new RangeError(`unsupported pinMode ${arduinoMode}`);
  }
}

/** Instantiate a sketch compiled against arduino-shim; every import is a HAL call. */
export async function loadSketch(wasm: BufferSource, hal: SimHal): Promise<Sketch> {
  const module = await WebAssembly.compile(wasm);
  const instance = await WebAssembly.instantiate(module, {
    env: {
      pinMode: (pin: number, mode: number) => hal.pinMode(pin, toSimMode(mode)),
      digitalWrite: (pin: number, val: number) => hal.digitalWrite(pin, val),
      digitalRead: (pin: number) => hal.digitalRead(pin),
      analogRead: (pin: number) => hal.analogRead(pin),
      delay: (ms: number) => hal.delay(ms >>> 0),
      delayMicroseconds: (us: number) => hal.delayUs(us >>> 0),
      millis: () => hal.millis() >>> 0,
      micros: () => hal.micros() >>> 0,
    },
  });
  const { sim_setup, sim_loop } = instance.exports as {
    sim_setup: () => void;
    sim_loop: () => void;
  };
  return { setup: sim_setup, loop: sim_loop };
}

/** Run setup() then loop() until `shouldStop` or `maxLoops` (tests). Normal stop = Worker.terminate(). */
export function runSketch(
  sketch: Sketch,
  opts: { shouldStop?: () => boolean; maxLoops?: number } = {},
): void {
  sketch.setup();
  for (let i = 0; opts.maxLoops === undefined || i < opts.maxLoops; i++) {
    if (opts.shouldStop?.()) return;
    sketch.loop();
  }
}
