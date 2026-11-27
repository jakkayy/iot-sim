import { PinMode, PinState } from "./pins";

declare const self: Worker;
self.onmessage = (e: MessageEvent<SharedArrayBuffer>) => {
  const pins = new PinState(e.data);
  pins.setMode(2, PinMode.Output);
  pins.writeDigital(2, 1);
  self.postMessage("done");
};
