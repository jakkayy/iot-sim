#include <WiFi.h>
#include <HTTPClient.h>

void setup() {
  Serial.begin(115200);
  WiFi.begin("home", "secret");
  while (WiFi.status() != WL_CONNECTED) delay(200);
  HTTPClient http;
  http.begin("https://api.example/data");
  http.addHeader("Content-Type", "application/json");
  int code = http.POST("{\"t\":25}");
  Serial.println(code);
  Serial.println(http.getString());
  http.end();
}

void loop() {
  delay(1000);
}
