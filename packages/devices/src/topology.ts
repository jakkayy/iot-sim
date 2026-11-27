import type { Circuit } from "@esp32-sim/sim-core";
import type { DeviceRef } from "./memory";

/**
 * Which board pins each protocol device is wired to. Computed once on the UI
 * thread when Run is pressed and sent to the Worker, which attaches device
 * models to the HAL. Editing the wiring while running needs a restart.
 */
export interface Topology {
  devices: DeviceRef[];
  dht: Array<{ id: string; gpio: number }>;
  hcsr04: Array<{ id: string; echoGpio: number }>;
  i2c: Array<{ id: string; type: "ssd1306" | "lcd-i2c"; sda: number; scl: number }>;
}

export function buildTopology(circuit: Circuit): Topology {
  const ev = circuit.evaluate(null);
  const gpios = (endpoint: string) => circuit.gpiosOnNet(endpoint, ev);
  const topo: Topology = {
    devices: circuit.data.components.map((c) => ({ id: c.id, type: c.type })),
    dht: [],
    hcsr04: [],
    i2c: [],
  };
  for (const c of circuit.data.components) {
    if (c.type === "dht22") {
      for (const gpio of gpios(`${c.id}:DATA`)) topo.dht.push({ id: c.id, gpio });
    } else if (c.type === "hcsr04") {
      for (const echoGpio of gpios(`${c.id}:ECHO`)) topo.hcsr04.push({ id: c.id, echoGpio });
    } else if (c.type === "ssd1306" || c.type === "lcd-i2c") {
      for (const sda of gpios(`${c.id}:SDA`)) {
        for (const scl of gpios(`${c.id}:SCL`)) topo.i2c.push({ id: c.id, type: c.type, sda, scl });
      }
    }
  }
  return topo;
}
