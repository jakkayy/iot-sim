#pragma once
#include "Print.h"

// Serial is output-only in the simulator (no keyboard input yet).
class HardwareSerial : public Print {
 public:
  void begin(unsigned long baud, uint32_t config = 0, int8_t rxPin = -1, int8_t txPin = -1) {
    (void)baud; (void)config; (void)rxPin; (void)txPin;
  }
  void end() {}
  int available() { return 0; }
  int read() { return -1; }
  int peek() { return -1; }
  void flush() {}
  operator bool() const { return true; }
  size_t write(uint8_t c) override;
  size_t write(const uint8_t *buf, size_t size) override;
  using Print::write;
};

extern HardwareSerial Serial;
