#pragma once
#include "Arduino.h"
#include "WiFiClient.h"

#define HTTP_CODE_OK 200
#define HTTP_CODE_CREATED 201
#define HTTP_CODE_NO_CONTENT 204
#define HTTP_CODE_MOVED_PERMANENTLY 301
#define HTTP_CODE_BAD_REQUEST 400
#define HTTP_CODE_UNAUTHORIZED 401
#define HTTP_CODE_NOT_FOUND 404
#define HTTP_CODE_INTERNAL_SERVER_ERROR 500
#define HTTPC_ERROR_CONNECTION_REFUSED (-1)
#define HTTPC_ERROR_READ_TIMEOUT (-11)

// HTTPClient from the ESP32 core. Requests go through the simulator, which only allows the
// hosts listed in Settings (browsers cannot call arbitrary servers, and CORS must permit it).
class HTTPClient {
 public:
  bool begin(const String &url) { url_ = url; headers_ = ""; body_ = ""; return true; }
  bool begin(WiFiClient &, const String &url) { return begin(url); }
  bool begin(const char *url) { return begin(String(url)); }
  void end() { body_ = ""; }
  void addHeader(const String &name, const String &value) { headers_ += name + ": " + value + "\n"; }
  void setTimeout(uint16_t) {}
  void setReuse(bool) {}
  void setConnectTimeout(int32_t) {}

  int GET() { return send("GET", nullptr, 0); }
  int POST(const String &payload) { return send("POST", (const uint8_t *)payload.c_str(), payload.length()); }
  int POST(uint8_t *payload, size_t size) { return send("POST", payload, size); }
  int PUT(const String &payload) { return send("PUT", (const uint8_t *)payload.c_str(), payload.length()); }

  String getString() { return body_; }
  int getSize() { return (int)body_.length(); }
  static String errorToString(int error) {
    switch (error) {
      case HTTPC_ERROR_CONNECTION_REFUSED: return String("connection refused");
      case HTTPC_ERROR_READ_TIMEOUT: return String("read Timeout");
      default: return String("error ") + error;
    }
  }

 private:
  int send(const char *method, const uint8_t *body, size_t len) {
    const size_t cap = 16 * 1024;
    char *out = (char *)malloc(cap);
    if (!out) return -1;
    int status = simHttp(method, url_.c_str(), headers_.c_str(), body, len, out, cap);
    body_ = status > 0 ? String(out) : String("");
    free(out);
    return status > 0 ? status : HTTPC_ERROR_CONNECTION_REFUSED;
  }
  String url_, headers_, body_;
};
