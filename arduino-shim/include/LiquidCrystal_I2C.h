#pragma once
#include "Arduino.h"
#include "Wire.h"

// API of the common "LiquidCrystal_I2C" library (HD44780 behind a PCF8574 backpack).
class LiquidCrystal_I2C : public Print {
 public:
  LiquidCrystal_I2C(uint8_t addr, uint8_t cols, uint8_t rows) : addr_(addr), cols_(cols), rows_(rows) {}
  void init() { begin(cols_, rows_); }
  void begin(uint8_t cols, uint8_t rows, uint8_t charsize = 0);
  void clear();
  void home();
  void setCursor(uint8_t col, uint8_t row);
  void display() { control_ |= 0x04; command(0x08 | control_); }
  void noDisplay() { control_ &= ~0x04; command(0x08 | control_); }
  void cursor() { control_ |= 0x02; command(0x08 | control_); }
  void noCursor() { control_ &= ~0x02; command(0x08 | control_); }
  void blink() { control_ |= 0x01; command(0x08 | control_); }
  void noBlink() { control_ &= ~0x01; command(0x08 | control_); }
  void backlight() { backlight_ = 0x08; expanderWrite(0); }
  void noBacklight() { backlight_ = 0x00; expanderWrite(0); }
  void createChar(uint8_t location, uint8_t charmap[]);
  size_t write(uint8_t value) override;
  using Print::write;
  void command(uint8_t value) { send(value, 0); }

 private:
  void send(uint8_t value, uint8_t mode);
  void write4bits(uint8_t value);
  void expanderWrite(uint8_t data);
  void pulseEnable(uint8_t data);
  uint8_t addr_, cols_, rows_;
  uint8_t backlight_ = 0x08;
  uint8_t control_ = 0x04;
  uint8_t mode_ = 0x02;
};
