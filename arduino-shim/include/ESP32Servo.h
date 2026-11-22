#pragma once
#include "Arduino.h"

class ESP32PWM {
 public:
  static void allocateTimer(int) {}
};

// Servo on a PWM pin: 50 Hz, pulse width 500..2500 us maps to 0..180 degrees.
class Servo {
 public:
  uint8_t attach(int pin, int minUs = 500, int maxUs = 2500) {
    pin_ = (int8_t)pin;
    min_ = minUs;
    max_ = maxUs;
    return (uint8_t)pin;
  }
  void detach() {
    if (pin_ >= 0) simPwmStop((uint8_t)pin_);
    pin_ = -1;
  }
  void setPeriodHertz(int hz) { hz_ = hz > 0 ? hz : 50; }
  void write(int value) {
    if (value < 544) {
      if (value < 0) value = 0;
      if (value > 180) value = 180;
      writeMicroseconds(min_ + (long)(max_ - min_) * value / 180);
    } else {
      writeMicroseconds(value);
    }
  }
  void writeMicroseconds(int us) {
    if (pin_ < 0) return;
    if (us < min_) us = min_;
    if (us > max_) us = max_;
    us_ = us;
    uint32_t period = 1000000UL / (uint32_t)hz_;
    simPwmWrite((uint8_t)pin_, (uint32_t)hz_, (uint32_t)((uint64_t)us * 65535u / period));
  }
  int read() const { return (int)((long)(us_ - min_) * 180 / (max_ - min_)); }
  int readMicroseconds() const { return us_; }
  bool attached() const { return pin_ >= 0; }

 private:
  int8_t pin_ = -1;
  int min_ = 500, max_ = 2500, us_ = 1500, hz_ = 50;
};
