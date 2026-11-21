// Minimal Arduino core shim for the browser simulator (spike).
// Every hardware call is a WebAssembly import resolved by the JS runtime (HAL).
#pragma once
#include <stdint.h>
#include <stddef.h>

#define SIM_IMPORT(name) __attribute__((import_module("env"), import_name(#name)))

// Values match the ESP32 Arduino core so sketches behave the same on real boards.
#define LOW 0x0
#define HIGH 0x1
#define INPUT 0x01
#define OUTPUT 0x03
#define INPUT_PULLUP 0x05
#define LED_BUILTIN 2

#ifdef __cplusplus
extern "C" {
#endif

SIM_IMPORT(pinMode) void pinMode(uint8_t pin, uint8_t mode);
SIM_IMPORT(digitalWrite) void digitalWrite(uint8_t pin, uint8_t val);
SIM_IMPORT(digitalRead) int digitalRead(uint8_t pin);
SIM_IMPORT(delay) void delay(uint32_t ms);
SIM_IMPORT(millis) uint32_t millis(void);

#ifdef __cplusplus
}
#endif

// Provided by the user's sketch.
void setup(void);
void loop(void);
