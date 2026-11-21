import { PinState } from "@esp32-sim/sim-core";
import { loadSketch, runSketch } from "@esp32-sim/runtime-arduino";

self.onmessage = async (e: MessageEvent<{ buffer: SharedArrayBuffer; sketchUrl: string }>) => {
  try {
    const wasm = await (await fetch(e.data.sketchUrl)).arrayBuffer();
    const sketch = await loadSketch(wasm, { pins: new PinState(e.data.buffer) });
    postMessage({ type: "stdout", line: "arduino sketch started" });
    runSketch(sketch); // blocks; Stop = worker.terminate()
  } catch (err) {
    postMessage({ type: "error", message: String(err) });
  }
};
