#pragma once
#include <stdint.h>
#include <stddef.h>

class String;

class Print {
 public:
  virtual ~Print() {}
  virtual size_t write(uint8_t c) = 0;
  virtual size_t write(const uint8_t *buf, size_t size);
  size_t write(const char *s);
  size_t write(const char *buf, size_t size) { return write((const uint8_t *)buf, size); }

  size_t print(const char *s);
  size_t print(char c);
  size_t print(unsigned char v, int base = 10);
  size_t print(int v, int base = 10);
  size_t print(unsigned int v, int base = 10);
  size_t print(long v, int base = 10);
  size_t print(unsigned long v, int base = 10);
  size_t print(long long v, int base = 10);
  size_t print(unsigned long long v, int base = 10);
  size_t print(double v, int digits = 2);
  size_t print(const String &s);

  size_t println(void);
  size_t println(const char *s);
  size_t println(char c);
  size_t println(unsigned char v, int base = 10);
  size_t println(int v, int base = 10);
  size_t println(unsigned int v, int base = 10);
  size_t println(long v, int base = 10);
  size_t println(unsigned long v, int base = 10);
  size_t println(long long v, int base = 10);
  size_t println(unsigned long long v, int base = 10);
  size_t println(double v, int digits = 2);
  size_t println(const String &s);

  size_t printf(const char *fmt, ...) __attribute__((format(printf, 2, 3)));

 private:
  size_t printNumber(unsigned long long n, uint8_t base);
  size_t printFloat(double number, uint8_t digits);
};
