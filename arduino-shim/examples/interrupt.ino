volatile int presses = 0;

void IRAM_ATTR onPress() {
  presses++;
}

void setup() {
  Serial.begin(115200);
  pinMode(4, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(4), onPress, FALLING);
}

void loop() {
  Serial.print("presses=");
  Serial.println(presses);
  delay(100);
}
