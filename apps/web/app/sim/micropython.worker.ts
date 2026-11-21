import { PinState } from "@esp32-sim/sim-core";
import { runMicroPython } from "@esp32-sim/runtime-micropython";

const BLINK = `
import hal, time
hal.mode(2, 2)
print("blink started")
while True:
    hal.write(2, 1)
    time.sleep_ms(500)
    hal.write(2, 0)
    time.sleep_ms(500)
`;

self.onmessage = async (e: MessageEvent<{ buffer: SharedArrayBuffer; wasmUrl: string; loaderUrl: string }>) => {
  try {
    await runMicroPython(BLINK, {
      wasmUrl: e.data.wasmUrl,
      loaderUrl: e.data.loaderUrl,
      pins: new PinState(e.data.buffer),
      onStdout: (line) => postMessage({ type: "stdout", line }),
      onStderr: (line) => postMessage({ type: "stderr", line }),
    });
  } catch (err) {
    postMessage({ type: "error", message: String(err) });
  }
};
