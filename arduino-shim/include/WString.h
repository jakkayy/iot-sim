#pragma once
#include <stdint.h>
#include <stddef.h>

// Arduino String (subset), heap-allocated.
class String {
 public:
  String() : buf_(nullptr), len_(0), cap_(0) {}
  String(const char *s);
  String(const String &o);
  String(String &&o) noexcept : buf_(o.buf_), len_(o.len_), cap_(o.cap_) { o.buf_ = nullptr; o.len_ = o.cap_ = 0; }
  explicit String(char c);
  explicit String(int v, unsigned char base = 10);
  explicit String(unsigned int v, unsigned char base = 10);
  explicit String(long v, unsigned char base = 10);
  explicit String(unsigned long v, unsigned char base = 10);
  explicit String(float v, unsigned char decimals = 2);
  explicit String(double v, unsigned char decimals = 2);
  ~String();

  String &operator=(const String &o);
  String &operator=(String &&o) noexcept;
  String &operator=(const char *s);

  unsigned int length() const { return len_; }
  const char *c_str() const { return buf_ ? buf_ : ""; }
  char charAt(unsigned int i) const { return i < len_ ? buf_[i] : 0; }
  char operator[](unsigned int i) const { return charAt(i); }
  char &operator[](unsigned int i);
  bool isEmpty() const { return len_ == 0; }

  bool concat(const char *s);
  bool concat(const String &s) { return concat(s.c_str()); }
  bool concat(char c);
  bool concat(int v);
  bool concat(unsigned int v);
  bool concat(long v);
  bool concat(unsigned long v);
  bool concat(float v);
  bool concat(double v);
  String &operator+=(const String &s) { concat(s); return *this; }
  String &operator+=(const char *s) { concat(s); return *this; }
  String &operator+=(char c) { concat(c); return *this; }
  String &operator+=(int v) { concat(v); return *this; }
  String &operator+=(unsigned int v) { concat(v); return *this; }
  String &operator+=(long v) { concat(v); return *this; }
  String &operator+=(unsigned long v) { concat(v); return *this; }
  String &operator+=(float v) { concat(v); return *this; }
  String &operator+=(double v) { concat(v); return *this; }

  int compareTo(const String &s) const;
  bool equals(const String &s) const { return compareTo(s) == 0; }
  bool equals(const char *s) const;
  bool equalsIgnoreCase(const String &s) const;
  bool operator==(const String &s) const { return equals(s); }
  bool operator==(const char *s) const { return equals(s); }
  bool operator!=(const String &s) const { return !equals(s); }
  bool operator!=(const char *s) const { return !equals(s); }
  bool operator<(const String &s) const { return compareTo(s) < 0; }
  bool operator>(const String &s) const { return compareTo(s) > 0; }
  bool startsWith(const String &p) const;
  bool endsWith(const String &p) const;

  int indexOf(char c, unsigned int from = 0) const;
  int indexOf(const String &s, unsigned int from = 0) const;
  int lastIndexOf(char c) const;
  String substring(unsigned int from) const { return substring(from, len_); }
  String substring(unsigned int from, unsigned int to) const;
  void replace(char from, char to);
  void replace(const String &from, const String &to);
  void remove(unsigned int index, unsigned int count = 0xffffffffu);
  void toLowerCase();
  void toUpperCase();
  void trim();
  long toInt() const;
  float toFloat() const;
  double toDouble() const;
  void reserve(unsigned int size) { grow(size); }

 private:
  bool grow(unsigned int cap);
  char *buf_;
  unsigned int len_;
  unsigned int cap_;
};

String operator+(const String &a, const String &b);
String operator+(const String &a, const char *b);
String operator+(const char *a, const String &b);
String operator+(const String &a, char b);
String operator+(const String &a, int b);
String operator+(const String &a, unsigned int b);
String operator+(const String &a, long b);
String operator+(const String &a, unsigned long b);
String operator+(const String &a, float b);
String operator+(const String &a, double b);
