#include "Arduino.h"

extern "C" void __wasm_call_ctors(void);

// The runtime drives the sketch instead of a blocking main(): it calls
// sim_setup() once and then sim_loop() repeatedly, which keeps room to poll
// interrupts and stop requests between iterations.
extern "C" {
__attribute__((export_name("sim_setup"))) void sim_setup(void) {
  __wasm_call_ctors();  // global constructors (Serial, display objects, ...)
  setup();
}
__attribute__((export_name("sim_loop"))) void sim_loop(void) { loop(); }
}
