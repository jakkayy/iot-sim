import type { Wire } from "@esp32-sim/sim-core";
import type { PlacedView } from "./store";

/** Blink wiring: GPIO2 -> resistor -> LED -> GND. */
export const BLINK_DEMO: { components: PlacedView[]; wires: Wire[] } = {
  components: [
    { id: "esp1", type: "esp32-devkit", x: 60, y: 20 },
    { id: "r1", type: "resistor", x: 230, y: 88 },
    { id: "led1", type: "led", x: 340, y: 20 },
  ],
  wires: [
    { id: "w1", a: "esp1:GPIO2", b: "r1:1" },
    { id: "w2", a: "r1:2", b: "led1:A" },
    { id: "w3", a: "led1:K", b: "esp1:GND.2" },
  ],
};
