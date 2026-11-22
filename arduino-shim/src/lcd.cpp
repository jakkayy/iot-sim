#include "LiquidCrystal_I2C.h"

#define LCD_CLEARDISPLAY 0x01
#define LCD_RETURNHOME 0x02
#define LCD_ENTRYMODESET 0x04
#define LCD_DISPLAYCONTROL 0x08
#define LCD_FUNCTIONSET 0x20
#define LCD_SETCGRAMADDR 0x40
#define LCD_SETDDRAMADDR 0x80
#define En 0x04
#define Rs 0x01

void LiquidCrystal_I2C::begin(uint8_t cols, uint8_t rows, uint8_t) {
  cols_ = cols;
  rows_ = rows;
  Wire.begin();
  uint8_t fn = 0x00 /*4-bit*/ | (rows_ > 1 ? 0x08 : 0x00) | 0x00 /*5x8*/;
  delay(50);
  expanderWrite(backlight_);
  delay(100);
  write4bits(0x03 << 4);
  delayMicroseconds(4500);
  write4bits(0x03 << 4);
  delayMicroseconds(4500);
  write4bits(0x03 << 4);
  delayMicroseconds(150);
  write4bits(0x02 << 4);
  command(LCD_FUNCTIONSET | fn);
  control_ = 0x04;  // display on, cursor off, blink off
  command(LCD_DISPLAYCONTROL | control_);
  clear();
  mode_ = 0x02;  // left to right
  command(LCD_ENTRYMODESET | mode_);
  home();
}

void LiquidCrystal_I2C::clear() {
  command(LCD_CLEARDISPLAY);
  delayMicroseconds(2000);
}
void LiquidCrystal_I2C::home() {
  command(LCD_RETURNHOME);
  delayMicroseconds(2000);
}
void LiquidCrystal_I2C::setCursor(uint8_t col, uint8_t row) {
  static const uint8_t offsets[] = {0x00, 0x40, 0x14, 0x54};
  if (row >= rows_) row = rows_ - 1;
  command(LCD_SETDDRAMADDR | (col + offsets[row]));
}
void LiquidCrystal_I2C::createChar(uint8_t location, uint8_t charmap[]) {
  location &= 0x7;
  command(LCD_SETCGRAMADDR | (location << 3));
  for (int i = 0; i < 8; i++) write(charmap[i]);
}
size_t LiquidCrystal_I2C::write(uint8_t value) {
  send(value, Rs);
  return 1;
}
void LiquidCrystal_I2C::send(uint8_t value, uint8_t mode) {
  uint8_t high = value & 0xf0;
  uint8_t low = (uint8_t)((value << 4) & 0xf0);
  write4bits(high | mode);
  write4bits(low | mode);
}
void LiquidCrystal_I2C::write4bits(uint8_t value) {
  expanderWrite(value);
  pulseEnable(value);
}
void LiquidCrystal_I2C::expanderWrite(uint8_t data) {
  Wire.beginTransmission(addr_);
  Wire.write((uint8_t)(data | backlight_));
  Wire.endTransmission();
}
void LiquidCrystal_I2C::pulseEnable(uint8_t data) {
  expanderWrite(data | En);
  delayMicroseconds(1);
  expanderWrite(data & ~En);
  delayMicroseconds(50);
}
