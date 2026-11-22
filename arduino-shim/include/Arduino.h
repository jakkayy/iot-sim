// Arduino core shim for the browser simulator.
// Hardware calls are WebAssembly imports resolved by the JS runtime (HAL).
// Freestanding build: there is no libc/libc++, everything here is provided by the shim.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdarg.h>
#include <stdbool.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <math.h>
#include <ctype.h>

#define SIM_IMPORT(name) __attribute__((import_module("env"), import_name(#name)))

// Values match the ESP32 Arduino core so sketches behave like they do on a real board.
#define LOW 0x0
#define HIGH 0x1
#define INPUT 0x01
#define OUTPUT 0x03
#define PULLUP 0x04
#define INPUT_PULLUP 0x05
#define PULLDOWN 0x08
#define INPUT_PULLDOWN 0x09
#define OPEN_DRAIN 0x10
#define OUTPUT_OPEN_DRAIN 0x12
#define RISING 0x01
#define FALLING 0x02
#define CHANGE 0x03
#define LSBFIRST 0
#define MSBFIRST 1
#define DEC 10
#define HEX 16
#define OCT 8
#define BIN 2

#define LED_BUILTIN 2
#define BUILTIN_LED LED_BUILTIN
static const uint8_t SDA = 21, SCL = 22;
static const uint8_t SS = 5, MOSI = 23, MISO = 19, SCK = 18;
static const uint8_t A0 = 36, A3 = 39, A4 = 32, A5 = 33, A6 = 34, A7 = 35;
static const uint8_t A10 = 4, A11 = 0, A12 = 2, A13 = 15, A14 = 13, A15 = 12;
static const uint8_t A16 = 14, A17 = 27, A18 = 25, A19 = 26;
static const uint8_t T0 = 4, T2 = 2, T3 = 15, T4 = 13, T5 = 12, T6 = 14, T7 = 27, T8 = 33, T9 = 32;
static const uint8_t DAC1 = 25, DAC2 = 26;

#define PI 3.1415926535897932384626433832795
#define HALF_PI 1.5707963267948966192313216916398
#define TWO_PI 6.283185307179586476925286766559
#define DEG_TO_RAD 0.017453292519943295769236907684886
#define RAD_TO_DEG 57.295779513082320876798154814105

typedef bool boolean;
typedef uint8_t byte;
typedef unsigned int word;

#define F(x) (x)
#define PROGMEM
#define PSTR(x) (x)
#define pgm_read_byte(addr) (*(const uint8_t *)(addr))
#define pgm_read_word(addr) (*(const uint16_t *)(addr))
#define pgm_read_ptr(addr) (*(void *const *)(addr))

#define min(a, b) ((a) < (b) ? (a) : (b))
#define max(a, b) ((a) > (b) ? (a) : (b))
#define constrain(amt, low, high) ((amt) < (low) ? (low) : ((amt) > (high) ? (high) : (amt)))
#define radians(deg) ((deg) * DEG_TO_RAD)
#define degrees(rad) ((rad) * RAD_TO_DEG)
#define sq(x) ((x) * (x))
#define bit(b) (1UL << (b))
#define bitRead(value, bit) (((value) >> (bit)) & 0x01)
#define bitSet(value, bit) ((value) |= (1UL << (bit)))
#define bitClear(value, bit) ((value) &= ~(1UL << (bit)))
#define bitWrite(value, bit, bitvalue) ((bitvalue) ? bitSet(value, bit) : bitClear(value, bit))
#define lowByte(w) ((uint8_t)((w) & 0xff))
#define highByte(w) ((uint8_t)((w) >> 8))
#define clockCyclesPerMicrosecond() 240L
#define digitalPinToInterrupt(p) (p)

#ifdef __cplusplus
extern "C" {
#endif

SIM_IMPORT(pinMode) void pinMode(uint8_t pin, uint8_t mode);
SIM_IMPORT(digitalWrite) void digitalWrite(uint8_t pin, uint8_t val);
SIM_IMPORT(digitalRead) int digitalRead(uint8_t pin);
SIM_IMPORT(analogRead) int analogRead(uint8_t pin);
SIM_IMPORT(delayMicroseconds) void delayMicroseconds(uint32_t us);
SIM_IMPORT(millis) uint32_t millis(void);
SIM_IMPORT(micros) uint32_t micros(void);

// Simulator-specific imports (not part of the Arduino API).
SIM_IMPORT(simDelay) void simDelay(uint32_t ms);
SIM_IMPORT(simSerialWrite) void simSerialWrite(const char *data, size_t len);
SIM_IMPORT(simPwmWrite) void simPwmWrite(uint8_t pin, uint32_t freq, uint32_t duty16);
SIM_IMPORT(simPwmStop) void simPwmStop(uint8_t pin);
SIM_IMPORT(simTone) void simTone(uint8_t pin, uint32_t freq, uint32_t durationMs);
SIM_IMPORT(simPulseIn) uint32_t simPulseIn(uint8_t pin, uint8_t state, uint32_t timeoutUs);
SIM_IMPORT(simAttachInterrupt) void simAttachInterrupt(uint8_t pin, void (*fn)(void), int mode);
SIM_IMPORT(simDetachInterrupt) void simDetachInterrupt(uint8_t pin);
SIM_IMPORT(simI2cBegin) void simI2cBegin(uint8_t sda, uint8_t scl);
SIM_IMPORT(simI2cWrite) int simI2cWrite(uint8_t addr, const uint8_t *data, size_t len);
SIM_IMPORT(simI2cRead) int simI2cRead(uint8_t addr, uint8_t *data, size_t len);
SIM_IMPORT(simSensorRead) double simSensorRead(uint8_t kind, uint8_t pin, uint8_t which);
SIM_IMPORT(simMath) double simMath(uint8_t fn, double a, double b);

#ifdef __cplusplus
}
#endif

#ifdef __cplusplus
#include "WString.h"
#include "Print.h"
#include "HardwareSerial.h"

void delay(uint32_t ms);
inline void yield(void) {}
void attachInterrupt(uint8_t pin, void (*fn)(void), int mode);
void detachInterrupt(uint8_t pin);
uint32_t pulseIn(uint8_t pin, uint8_t state, uint32_t timeout = 1000000UL);
long map(long x, long in_min, long in_max, long out_min, long out_max);
void randomSeed(unsigned long seed);
long random(long max);
long random(long min, long max);
void tone(uint8_t pin, unsigned int frequency, unsigned long duration = 0);
void noTone(uint8_t pin);
void analogWrite(uint8_t pin, int value);
void analogReadResolution(uint8_t bits);

// LEDC (ESP32 PWM). Supports both the 2.x (channel) and 3.x (pin) styles.
double ledcSetup(uint8_t channel, double freq, uint8_t resolutionBits);
void ledcAttachPin(uint8_t pin, uint8_t channel);
bool ledcAttach(uint8_t pin, double freq, uint8_t resolutionBits);
void ledcWrite(uint8_t channelOrPin, uint32_t duty);
void ledcDetachPin(uint8_t pin);

void shiftOut(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder, uint8_t val);
uint8_t shiftIn(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder);

inline bool isDigit(int c) { return c >= '0' && c <= '9'; }
inline bool isAlpha(int c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
inline bool isAlphaNumeric(int c) { return isDigit(c) || isAlpha(c); }
inline bool isSpace(int c) { return c == ' ' || (c >= 9 && c <= 13); }
inline bool isUpperCase(int c) { return c >= 'A' && c <= 'Z'; }
inline bool isLowerCase(int c) { return c >= 'a' && c <= 'z'; }
inline bool isPunct(int c) { return c > 32 && c < 127 && !isAlphaNumeric(c); }

// Provided by the sketch.
void setup(void);
void loop(void);
#endif
