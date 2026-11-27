#pragma once
#include "WiFi.h"

// Transport placeholder: PubSubClient and HTTPClient talk to the simulator's bridge directly.
class Client {
 public:
  virtual ~Client() {}
};

class WiFiClient : public Client {
 public:
  bool connected() { return false; }
  void stop() {}
  void setTimeout(uint32_t) {}
};
