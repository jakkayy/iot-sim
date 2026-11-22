#pragma once
#include "Arduino.h"
#include "WiFiClient.h"

#define MQTT_CONNECTED 0
#define MQTT_CONNECTION_TIMEOUT -4
#define MQTT_CONNECTION_LOST -3
#define MQTT_CONNECT_FAILED -2
#define MQTT_DISCONNECTED -1
#define MQTT_CONNECT_BAD_CREDENTIALS 4
#define MQTT_CONNECT_UNAUTHORIZED 5

// API of the common "PubSubClient" library. The socket is the simulator's MQTT bridge
// (MQTT over WebSocket), so the host/port you write are the ones from your real board.
class PubSubClient {
 public:
  typedef void (*Callback)(char *, uint8_t *, unsigned int);

  PubSubClient() {}
  PubSubClient(Client &) {}
  PubSubClient &setServer(const char *host, uint16_t port) { host_ = host; port_ = port; return *this; }
  PubSubClient &setCallback(Callback cb) { cb_ = cb; return *this; }
  PubSubClient &setClient(Client &) { return *this; }
  PubSubClient &setKeepAlive(uint16_t k) { keepalive_ = k; return *this; }
  PubSubClient &setSocketTimeout(uint16_t) { return *this; }
  bool setBufferSize(uint16_t) { return true; }

  bool connect(const char *id) { return connect(id, nullptr, nullptr); }
  bool connect(const char *id, const char *user, const char *pass) {
    int rc = simMqttConnect(host_ ? host_ : "", port_, id, user ? user : "", pass ? pass : "", keepalive_);
    state_ = rc == 0 ? MQTT_CONNECTED : MQTT_CONNECT_UNAUTHORIZED;
    return rc == 0;
  }
  // The last-will arguments are accepted and ignored.
  bool connect(const char *id, const char *willTopic, uint8_t willQos, bool willRetain, const char *willMessage) {
    (void)willTopic; (void)willQos; (void)willRetain; (void)willMessage;
    return connect(id, nullptr, nullptr);
  }
  bool connect(const char *id, const char *user, const char *pass, const char *willTopic, uint8_t willQos, bool willRetain, const char *willMessage) {
    (void)willTopic; (void)willQos; (void)willRetain; (void)willMessage;
    return connect(id, user, pass);
  }
  void disconnect() {
    simMqttDisconnect();
    state_ = MQTT_DISCONNECTED;
  }
  bool connected() {
    bool up = simMqttConnected() != 0;
    if (!up && state_ == MQTT_CONNECTED) state_ = MQTT_CONNECTION_LOST;
    return up;
  }
  int state() { return state_; }

  bool publish(const char *topic, const char *payload, bool retained = false) {
    return publish(topic, (const uint8_t *)payload, payload ? (unsigned int)strlen(payload) : 0, retained);
  }
  bool publish(const char *topic, const uint8_t *payload, unsigned int length, bool retained = false) {
    return simMqttPublish(topic, payload, length, retained, 0) != 0;
  }
  bool subscribe(const char *topic, uint8_t qos = 0) { return simMqttSubscribe(topic, qos) != 0; }
  bool unsubscribe(const char *) { return true; }

  /** Deliver pending messages to the callback. Returns whether the broker link is up. */
  bool loop() {
    char topic[160];
    uint8_t payload[1024 + 1];
    int n;
    while ((n = simMqttPoll(topic, sizeof(topic), payload, sizeof(payload) - 1)) >= 0) {
      payload[n] = 0;
      if (cb_) cb_(topic, payload, (unsigned int)n);
    }
    return connected();
  }

 private:
  const char *host_ = nullptr;
  uint16_t port_ = 1883;
  uint16_t keepalive_ = 15;
  Callback cb_ = nullptr;
  int state_ = MQTT_DISCONNECTED;
};
