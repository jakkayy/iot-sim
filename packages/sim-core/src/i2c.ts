/** An I2C slave model. Lives in the runtime Worker; display models write into shared memory. */
export interface I2CSlave {
  /** 7-bit address. */
  readonly addr: number;
  /** Master -> slave. Return false to NACK. */
  write(bytes: Uint8Array): boolean;
  /** Slave -> master. */
  read(count: number): Uint8Array;
}

/** A sensor the firmware reads through a dedicated HAL call (DHT22, HC-SR04 echo). */
export interface SensorModel {
  /** Latest readings, or null if the sensor is unpowered / not responding. */
  read(): Record<string, number> | null;
}
