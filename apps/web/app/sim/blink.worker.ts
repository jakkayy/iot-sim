import { PinMode, PinState, sleepMs } from "@esp32-sim/sim-core";

// Spike: JS "blink" using the same primitives MicroPython/Arduino HAL will use.
self.onmessage = (e: MessageEvent<{ buffer: SharedArrayBuffer }>) => {
  const pins = new PinState(e.data.buffer);
  pins.setMode(2, PinMode.Output);
  for (;;) {
    pins.writeDigital(2, 1);
    sleepMs(500);
    pins.writeDigital(2, 0);
    sleepMs(500);
  }
};
