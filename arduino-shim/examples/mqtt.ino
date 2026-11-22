#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>

WiFiClient net;
PubSubClient mqtt(net);
DHT dht(4, DHT22);
const int RELAY = 5;

void onMessage(char *topic, uint8_t *payload, unsigned int length) {
  Serial.printf("got %s: %s\n", topic, (const char *)payload);
  digitalWrite(RELAY, payload[0] == '1' ? HIGH : LOW);
}

void setup() {
  Serial.begin(115200);
  pinMode(RELAY, OUTPUT);
  dht.begin();
  WiFi.begin("home", "secret");
  while (WiFi.status() != WL_CONNECTED) delay(200);
  Serial.println(WiFi.localIP());
  mqtt.setServer("broker.example", 1883);
  mqtt.setCallback(onMessage);
  while (!mqtt.connect("esp32-sim")) delay(500);
  mqtt.subscribe("sim/demo/relay");
}

void loop() {
  mqtt.loop();
  static unsigned long last = 0;
  if (millis() - last > 2000) {
    last = millis();
    char msg[32];
    snprintf(msg, sizeof(msg), "%.1f", dht.readTemperature());
    mqtt.publish("sim/demo/temp", msg);
  }
  delay(20);
}
