import type { I2CSlave } from "@esp32-sim/sim-core";

/** frame[0] bit0 = display on, bit1 = inverted; frame[1] = contrast; frame[2..] = GDDRAM (8 pages x 128). */
export const SSD1306_FLAG_ON = 1;
export const SSD1306_FLAG_INVERT = 2;
export const SSD1306_WIDTH = 128;
export const SSD1306_PAGES = 8;

/** Command argument counts for multi-byte commands (the rest take none). */
const ARGS: Record<number, number> = {
  0x20: 1, 0x21: 2, 0x22: 2, 0x81: 1, 0x8d: 1, 0xa8: 1, 0xd3: 1, 0xd5: 1, 0xd9: 1, 0xda: 1, 0xdb: 1,
  0x26: 6, 0x27: 6, 0x29: 5, 0x2a: 5, 0xa3: 2,
};

/** SSD1306 128x64 over I2C (address 0x3C): decodes the command stream into GDDRAM. */
export class Ssd1306 implements I2CSlave {
  readonly addr = 0x3c;
  private mode = 2; // power-on default is page addressing
  private colStart = 0;
  private colEnd = 127;
  private pageStart = 0;
  private pageEnd = 7;
  private col = 0;
  private page = 0;
  private pending: { cmd: number; args: number[] } | null = null;

  constructor(private readonly frame: Uint8Array) {
    frame[1] = 0x7f;
  }

  private get gddram(): Uint8Array {
    return this.frame.subarray(2);
  }

  write(bytes: Uint8Array): boolean {
    let i = 0;
    while (i < bytes.length) {
      const control = bytes[i++];
      if (control === 0x00) {
        while (i < bytes.length) this.command(bytes[i++]);
      } else if (control === 0x40) {
        while (i < bytes.length) this.data(bytes[i++]);
      } else if (control === 0x80) {
        if (i < bytes.length) this.command(bytes[i++]);
      } else if (control === 0xc0) {
        if (i < bytes.length) this.data(bytes[i++]);
      } else {
        return false;
      }
    }
    return true;
  }

  read(count: number): Uint8Array {
    return new Uint8Array(count); // status register: never busy
  }

  private command(b: number): void {
    if (this.pending) {
      this.pending.args.push(b);
      if (this.pending.args.length >= (ARGS[this.pending.cmd] ?? 0)) {
        this.applyArgs(this.pending.cmd, this.pending.args);
        this.pending = null;
      }
      return;
    }
    if (ARGS[b]) {
      this.pending = { cmd: b, args: [] };
      return;
    }
    if (b === 0xae) this.frame[0] &= ~SSD1306_FLAG_ON;
    else if (b === 0xaf) this.frame[0] |= SSD1306_FLAG_ON;
    else if (b === 0xa6) this.frame[0] &= ~SSD1306_FLAG_INVERT;
    else if (b === 0xa7) this.frame[0] |= SSD1306_FLAG_INVERT;
    else if (b >= 0xb0 && b <= 0xb7) this.page = b & 7;
    else if (b <= 0x0f) this.col = (this.col & 0xf0) | (b & 0x0f);
    else if (b >= 0x10 && b <= 0x1f) this.col = (this.col & 0x0f) | ((b & 0x0f) << 4);
  }

  private applyArgs(cmd: number, a: number[]): void {
    if (cmd === 0x20) this.mode = a[0] & 3;
    else if (cmd === 0x21) {
      this.colStart = a[0] & 0x7f;
      this.colEnd = a[1] & 0x7f;
      this.col = this.colStart;
    } else if (cmd === 0x22) {
      this.pageStart = a[0] & 7;
      this.pageEnd = a[1] & 7;
      this.page = this.pageStart;
    } else if (cmd === 0x81) this.frame[1] = a[0];
  }

  private data(b: number): void {
    this.gddram[this.page * SSD1306_WIDTH + this.col] = b;
    if (this.mode === 2) {
      this.col = (this.col + 1) & 0x7f; // page mode: wraps within the page
    } else if (this.mode === 0) {
      if (++this.col > this.colEnd) {
        this.col = this.colStart;
        if (++this.page > this.pageEnd) this.page = this.pageStart;
      }
    } else {
      if (++this.page > this.pageEnd) {
        this.page = this.pageStart;
        if (++this.col > this.colEnd) this.col = this.colStart;
      }
    }
  }
}

/** Read one pixel from a frame (used by the UI and tests). */
export function ssd1306Pixel(frame: Uint8Array, x: number, y: number): boolean {
  const byte = frame[2 + (y >> 3) * SSD1306_WIDTH + x];
  const on = (byte >> (y & 7)) & 1;
  return ((frame[0] & SSD1306_FLAG_INVERT) !== 0) !== (on === 1);
}
