import type { SensorModel } from "@esp32-sim/sim-core";
import type { DeviceMemory } from "../memory";

/** DHT22: readings follow the temperature/humidity sliders while the module is powered. */
export class Dht22 implements SensorModel {
  constructor(
    private readonly mem: DeviceMemory,
    private readonly id: string,
  ) {}
  read() {
    if (!this.mem.get(this.id, "powered")) return null;
    return {
      temperature: this.mem.get(this.id, "temperature"),
      humidity: this.mem.get(this.id, "humidity"),
    };
  }
}

/** HC-SR04: an echo pulse lasts distance_cm * 58 microseconds. */
export class Hcsr04Echo implements SensorModel {
  constructor(
    private readonly mem: DeviceMemory,
    private readonly id: string,
  ) {}
  read() {
    if (!this.mem.get(this.id, "powered")) return null;
    return { echoUs: this.mem.get(this.id, "distance") * 58 };
  }
}
