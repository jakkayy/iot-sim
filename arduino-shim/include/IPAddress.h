#pragma once
#include "Arduino.h"

class IPAddress : public Printable {
 public:
  IPAddress() { a_[0] = a_[1] = a_[2] = a_[3] = 0; }
  IPAddress(uint8_t a, uint8_t b, uint8_t c, uint8_t d) { a_[0] = a; a_[1] = b; a_[2] = c; a_[3] = d; }
  uint8_t operator[](int i) const { return a_[i]; }
  bool operator==(const IPAddress &o) const { return !memcmp(a_, o.a_, 4); }
  String toString() const {
    String s;
    for (int i = 0; i < 4; i++) {
      if (i) s += '.';
      s += (int)a_[i];
    }
    return s;
  }
  size_t printTo(Print &p) const override { return p.print(toString()); }

 private:
  uint8_t a_[4];
};
