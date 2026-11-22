import type { SimHal } from "@esp32-sim/sim-core";
import type { DeviceMemory } from "./memory";
import { Lcd1602 } from "./models/lcd";
import { Dht22, Hcsr04Echo } from "./models/sensors";
import { Ssd1306 } from "./models/ssd1306";
import type { Topology } from "./topology";

/** Worker side: create the device models for this wiring and hook them to the HAL. */
export function attachDevices(hal: SimHal, topology: Topology, mem: DeviceMemory): void {
  for (const d of topology.dht) hal.attachSensor("dht22", d.gpio, new Dht22(mem, d.id));
  for (const d of topology.hcsr04) hal.attachSensor("hcsr04-echo", d.echoGpio, new Hcsr04Echo(mem, d.id));
  for (const d of topology.i2c) {
    const frame = mem.frame(d.id);
    if (!frame) continue;
    hal.attachI2cSlave(d.sda, d.scl, d.type === "ssd1306" ? new Ssd1306(frame) : new Lcd1602(frame));
  }
}
