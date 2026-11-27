#pragma once
#include "Arduino.h"

#define DHT11 11
#define DHT12 12
#define DHT21 21
#define DHT22 22
#define AM2301 21

// Adafruit DHT sensor library API. Readings come from the simulated sensor; NaN when it is
// unpowered or not wired, like a real read failure.
class DHT {
 public:
  DHT(uint8_t pin, uint8_t type, uint8_t count = 6) : pin_(pin), type_(type) { (void)count; }
  void begin(uint8_t usec = 55) { (void)usec; }
  float readTemperature(bool isFahrenheit = false, bool force = false) {
    (void)force;
    float t = (float)simSensorRead(type_ == DHT11 ? 11 : 22, pin_, 0);
    return isFahrenheit ? convertCtoF(t) : t;
  }
  float readHumidity(bool force = false) {
    (void)force;
    return (float)simSensorRead(type_ == DHT11 ? 11 : 22, pin_, 1);
  }
  bool read(bool force = false) {
    (void)force;
    return !isnan(readTemperature());
  }
  float convertCtoF(float c) { return c * 1.8f + 32; }
  float convertFtoC(float f) { return (f - 32) * 0.55555f; }
  float computeHeatIndex(float temperature, float percentHumidity, bool isFahrenheit = true) {
    float hi;
    if (!isFahrenheit) temperature = convertCtoF(temperature);
    hi = 0.5f * (temperature + 61.0f + ((temperature - 68.0f) * 1.2f) + (percentHumidity * 0.094f));
    if (hi > 79) {
      hi = -42.379f + 2.04901523f * temperature + 10.14333127f * percentHumidity +
           -0.22475541f * temperature * percentHumidity + -0.00683783f * temperature * temperature +
           -0.05481717f * percentHumidity * percentHumidity +
           0.00122874f * temperature * temperature * percentHumidity +
           0.00085282f * temperature * percentHumidity * percentHumidity +
           -0.00000199f * temperature * temperature * percentHumidity * percentHumidity;
    }
    return isFahrenheit ? hi : convertFtoC(hi);
  }

 private:
  uint8_t pin_, type_;
};
