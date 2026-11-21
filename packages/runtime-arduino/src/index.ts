import { PinMode, PinState, sleepMs } from "@esp32-sim/sim-core";

export interface ArduinoHost {
  pins: PinState;
  /** Defaults to a blocking sleep; only valid inside a Worker. */
  delay?: (ms: number) => void;
  millis?: () => number;
}

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
    default:
      throw new RangeError(`unsupported pinMode ${arduinoMode}`);
  }
}

/** Instantiate a sketch compiled against arduino-shim; imports are the HAL. */
export async function loadSketch(wasm: BufferSource, host: ArduinoHost): Promise<Sketch> {
  const start = performance.now();
  const delay = host.delay ?? sleepMs;
  const millis = host.millis ?? (() => Math.floor(performance.now() - start));
  const module = await WebAssembly.compile(wasm);
  const instance = await WebAssembly.instantiate(module, {
    env: {
      pinMode: (pin: number, mode: number) => host.pins.setMode(pin, toSimMode(mode)),
      digitalWrite: (pin: number, val: number) => host.pins.writeDigital(pin, val ? 1 : 0),
      digitalRead: (pin: number) => host.pins.readDigital(pin),
      delay: (ms: number) => delay(ms),
      millis: () => millis(),
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
