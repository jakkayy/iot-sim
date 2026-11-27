// Minimal C runtime for the freestanding wasm32 build: allocator, memory/string
// functions, number conversion, printf family, C++ glue. No libc is linked.
#include <stdint.h>
#include <stddef.h>
#include <stdarg.h>
#include "Arduino.h"

extern "C" {

// ---- allocator: first-fit free list over linear memory ------------------
extern unsigned char __heap_base;

struct Block {
  size_t size;  // payload size, low bit = in use
  Block *next;  // next block in address order
};

static Block *head = nullptr;
static unsigned char *heapEnd = nullptr;

static size_t align8(size_t n) { return (n + 7u) & ~(size_t)7u; }

static bool growHeap(size_t need) {
  size_t pages = (need + 65535u) / 65536u;
  if (__builtin_wasm_memory_grow(0, pages) == (size_t)-1) return false;
  return true;
}

void *malloc(size_t n) {
  if (n == 0) n = 1;
  n = align8(n);
  if (!head) {
    heapEnd = &__heap_base;
    unsigned char *mem_end = (unsigned char *)(__builtin_wasm_memory_size(0) * 65536u);
    if ((size_t)(mem_end - heapEnd) < sizeof(Block) + 64) {
      if (!growHeap(65536)) return nullptr;
      mem_end = (unsigned char *)(__builtin_wasm_memory_size(0) * 65536u);
    }
    head = (Block *)(((size_t)heapEnd + 7u) & ~(size_t)7u);
    head->size = (size_t)(mem_end - (unsigned char *)head) - sizeof(Block);
    head->next = nullptr;
    heapEnd = mem_end;
  }
  for (;;) {
    Block *last = nullptr;
    for (Block *b = head; b; last = b, b = b->next) {
      if ((b->size & 1) || b->size < n) continue;
      if (b->size >= n + sizeof(Block) + 16) {  // split
        Block *rest = (Block *)((unsigned char *)(b + 1) + n);
        rest->size = b->size - n - sizeof(Block);
        rest->next = b->next;
        b->next = rest;
        b->size = n;
      }
      b->size |= 1;
      return b + 1;
    }
    // out of space: grow memory and extend the last block / append a new one
    size_t grow = n + sizeof(Block);
    size_t pages = (grow + 65535u) / 65536u;
    unsigned char *oldEnd = (unsigned char *)(__builtin_wasm_memory_size(0) * 65536u);
    if (__builtin_wasm_memory_grow(0, pages) == (size_t)-1) return nullptr;
    size_t added = pages * 65536u;
    if (last && !(last->size & 1) && (unsigned char *)(last + 1) + last->size == oldEnd) {
      last->size += added;
    } else {
      Block *nb = (Block *)oldEnd;
      nb->size = added - sizeof(Block);
      nb->next = nullptr;
      if (last) last->next = nb;
    }
  }
}

void free(void *p) {
  if (!p) return;
  Block *b = (Block *)p - 1;
  b->size &= ~(size_t)1;
  // coalesce forward and with the previous free block
  Block *prev = nullptr;
  for (Block *c = head; c; prev = c, c = c->next) {
    if (c != b) continue;
    while (b->next && !(b->next->size & 1) && (unsigned char *)(b + 1) + b->size == (unsigned char *)b->next) {
      b->size += sizeof(Block) + b->next->size;
      b->next = b->next->next;
    }
    if (prev && !(prev->size & 1) && (unsigned char *)(prev + 1) + prev->size == (unsigned char *)b) {
      prev->size += sizeof(Block) + b->size;
      prev->next = b->next;
    }
    return;
  }
}

void *calloc(size_t n, size_t size) {
  void *p = malloc(n * size);
  if (p) memset(p, 0, n * size);
  return p;
}

void *realloc(void *p, size_t n) {
  if (!p) return malloc(n);
  Block *b = (Block *)p - 1;
  size_t old = b->size & ~(size_t)1;
  if (n <= old) return p;
  void *q = malloc(n);
  if (!q) return nullptr;
  memcpy(q, p, old);
  free(p);
  return q;
}

// ---- memory and string --------------------------------------------------
void *memcpy(void *dst, const void *src, size_t n) {
  unsigned char *d = (unsigned char *)dst;
  const unsigned char *s = (const unsigned char *)src;
  while (n--) *d++ = *s++;
  return dst;
}
void *memmove(void *dst, const void *src, size_t n) {
  unsigned char *d = (unsigned char *)dst;
  const unsigned char *s = (const unsigned char *)src;
  if (d < s) {
    while (n--) *d++ = *s++;
  } else {
    d += n;
    s += n;
    while (n--) *--d = *--s;
  }
  return dst;
}
void *memset(void *dst, int c, size_t n) {
  unsigned char *d = (unsigned char *)dst;
  while (n--) *d++ = (unsigned char)c;
  return dst;
}
int memcmp(const void *a, const void *b, size_t n) {
  const unsigned char *x = (const unsigned char *)a, *y = (const unsigned char *)b;
  for (; n; n--, x++, y++)
    if (*x != *y) return *x - *y;
  return 0;
}
size_t strlen(const char *s) {
  const char *p = s;
  while (*p) p++;
  return (size_t)(p - s);
}
int strcmp(const char *a, const char *b) {
  while (*a && *a == *b) a++, b++;
  return (unsigned char)*a - (unsigned char)*b;
}
int strncmp(const char *a, const char *b, size_t n) {
  for (; n; n--, a++, b++) {
    if (*a != *b) return (unsigned char)*a - (unsigned char)*b;
    if (!*a) return 0;
  }
  return 0;
}
char *strcpy(char *dst, const char *src) {
  char *d = dst;
  while ((*d++ = *src++)) {}
  return dst;
}
char *strncpy(char *dst, const char *src, size_t n) {
  size_t i = 0;
  for (; i < n && src[i]; i++) dst[i] = src[i];
  for (; i < n; i++) dst[i] = 0;
  return dst;
}
char *strcat(char *dst, const char *src) {
  strcpy(dst + strlen(dst), src);
  return dst;
}
char *strchr(const char *s, int c) {
  for (;; s++) {
    if (*s == (char)c) return (char *)s;
    if (!*s) return nullptr;
  }
}
char *strrchr(const char *s, int c) {
  const char *r = nullptr;
  for (;; s++) {
    if (*s == (char)c) r = s;
    if (!*s) return (char *)r;
  }
}
char *strstr(const char *h, const char *n) {
  size_t nl = strlen(n);
  if (!nl) return (char *)h;
  for (; *h; h++)
    if (!strncmp(h, n, nl)) return (char *)h;
  return nullptr;
}

int toupper(int c) { return (c >= 'a' && c <= 'z') ? c - 32 : c; }
int tolower(int c) { return (c >= 'A' && c <= 'Z') ? c + 32 : c; }
int isdigit(int c) { return c >= '0' && c <= '9'; }
int isalpha(int c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
int isalnum(int c) { return isdigit(c) || isalpha(c); }
int isspace(int c) { return c == ' ' || (c >= 9 && c <= 13); }
int isupper(int c) { return c >= 'A' && c <= 'Z'; }
int islower(int c) { return c >= 'a' && c <= 'z'; }
int isprint(int c) { return c >= 32 && c < 127; }

// ---- numbers ------------------------------------------------------------
int abs(int v) { return v < 0 ? -v : v; }
long labs(long v) { return v < 0 ? -v : v; }

unsigned long strtoul(const char *s, char **end, int base) {
  while (isspace(*s)) s++;
  if ((base == 0 || base == 16) && s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) {
    s += 2;
    base = 16;
  } else if (base == 0) {
    base = (s[0] == '0') ? 8 : 10;
  }
  unsigned long v = 0;
  for (;; s++) {
    int d;
    if (*s >= '0' && *s <= '9') d = *s - '0';
    else if (*s >= 'a' && *s <= 'z') d = *s - 'a' + 10;
    else if (*s >= 'A' && *s <= 'Z') d = *s - 'A' + 10;
    else break;
    if (d >= base) break;
    v = v * base + d;
  }
  if (end) *end = (char *)s;
  return v;
}
long strtol(const char *s, char **end, int base) {
  while (isspace(*s)) s++;
  bool neg = false;
  if (*s == '-' || *s == '+') neg = *s++ == '-';
  long v = (long)strtoul(s, end, base);
  return neg ? -v : v;
}
int atoi(const char *s) { return (int)strtol(s, nullptr, 10); }
long atol(const char *s) { return strtol(s, nullptr, 10); }

double strtod(const char *s, char **end) {
  while (isspace(*s)) s++;
  bool neg = false;
  if (*s == '-' || *s == '+') neg = *s++ == '-';
  double v = 0;
  while (isdigit(*s)) v = v * 10 + (*s++ - '0');
  if (*s == '.') {
    s++;
    double f = 0.1;
    while (isdigit(*s)) {
      v += (*s++ - '0') * f;
      f /= 10;
    }
  }
  if (*s == 'e' || *s == 'E') {
    const char *t = s + 1;
    bool eneg = false;
    if (*t == '-' || *t == '+') eneg = *t++ == '-';
    if (isdigit(*t)) {
      int e = 0;
      while (isdigit(*t)) e = e * 10 + (*t++ - '0');
      double p = 1;
      while (e--) p *= 10;
      v = eneg ? v / p : v * p;
      s = t;
    }
  }
  if (end) *end = (char *)s;
  return neg ? -v : v;
}
double atof(const char *s) { return strtod(s, nullptr); }

static char *utoaBase(unsigned long long v, char *buf, int base) {
  char tmp[65];
  int i = 0;
  if (base < 2 || base > 36) base = 10;
  do {
    int d = (int)(v % base);
    tmp[i++] = (char)(d < 10 ? '0' + d : 'a' + d - 10);
    v /= base;
  } while (v);
  int j = 0;
  while (i) buf[j++] = tmp[--i];
  buf[j] = 0;
  return buf;
}
char *utoa(unsigned int v, char *buf, int base) { return utoaBase(v, buf, base); }
char *ultoa(unsigned long v, char *buf, int base) { return utoaBase(v, buf, base); }
char *itoa(int v, char *buf, int base) {
  if (v < 0 && base == 10) {
    buf[0] = '-';
    utoaBase((unsigned long long)(-(long long)v), buf + 1, 10);
    return buf;
  }
  return utoaBase((unsigned int)v, buf, base);
}
char *ltoa(long v, char *buf, int base) {
  if (v < 0 && base == 10) {
    buf[0] = '-';
    utoaBase((unsigned long long)(-(long long)v), buf + 1, 10);
    return buf;
  }
  return utoaBase((unsigned long)v, buf, base);
}

static unsigned int rngState = 1;
int rand(void) {
  rngState = rngState * 1103515245u + 12345u;
  return (int)((rngState >> 1) & 0x7fffffff);
}
void srand(unsigned int seed) { rngState = seed ? seed : 1; }

// ---- printf family --------------------------------------------------------
static void putc_(char *buf, size_t size, size_t &pos, char c) {
  if (pos + 1 < size) buf[pos] = c;
  pos++;
}

static void formatFloat(char *buf, size_t size, size_t &pos, double v, int prec, int width, bool zero, bool left) {
  char tmp[48];
  int n = 0;
  if (v != v) {
    tmp[n++] = 'n'; tmp[n++] = 'a'; tmp[n++] = 'n';
  } else {
    bool neg = v < 0;
    if (neg) v = -v;
    if (v > 4294967040.0) {
      tmp[n++] = 'o'; tmp[n++] = 'v'; tmp[n++] = 'f';
    } else {
      double rounding = 0.5;
      for (int i = 0; i < prec; i++) rounding /= 10.0;
      v += rounding;
      unsigned long ip = (unsigned long)v;
      double rem = v - (double)ip;
      char digits[16];
      int dn = 0;
      do { digits[dn++] = (char)('0' + ip % 10); ip /= 10; } while (ip);
      if (neg) tmp[n++] = '-';
      while (dn) tmp[n++] = digits[--dn];
      if (prec > 0) {
        tmp[n++] = '.';
        while (prec-- > 0 && n < 46) {
          rem *= 10.0;
          unsigned d = (unsigned)rem;
          tmp[n++] = (char)('0' + d);
          rem -= d;
        }
      }
    }
  }
  int pad = width > n ? width - n : 0;
  if (!left) {
    if (zero && n > 0 && tmp[0] == '-') {
      putc_(buf, size, pos, '-');
      for (int i = 0; i < pad; i++) putc_(buf, size, pos, '0');
      for (int i = 1; i < n; i++) putc_(buf, size, pos, tmp[i]);
      return;
    }
    for (int i = 0; i < pad; i++) putc_(buf, size, pos, zero ? '0' : ' ');
  }
  for (int i = 0; i < n; i++) putc_(buf, size, pos, tmp[i]);
  if (left) for (int i = 0; i < pad; i++) putc_(buf, size, pos, ' ');
}

int vsnprintf(char *buf, size_t size, const char *fmt, va_list ap) {
  size_t pos = 0;
  for (; *fmt; fmt++) {
    if (*fmt != '%') {
      putc_(buf, size, pos, *fmt);
      continue;
    }
    fmt++;
    bool left = false, zero = false, plus = false;
    for (;; fmt++) {
      if (*fmt == '-') left = true;
      else if (*fmt == '0') zero = true;
      else if (*fmt == '+') plus = true;
      else if (*fmt == ' ' || *fmt == '#') {}
      else break;
    }
    int width = 0;
    if (*fmt == '*') { width = va_arg(ap, int); fmt++; }
    else while (isdigit(*fmt)) width = width * 10 + (*fmt++ - '0');
    int prec = -1;
    if (*fmt == '.') {
      fmt++;
      prec = 0;
      if (*fmt == '*') { prec = va_arg(ap, int); fmt++; }
      else while (isdigit(*fmt)) prec = prec * 10 + (*fmt++ - '0');
    }
    int longs = 0;
    while (*fmt == 'l' || *fmt == 'h' || *fmt == 'z') {
      if (*fmt == 'l') longs++;
      fmt++;
    }
    char spec = *fmt;
    if (!spec) break;
    char tmp[72];
    const char *out = tmp;
    int n = 0;
    switch (spec) {
      case '%': tmp[0] = '%'; n = 1; break;
      case 'c': tmp[0] = (char)va_arg(ap, int); n = 1; break;
      case 's': {
        const char *s = va_arg(ap, const char *);
        if (!s) s = "(null)";
        out = s;
        n = (int)strlen(s);
        if (prec >= 0 && n > prec) n = prec;
        break;
      }
      case 'd': case 'i': {
        long long v = longs >= 2 ? va_arg(ap, long long) : (long long)va_arg(ap, long);
        if (longs == 0) v = (int)v;
        bool neg = v < 0;
        unsigned long long u = neg ? (unsigned long long)(-v) : (unsigned long long)v;
        char digits[24];
        int dn = 0;
        do { digits[dn++] = (char)('0' + u % 10); u /= 10; } while (u);
        if (neg) tmp[n++] = '-';
        else if (plus) tmp[n++] = '+';
        while (dn) tmp[n++] = digits[--dn];
        break;
      }
      case 'u': case 'x': case 'X': case 'o': {
        unsigned long long u = longs >= 2 ? va_arg(ap, unsigned long long) : (unsigned long long)va_arg(ap, unsigned long);
        if (longs == 0) u = (unsigned int)u;
        int base = spec == 'u' ? 10 : spec == 'o' ? 8 : 16;
        utoaBase(u, tmp, base);
        n = (int)strlen(tmp);
        if (spec == 'X') for (int i = 0; i < n; i++) tmp[i] = (char)toupper(tmp[i]);
        break;
      }
      case 'f': case 'F': {
        double v = va_arg(ap, double);
        formatFloat(buf, size, pos, v, prec < 0 ? 6 : prec, width, zero, left);
        continue;
      }
      default:
        tmp[0] = '%'; tmp[1] = spec; n = 2;
        break;
    }
    int pad = width > n ? width - n : 0;
    if (!left) {
      bool neg = n > 0 && (out[0] == '-' || out[0] == '+') && (spec == 'd' || spec == 'i');
      if (zero && neg) {
        putc_(buf, size, pos, out[0]);
        for (int i = 0; i < pad; i++) putc_(buf, size, pos, '0');
        for (int i = 1; i < n; i++) putc_(buf, size, pos, out[i]);
        continue;
      }
      for (int i = 0; i < pad; i++) putc_(buf, size, pos, zero && spec != 's' && spec != 'c' ? '0' : ' ');
    }
    for (int i = 0; i < n; i++) putc_(buf, size, pos, out[i]);
    if (left) for (int i = 0; i < pad; i++) putc_(buf, size, pos, ' ');
  }
  if (size) buf[pos < size ? pos : size - 1] = 0;
  return (int)pos;
}

int snprintf(char *buf, size_t size, const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  int r = vsnprintf(buf, size, fmt, ap);
  va_end(ap);
  return r;
}
int sprintf(char *buf, const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  int r = vsnprintf(buf, 0x7fffffff, fmt, ap);
  va_end(ap);
  return r;
}
char *dtostrf(double v, signed char width, unsigned char prec, char *buf) {
  size_t pos = 0;
  formatFloat(buf, 0x7fffffff, pos, v, prec, width < 0 ? -width : width, false, width < 0);
  buf[pos] = 0;
  return buf;
}

// ---- math imported from JS Math --------------------------------------------
enum { M_SIN, M_COS, M_TAN, M_ASIN, M_ACOS, M_ATAN, M_ATAN2, M_EXP, M_LOG, M_LOG10, M_POW, M_FMOD, M_ROUND };
double sin(double x) { return simMath(M_SIN, x, 0); }
double cos(double x) { return simMath(M_COS, x, 0); }
double tan(double x) { return simMath(M_TAN, x, 0); }
double asin(double x) { return simMath(M_ASIN, x, 0); }
double acos(double x) { return simMath(M_ACOS, x, 0); }
double atan(double x) { return simMath(M_ATAN, x, 0); }
double atan2(double y, double x) { return simMath(M_ATAN2, y, x); }
double exp(double x) { return simMath(M_EXP, x, 0); }
double log(double x) { return simMath(M_LOG, x, 0); }
double log10(double x) { return simMath(M_LOG10, x, 0); }
double pow(double x, double y) { return simMath(M_POW, x, y); }
double fmod(double x, double y) { return simMath(M_FMOD, x, y); }
double round(double x) { return simMath(M_ROUND, x, 0); }
float sinf(float x) { return (float)sin(x); }
float cosf(float x) { return (float)cos(x); }
float tanf(float x) { return (float)tan(x); }
float powf(float x, float y) { return (float)pow(x, y); }
float logf(float x) { return (float)log(x); }
float expf(float x) { return (float)exp(x); }
float roundf(float x) { return (float)round(x); }
float floorf(float x) { return __builtin_floorf(x); }
float ceilf(float x) { return __builtin_ceilf(x); }

// ---- C++ glue ----------------------------------------------------------------
void *__dso_handle = nullptr;
int __cxa_atexit(void (*)(void *), void *, void *) { return 0; }
void __cxa_pure_virtual() { __builtin_trap(); }
}

void *operator new(size_t n) { return malloc(n); }
void *operator new[](size_t n) { return malloc(n); }
void operator delete(void *p) noexcept { free(p); }
void operator delete[](void *p) noexcept { free(p); }
void operator delete(void *p, size_t) noexcept { free(p); }
void operator delete[](void *p, size_t) noexcept { free(p); }
