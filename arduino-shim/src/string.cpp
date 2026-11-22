#include "Arduino.h"

bool String::grow(unsigned int cap) {
  if (cap <= cap_) return true;
  unsigned int newCap = cap < 16 ? 16 : cap + (cap >> 1);
  char *nb = (char *)realloc(buf_, newCap + 1);
  if (!nb) return false;
  buf_ = nb;
  cap_ = newCap;
  if (len_ == 0) buf_[0] = 0;
  return true;
}

String::String(const char *s) : buf_(nullptr), len_(0), cap_(0) { concat(s); }
String::String(const String &o) : buf_(nullptr), len_(0), cap_(0) { concat(o.c_str()); }
String::String(char c) : buf_(nullptr), len_(0), cap_(0) { concat(c); }
String::String(int v, unsigned char base) : buf_(nullptr), len_(0), cap_(0) {
  char b[34];
  concat(itoa(v, b, base));
}
String::String(unsigned int v, unsigned char base) : buf_(nullptr), len_(0), cap_(0) {
  char b[34];
  concat(utoa(v, b, base));
}
String::String(long v, unsigned char base) : buf_(nullptr), len_(0), cap_(0) {
  char b[34];
  concat(ltoa(v, b, base));
}
String::String(unsigned long v, unsigned char base) : buf_(nullptr), len_(0), cap_(0) {
  char b[34];
  concat(ultoa(v, b, base));
}
static void appendDouble(String &s, double v, unsigned char decimals) {
  char b[48];
  dtostrf(v, 0, decimals, b);
  s.concat(b);
}
String::String(float v, unsigned char d) : buf_(nullptr), len_(0), cap_(0) { appendDouble(*this, v, d); }
String::String(double v, unsigned char d) : buf_(nullptr), len_(0), cap_(0) { appendDouble(*this, v, d); }
String::~String() { free(buf_); }

String &String::operator=(const String &o) {
  if (this != &o) {
    len_ = 0;
    if (buf_) buf_[0] = 0;
    concat(o.c_str());
  }
  return *this;
}
String &String::operator=(String &&o) noexcept {
  if (this != &o) {
    free(buf_);
    buf_ = o.buf_;
    len_ = o.len_;
    cap_ = o.cap_;
    o.buf_ = nullptr;
    o.len_ = o.cap_ = 0;
  }
  return *this;
}
String &String::operator=(const char *s) {
  len_ = 0;
  if (buf_) buf_[0] = 0;
  concat(s);
  return *this;
}

char &String::operator[](unsigned int i) {
  static char dummy;
  if (i >= len_) {
    dummy = 0;
    return dummy;
  }
  return buf_[i];
}

bool String::concat(const char *s) {
  if (!s) return false;
  unsigned int n = (unsigned int)strlen(s);
  if (!n) return true;
  if (!grow(len_ + n)) return false;
  memcpy(buf_ + len_, s, n + 1);
  len_ += n;
  return true;
}
bool String::concat(char c) {
  char b[2] = {c, 0};
  return concat(b);
}
bool String::concat(int v) { return concat(String(v).c_str()); }
bool String::concat(unsigned int v) { return concat(String(v).c_str()); }
bool String::concat(long v) { return concat(String(v).c_str()); }
bool String::concat(unsigned long v) { return concat(String(v).c_str()); }
bool String::concat(float v) { appendDouble(*this, v, 2); return true; }
bool String::concat(double v) { appendDouble(*this, v, 2); return true; }

int String::compareTo(const String &s) const { return strcmp(c_str(), s.c_str()); }
bool String::equals(const char *s) const { return s && strcmp(c_str(), s) == 0; }
bool String::equalsIgnoreCase(const String &s) const {
  if (len_ != s.len_) return false;
  for (unsigned int i = 0; i < len_; i++)
    if (tolower(buf_[i]) != tolower(s.buf_[i])) return false;
  return true;
}
bool String::startsWith(const String &p) const { return len_ >= p.len_ && strncmp(c_str(), p.c_str(), p.len_) == 0; }
bool String::endsWith(const String &p) const {
  return len_ >= p.len_ && strcmp(c_str() + len_ - p.len_, p.c_str()) == 0;
}

int String::indexOf(char c, unsigned int from) const {
  for (unsigned int i = from; i < len_; i++)
    if (buf_[i] == c) return (int)i;
  return -1;
}
int String::indexOf(const String &s, unsigned int from) const {
  if (from >= len_) return -1;
  const char *p = strstr(c_str() + from, s.c_str());
  return p ? (int)(p - c_str()) : -1;
}
int String::lastIndexOf(char c) const {
  for (int i = (int)len_ - 1; i >= 0; i--)
    if (buf_[i] == c) return i;
  return -1;
}
String String::substring(unsigned int from, unsigned int to) const {
  if (to > len_) to = len_;
  if (from > to) return String();
  String out;
  if (!out.grow(to - from)) return out;
  memcpy(out.buf_, buf_ + from, to - from);
  out.buf_[to - from] = 0;
  out.len_ = to - from;
  return out;
}
void String::replace(char from, char to) {
  for (unsigned int i = 0; i < len_; i++)
    if (buf_[i] == from) buf_[i] = to;
}
void String::replace(const String &from, const String &to) {
  if (!from.len_) return;
  String out;
  const char *p = c_str();
  for (;;) {
    const char *hit = strstr(p, from.c_str());
    if (!hit) break;
    out.concat(String(p).substring(0, (unsigned int)(hit - p)));
    out.concat(to);
    p = hit + from.len_;
  }
  out.concat(p);
  *this = out;
}
void String::remove(unsigned int index, unsigned int count) {
  if (index >= len_) return;
  if (count > len_ - index) count = len_ - index;
  memmove(buf_ + index, buf_ + index + count, len_ - index - count + 1);
  len_ -= count;
}
void String::toLowerCase() {
  for (unsigned int i = 0; i < len_; i++) buf_[i] = (char)tolower(buf_[i]);
}
void String::toUpperCase() {
  for (unsigned int i = 0; i < len_; i++) buf_[i] = (char)toupper(buf_[i]);
}
void String::trim() {
  if (!buf_) return;
  unsigned int b = 0, e = len_;
  while (b < e && isspace(buf_[b])) b++;
  while (e > b && isspace(buf_[e - 1])) e--;
  memmove(buf_, buf_ + b, e - b);
  len_ = e - b;
  buf_[len_] = 0;
}
long String::toInt() const { return buf_ ? atol(buf_) : 0; }
double String::toDouble() const { return buf_ ? atof(buf_) : 0; }
float String::toFloat() const { return (float)toDouble(); }

String operator+(const String &a, const String &b) { String r(a); r.concat(b); return r; }
String operator+(const String &a, const char *b) { String r(a); r.concat(b); return r; }
String operator+(const char *a, const String &b) { String r(a); r.concat(b); return r; }
String operator+(const String &a, char b) { String r(a); r.concat(b); return r; }
String operator+(const String &a, int b) { String r(a); r.concat(b); return r; }
String operator+(const String &a, unsigned int b) { String r(a); r.concat(b); return r; }
String operator+(const String &a, long b) { String r(a); r.concat(b); return r; }
String operator+(const String &a, unsigned long b) { String r(a); r.concat(b); return r; }
String operator+(const String &a, float b) { String r(a); r.concat(b); return r; }
String operator+(const String &a, double b) { String r(a); r.concat(b); return r; }
