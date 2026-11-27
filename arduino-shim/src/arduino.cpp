#include "Arduino.h"

// ---- Serial -------------------------------------------------------------
HardwareSerial Serial;
size_t HardwareSerial::write(uint8_t c) {
  simSerialWrite((const char *)&c, 1);
  return 1;
}
size_t HardwareSerial::write(const uint8_t *buf, size_t size) {
  simSerialWrite((const char *)buf, size);
  return size;
}

// ---- time ----------------------------------------------------------------
void delay(uint32_t ms) { simDelay(ms); }

// ---- interrupts / pulses ---------------------------------------------------
void attachInterrupt(uint8_t pin, void (*fn)(void), int mode) { simAttachInterrupt(pin, fn, mode); }
void detachInterrupt(uint8_t pin) { simDetachInterrupt(pin); }
uint32_t pulseIn(uint8_t pin, uint8_t state, uint32_t timeout) { return simPulseIn(pin, state, timeout); }

// ---- math helpers ------------------------------------------------------------
long map(long x, long in_min, long in_max, long out_min, long out_max) {
  const long run = in_max - in_min;
  if (run == 0) return 0;
  return (x - in_min) * (out_max - out_min) / run + out_min;
}
void randomSeed(unsigned long seed) { srand((unsigned int)seed); }
long random(long max) { return max <= 0 ? 0 : (long)rand() % max; }
long random(long min, long max) { return min >= max ? min : min + random(max - min); }

// ---- tone / PWM ----------------------------------------------------------------
void tone(uint8_t pin, unsigned int frequency, unsigned long duration) { simTone(pin, frequency, (uint32_t)duration); }
void noTone(uint8_t pin) { simPwmStop(pin); }

static uint8_t analogBits = 12;
void analogReadResolution(uint8_t bits) { analogBits = bits; }
void analogWrite(uint8_t pin, int value) {
  if (value < 0) value = 0;
  if (value > 255) value = 255;
  simPwmWrite(pin, 1000, (uint32_t)value * 257u);
}

struct LedcChannel {
  bool used;
  uint8_t pin;
  double freq;
  uint8_t bits;
};
static LedcChannel channels[16];
static LedcChannel pinCfg[40];

static void ledcApply(const LedcChannel &c, uint8_t pin, uint32_t duty) {
  uint32_t maxDuty = (c.bits >= 32) ? 0xffffffffu : ((1u << c.bits) - 1u);
  uint32_t duty16 = maxDuty ? (uint32_t)((uint64_t)duty * 65535u / maxDuty) : 0;
  simPwmWrite(pin, (uint32_t)c.freq, duty16 > 65535u ? 65535u : duty16);
}

double ledcSetup(uint8_t channel, double freq, uint8_t bits) {
  if (channel < 16) channels[channel] = {true, 255, freq, bits};
  return freq;
}
void ledcAttachPin(uint8_t pin, uint8_t channel) {
  if (channel < 16 && channels[channel].used) {
    channels[channel].pin = pin;
    ledcApply(channels[channel], pin, 0);
  }
}
bool ledcAttach(uint8_t pin, double freq, uint8_t bits) {
  if (pin >= 40) return false;
  pinCfg[pin] = {true, pin, freq, bits};
  ledcApply(pinCfg[pin], pin, 0);
  return true;
}
void ledcWrite(uint8_t id, uint32_t duty) {
  if (id < 16 && channels[id].used && channels[id].pin != 255) ledcApply(channels[id], channels[id].pin, duty);
  else if (id < 40 && pinCfg[id].used) ledcApply(pinCfg[id], id, duty);
}
void ledcDetachPin(uint8_t pin) { simPwmStop(pin); }

// ---- shift ------------------------------------------------------------------------
void shiftOut(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder, uint8_t val) {
  for (uint8_t i = 0; i < 8; i++) {
    digitalWrite(dataPin, bitOrder == LSBFIRST ? !!(val & (1 << i)) : !!(val & (1 << (7 - i))));
    digitalWrite(clockPin, HIGH);
    digitalWrite(clockPin, LOW);
  }
}
uint8_t shiftIn(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder) {
  uint8_t value = 0;
  for (uint8_t i = 0; i < 8; ++i) {
    digitalWrite(clockPin, HIGH);
    if (bitOrder == LSBFIRST) value |= digitalRead(dataPin) << i;
    else value |= digitalRead(dataPin) << (7 - i);
    digitalWrite(clockPin, LOW);
  }
  return value;
}
