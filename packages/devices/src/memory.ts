import { devices } from "./registry";
import { defaultValues } from "./types";

/**
 * Memory shared by the UI thread and the runtime Worker.
 *  - Float64 section: control values (slider positions, toggles) written by the UI,
 *    plus a `powered` flag per device written by the UI after evaluating nets.
 *  - Byte section: frame data of display devices, written by the Worker's models
 *    and drawn by the UI.
 * Both threads build the layout from the same component list, so no offsets are sent.
 */
export interface DeviceRef {
  id: string;
  type: string;
}

/** Bytes per display frame: [flags, aux, ...content]. See the models for the meaning. */
export const FRAME_SIZE: Record<string, number> = {
  ssd1306: 2 + 128 * 8,
  "lcd-i2c": 2 + 2 * 16,
};

export interface MemoryLayout {
  /** `${id}.${key}` -> index in the Float64 section. */
  floatIndex: Record<string, number>;
  frames: Record<string, { offset: number; size: number }>;
  byteLength: number;
}

export function computeLayout(devs: DeviceRef[]): MemoryLayout {
  const floatIndex: Record<string, number> = {};
  let floats = 0;
  for (const d of devs) {
    floatIndex[`${d.id}.powered`] = floats++;
    for (const key of Object.keys(defaultValues(devices[d.type]?.controls))) {
      floatIndex[`${d.id}.${key}`] = floats++;
    }
  }
  let offset = floats * 8;
  const frames: MemoryLayout["frames"] = {};
  for (const d of devs) {
    const size = FRAME_SIZE[d.type];
    if (size) {
      frames[d.id] = { offset, size };
      offset += size;
    }
  }
  return { floatIndex, frames, byteLength: Math.ceil(offset / 8) * 8 };
}

export class DeviceMemory {
  private readonly floats: Float64Array;

  constructor(
    readonly buffer: SharedArrayBuffer,
    readonly layout: MemoryLayout,
  ) {
    this.floats = new Float64Array(buffer, 0, Object.keys(layout.floatIndex).length);
  }

  static create(devs: DeviceRef[]): DeviceMemory {
    const layout = computeLayout(devs);
    const mem = new DeviceMemory(new SharedArrayBuffer(Math.max(8, layout.byteLength)), layout);
    for (const d of devs) {
      for (const [k, v] of Object.entries(defaultValues(devices[d.type]?.controls))) mem.set(d.id, k, v);
    }
    return mem;
  }

  get(id: string, key: string): number {
    const i = this.layout.floatIndex[`${id}.${key}`];
    return i === undefined ? 0 : this.floats[i];
  }

  set(id: string, key: string, value: number): void {
    const i = this.layout.floatIndex[`${id}.${key}`];
    if (i !== undefined) this.floats[i] = value;
  }

  /** Frame bytes of a display device (shared view), or null. */
  frame(id: string): Uint8Array | null {
    const f = this.layout.frames[id];
    return f ? new Uint8Array(this.buffer, f.offset, f.size) : null;
  }
}
