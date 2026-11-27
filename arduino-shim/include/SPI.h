#pragma once
#include "Arduino.h"

#define SPI_MODE0 0
#define SPI_MODE1 1
#define SPI_MODE2 2
#define SPI_MODE3 3

class SPISettings {
 public:
  SPISettings(uint32_t clock = 1000000, uint8_t bitOrder = MSBFIRST, uint8_t mode = SPI_MODE0) {
    (void)clock; (void)bitOrder; (void)mode;
  }
};

// No SPI devices are simulated yet: transfers return 0.
class SPIClass {
 public:
  void begin(int8_t sck = -1, int8_t miso = -1, int8_t mosi = -1, int8_t ss = -1) {
    (void)sck; (void)miso; (void)mosi; (void)ss;
  }
  void end() {}
  void beginTransaction(SPISettings) {}
  void endTransaction() {}
  void setFrequency(uint32_t) {}
  void setDataMode(uint8_t) {}
  void setBitOrder(uint8_t) {}
  uint8_t transfer(uint8_t) { return 0; }
  uint16_t transfer16(uint16_t) { return 0; }
  void transfer(void *, size_t) {}
};

extern SPIClass SPI;
