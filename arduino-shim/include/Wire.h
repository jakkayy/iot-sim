#pragma once
#include "Arduino.h"

class TwoWire : public Print {
 public:
  void begin() { simI2cBegin(SDA, SCL); }
  bool begin(int sda, int scl, uint32_t freq = 0) {
    (void)freq;
    simI2cBegin((uint8_t)sda, (uint8_t)scl);
    return true;
  }
  void setClock(uint32_t) {}
  void setTimeOut(uint16_t) {}
  void end() {}

  void beginTransmission(uint8_t address) {
    addr_ = address;
    txLen_ = 0;
  }
  uint8_t endTransmission(bool sendStop = true) {
    (void)sendStop;
    return (uint8_t)simI2cWrite(addr_, tx_, txLen_);
  }
  size_t requestFrom(uint8_t address, size_t quantity, bool sendStop = true) {
    (void)sendStop;
    if (quantity > sizeof(rx_)) quantity = sizeof(rx_);
    rxLen_ = (size_t)simI2cRead(address, rx_, quantity);
    rxPos_ = 0;
    return rxLen_;
  }
  size_t requestFrom(uint8_t address, uint8_t quantity) { return requestFrom(address, (size_t)quantity, true); }
  size_t requestFrom(int address, int quantity) { return requestFrom((uint8_t)address, (size_t)quantity, true); }

  size_t write(uint8_t c) override {
    if (txLen_ >= sizeof(tx_)) return 0;
    tx_[txLen_++] = c;
    return 1;
  }
  size_t write(const uint8_t *buf, size_t size) override {
    size_t n = 0;
    while (size--) n += write(*buf++);
    return n;
  }
  using Print::write;

  int available() { return (int)(rxLen_ - rxPos_); }
  int read() { return rxPos_ < rxLen_ ? rx_[rxPos_++] : -1; }
  int peek() { return rxPos_ < rxLen_ ? rx_[rxPos_] : -1; }
  void flush() {}

 private:
  uint8_t addr_ = 0;
  uint8_t tx_[256];
  size_t txLen_ = 0;
  uint8_t rx_[256];
  size_t rxLen_ = 0, rxPos_ = 0;
};

extern TwoWire Wire;
