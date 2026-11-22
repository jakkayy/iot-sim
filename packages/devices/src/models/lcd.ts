import type { I2CSlave } from "@esp32-sim/sim-core";

/** frame[0] bits: 0 display on, 1 backlight, 2 cursor, 3 blink; frame[1] cursor index (row*16+col, 255 = none); frame[2..34] chars. */
export const LCD_FLAG_ON = 1;
export const LCD_FLAG_BACKLIGHT = 2;
export const LCD_FLAG_CURSOR = 4;
export const LCD_FLAG_BLINK = 8;
export const LCD_COLS = 16;
export const LCD_ROWS = 2;

/**
 * HD44780 16x2 behind a PCF8574 I2C backpack (address 0x27). Each I2C byte
 * carries a nibble (P7..P4) plus RS (P0), RW (P1), E (P2) and backlight (P3);
 * a nibble is latched on the falling edge of E.
 */
export class Lcd1602 implements I2CSlave {
  readonly addr = 0x27;
  private fourBit = false;
  private highNibble: number | null = null;
  private lastE = 0;
  private ddram = 0;
  private increment = 1;

  constructor(private readonly frame: Uint8Array) {
    this.clear();
    frame[0] = LCD_FLAG_ON | LCD_FLAG_BACKLIGHT;
    this.syncCursor();
  }

  write(bytes: Uint8Array): boolean {
    for (const b of bytes) {
      const e = (b >> 2) & 1;
      this.setFlag(LCD_FLAG_BACKLIGHT, ((b >> 3) & 1) === 1);
      if (this.lastE === 1 && e === 0) this.latch(b >> 4, b & 1);
      this.lastE = e;
    }
    return true;
  }

  read(count: number): Uint8Array {
    return new Uint8Array(count);
  }

  private setFlag(flag: number, on: boolean): void {
    this.frame[0] = on ? this.frame[0] | flag : this.frame[0] & ~flag;
  }

  private latch(nibble: number, rs: number): void {
    if (!this.fourBit) {
      // Reset sequence: 0x3 three times in 8-bit mode, then 0x2 switches to 4-bit.
      if (nibble === 0x2) this.fourBit = true;
      return;
    }
    if (this.highNibble === null) {
      this.highNibble = nibble;
      return;
    }
    const byte = (this.highNibble << 4) | nibble;
    this.highNibble = null;
    if (rs) this.putChar(byte);
    else this.command(byte);
  }

  private clear(): void {
    this.frame.fill(0x20, 2, 2 + LCD_COLS * LCD_ROWS);
    this.ddram = 0;
  }

  /** DDRAM address -> index into the 2x16 char array, or -1 if outside the visible area. */
  private index(addr: number): number {
    if (addr < LCD_COLS) return addr;
    if (addr >= 0x40 && addr < 0x40 + LCD_COLS) return LCD_COLS + (addr - 0x40);
    return -1;
  }

  private syncCursor(): void {
    const i = this.index(this.ddram);
    this.frame[1] = i < 0 ? 255 : i;
  }

  private putChar(c: number): void {
    const i = this.index(this.ddram);
    if (i >= 0) this.frame[2 + i] = c;
    this.advance(this.increment);
  }

  /** Move the DDRAM address, wrapping inside each 40-byte line like the real controller. */
  private advance(step: number): void {
    const line = this.ddram >= 0x40 ? 0x40 : 0;
    this.ddram = line + (((this.ddram - line + step) % 40) + 40) % 40;
    this.syncCursor();
  }

  private command(b: number): void {
    if (b === 0x01) {
      this.clear();
      this.increment = 1;
    } else if (b === 0x02) this.ddram = 0;
    else if (b >= 0x04 && b <= 0x07) this.increment = b & 2 ? 1 : -1;
    else if (b >= 0x08 && b <= 0x0f) {
      this.setFlag(LCD_FLAG_ON, (b & 4) !== 0);
      this.setFlag(LCD_FLAG_CURSOR, (b & 2) !== 0);
      this.setFlag(LCD_FLAG_BLINK, (b & 1) !== 0);
    } else if (b >= 0x10 && b <= 0x1f && (b & 8) === 0) this.advance(b & 4 ? 1 : -1);
    else if (b >= 0x80) this.ddram = b & 0x7f;
    this.syncCursor();
  }
}

/** Text of one row (for tests and accessibility). */
export function lcdRow(frame: Uint8Array, row: number): string {
  return String.fromCharCode(...frame.subarray(2 + row * LCD_COLS, 2 + (row + 1) * LCD_COLS));
}
