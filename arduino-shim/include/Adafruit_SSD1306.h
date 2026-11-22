#pragma once
#include "Adafruit_GFX.h"
#include "Wire.h"

#define SSD1306_BLACK 0
#define SSD1306_WHITE 1
#define SSD1306_INVERSE 2
#define SSD1306_EXTERNALVCC 0x01
#define SSD1306_SWITCHCAPVCC 0x02
#define BLACK SSD1306_BLACK
#define WHITE SSD1306_WHITE
#define INVERSE SSD1306_INVERSE

class Adafruit_SSD1306 : public Adafruit_GFX {
 public:
  Adafruit_SSD1306(uint8_t w, uint8_t h, TwoWire *twi = &Wire, int8_t rst_pin = -1, uint32_t clkDuring = 400000UL,
                   uint32_t clkAfter = 100000UL);
  ~Adafruit_SSD1306();
  bool begin(uint8_t switchvcc = SSD1306_SWITCHCAPVCC, uint8_t i2caddr = 0, bool reset = true, bool periphBegin = true);
  void display();
  void clearDisplay();
  void invertDisplay(bool i);
  void dim(bool dim);
  void drawPixel(int16_t x, int16_t y, uint16_t color) override;
  bool getPixel(int16_t x, int16_t y);
  uint8_t *getBuffer() { return buffer; }
  void ssd1306_command(uint8_t c);

 private:
  void command(uint8_t c);
  TwoWire *wire;
  uint8_t *buffer;
  uint8_t i2caddr, vccstate, contrast;
};
