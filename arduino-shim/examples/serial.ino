void setup() {
  Serial.begin(115200);
  String s = "Hello";
  s += ", ";
  s += "world";
  s.toUpperCase();
  Serial.println(s);
  Serial.println(String(42) + " " + String(3.14159, 3));
  Serial.printf("%d %5.1f %s %04x %c\n", -7, 2.56, "str", 255, 'Z');
  Serial.println(10.0 / 4);
  Serial.println(1234567890L);
  Serial.println(255, HEX);
  Serial.print("a");
  Serial.print('b');
  Serial.println();
  Serial.println(sqrt(2.0), 4);
  Serial.println(sin(PI / 2), 2);
  Serial.println(map(50, 0, 100, 0, 1023));
  Serial.println(String("a,b,c").indexOf(','));
}

void loop() {
  delay(1000);
}
