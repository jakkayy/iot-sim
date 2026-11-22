void setup() {
  Serial.begin(115200);
  ledcSetup(0, 5000, 8);
  ledcAttachPin(2, 0);
}

void loop() {
  int v = analogRead(32);
  Serial.println(v);
  ledcWrite(0, map(v, 0, 4095, 0, 255));
  tone(25, 440, 50);
  delay(100);
}
