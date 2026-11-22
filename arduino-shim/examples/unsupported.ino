extern "C" void thisIsNotInTheShim(void);

void setup() {
  thisIsNotInTheShim();
}

void loop() {}
