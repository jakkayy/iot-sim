import { PinState } from "./pins";

declare const self: Worker;
self.onmessage = (e: MessageEvent<SharedArrayBuffer>) => {
  const t0 = performance.now();
  new PinState(e.data).waitWake(2000);
  self.postMessage(performance.now() - t0);
};
