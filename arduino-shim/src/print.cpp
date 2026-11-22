#include "Arduino.h"
#include "Printable.h"

size_t Print::write(const uint8_t *buf, size_t size) {
  size_t n = 0;
  while (size--) n += write(*buf++);
  return n;
}
size_t Print::write(const char *s) { return s ? write((const uint8_t *)s, strlen(s)) : 0; }

size_t Print::print(const char *s) { return write(s); }
size_t Print::print(char c) { return write((uint8_t)c); }
size_t Print::print(unsigned char v, int base) { return print((unsigned long long)v, base); }
size_t Print::print(int v, int base) { return print((long long)v, base); }
size_t Print::print(unsigned int v, int base) { return print((unsigned long long)v, base); }
size_t Print::print(long v, int base) { return print((long long)v, base); }
size_t Print::print(unsigned long v, int base) { return print((unsigned long long)v, base); }
size_t Print::print(long long v, int base) {
  if (base == 0) return write((uint8_t)v);
  if (base == 10 && v < 0) return write('-') + printNumber((unsigned long long)(-v), 10);
  return printNumber((unsigned long long)v, (uint8_t)base);
}
size_t Print::print(unsigned long long v, int base) {
  return base == 0 ? write((uint8_t)v) : printNumber(v, (uint8_t)base);
}
size_t Print::print(double v, int digits) { return printFloat(v, (uint8_t)digits); }
size_t Print::print(const String &s) { return write((const uint8_t *)s.c_str(), s.length()); }

size_t Print::println(void) { return write("\r\n"); }
size_t Print::println(const char *s) { return print(s) + println(); }
size_t Print::println(char c) { return print(c) + println(); }
size_t Print::println(unsigned char v, int b) { return print(v, b) + println(); }
size_t Print::println(int v, int b) { return print(v, b) + println(); }
size_t Print::println(unsigned int v, int b) { return print(v, b) + println(); }
size_t Print::println(long v, int b) { return print(v, b) + println(); }
size_t Print::println(unsigned long v, int b) { return print(v, b) + println(); }
size_t Print::println(long long v, int b) { return print(v, b) + println(); }
size_t Print::println(unsigned long long v, int b) { return print(v, b) + println(); }
size_t Print::println(double v, int d) { return print(v, d) + println(); }
size_t Print::println(const String &s) { return print(s) + println(); }

size_t Print::printNumber(unsigned long long n, uint8_t base) {
  char buf[65];
  char *p = &buf[sizeof(buf) - 1];
  *p = 0;
  if (base < 2) base = 10;
  do {
    unsigned d = (unsigned)(n % base);
    n /= base;
    *--p = (char)(d < 10 ? '0' + d : 'A' + d - 10);
  } while (n);
  return write(p);
}

// Same algorithm as the Arduino core so output matches a real board.
size_t Print::printFloat(double number, uint8_t digits) {
  if (isnan(number)) return print("nan");
  if (isinf(number)) return print("inf");
  if (number > 4294967040.0 || number < -4294967040.0) return print("ovf");
  size_t n = 0;
  if (number < 0.0) {
    n += print('-');
    number = -number;
  }
  double rounding = 0.5;
  for (uint8_t i = 0; i < digits; ++i) rounding /= 10.0;
  number += rounding;
  unsigned long int_part = (unsigned long)number;
  double remainder = number - (double)int_part;
  n += print(int_part);
  if (digits > 0) n += print('.');
  while (digits-- > 0) {
    remainder *= 10.0;
    unsigned int toPrint = (unsigned int)remainder;
    n += print(toPrint);
    remainder -= toPrint;
  }
  return n;
}

size_t Print::printf(const char *fmt, ...) {
  char stackBuf[128];
  va_list ap;
  va_start(ap, fmt);
  int len = vsnprintf(stackBuf, sizeof(stackBuf), fmt, ap);
  va_end(ap);
  if (len < 0) return 0;
  if ((size_t)len < sizeof(stackBuf)) return write((const uint8_t *)stackBuf, (size_t)len);
  char *big = (char *)malloc((size_t)len + 1);
  if (!big) return 0;
  va_start(ap, fmt);
  vsnprintf(big, (size_t)len + 1, fmt, ap);
  va_end(ap);
  size_t n = write((const uint8_t *)big, (size_t)len);
  free(big);
  return n;
}

size_t Print::print(const Printable &p) { return p.printTo(*this); }
size_t Print::println(const Printable &p) { return print(p) + println(); }
