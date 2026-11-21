#include <Arduino.h>

// The runtime drives the sketch instead of a blocking main(): it calls
// sim_setup() once and then sim_loop() repeatedly. This keeps room to poll
// interrupts and stop requests between iterations (see plan, Phase 2 HAL).
extern "C" {
__attribute__((export_name("sim_setup"))) void sim_setup(void) { setup(); }
__attribute__((export_name("sim_loop"))) void sim_loop(void) { loop(); }
}
