#pragma once
#include "Arduino.h"
#include "IPAddress.h"

typedef enum {
  WL_NO_SHIELD = 255,
  WL_IDLE_STATUS = 0,
  WL_NO_SSID_AVAIL = 1,
  WL_SCAN_COMPLETED = 2,
  WL_CONNECTED = 3,
  WL_CONNECT_FAILED = 4,
  WL_CONNECTION_LOST = 5,
  WL_DISCONNECTED = 6
} wl_status_t;

typedef enum { WIFI_OFF = 0, WIFI_STA = 1, WIFI_AP = 2, WIFI_AP_STA = 3 } wifi_mode_t;

// Simulated Wi-Fi: association takes a moment and succeeds unless the user switched on
// "simulate Wi-Fi failure" in the simulator settings.
class WiFiClass {
 public:
  bool mode(wifi_mode_t) { return true; }
  wl_status_t begin(const char *ssid, const char *password = nullptr) {
    (void)password;
    simWifiBegin(ssid ? ssid : "");
    return status();
  }
  wl_status_t status() {
    switch (simWifiStatus()) {
      case 2: return WL_CONNECTED;
      case 3: return WL_CONNECT_FAILED;
      default: return WL_DISCONNECTED;
    }
  }
  bool isConnected() { return status() == WL_CONNECTED; }
  bool disconnect(bool wifioff = false, bool eraseap = false) {
    (void)wifioff; (void)eraseap;
    simWifiDisconnect();
    return true;
  }
  void setAutoReconnect(bool) {}
  void setSleep(bool) {}
  IPAddress localIP() {
    char buf[20];
    simWifiLocalIp(buf, sizeof(buf));
    int p[4] = {0, 0, 0, 0}, n = 0;
    for (const char *c = buf; *c && n < 4; c++) {
      if (*c == '.') n++;
      else p[n] = p[n] * 10 + (*c - '0');
    }
    return IPAddress(p[0], p[1], p[2], p[3]);
  }
  String SSID() const { return String("simulated-wifi"); }
  int32_t RSSI() { return -45; }
  String macAddress() { return String("24:6F:28:00:00:01"); }
};

extern WiFiClass WiFi;
