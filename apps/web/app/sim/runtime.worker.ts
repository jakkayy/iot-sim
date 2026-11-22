import { PinState, SimHal, VirtualClock } from "@esp32-sim/sim-core";
import { startMicroPython } from "@esp32-sim/runtime-micropython";
import { loadSketch, runSketch } from "@esp32-sim/runtime-arduino";
import type { StartMessage, WorkerMessage } from "../../lib/protocol";

const send = (m: WorkerMessage) => postMessage(m);

self.onmessage = async (e: MessageEvent<StartMessage>) => {
  const msg = e.data;
  if (msg.type !== "start") return;
  const hal = new SimHal({
    pins: new PinState(msg.pinsBuffer),
    clock: new VirtualClock(msg.clockBuffer),
  });
  try {
    if (msg.lang === "py") {
      const session = await startMicroPython({
        loaderUrl: msg.urls.micropythonLoader,
        wasmUrl: msg.urls.micropythonWasm,
        hal,
        onStdout: (text) => send({ type: "stdout", text }),
        onStderr: (text) => send({ type: "stderr", text }),
      });
      send({ type: "ready" });
      const result = session.run(msg.code);
      if (!result.ok) {
        send({ type: "error", message: result.error.message, line: result.error.line, printed: true });
      }
      send({ type: "exit" });
    } else {
      const wasm = await (await fetch(msg.urls.sketch!)).arrayBuffer();
      const sketch = await loadSketch(wasm, hal);
      send({ type: "ready" });
      runSketch(sketch); // blocks; Stop terminates the worker
    }
  } catch (err) {
    send({ type: "error", message: String(err) });
    send({ type: "exit" });
  }
};
