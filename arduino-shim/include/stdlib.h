#pragma once
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
void *malloc(size_t n);
void free(void *p);
void *calloc(size_t n, size_t size);
void *realloc(void *p, size_t n);
int atoi(const char *s);
long atol(const char *s);
double atof(const char *s);
long strtol(const char *s, char **end, int base);
unsigned long strtoul(const char *s, char **end, int base);
double strtod(const char *s, char **end);
int abs(int v);
long labs(long v);
char *itoa(int value, char *buf, int base);
char *ltoa(long value, char *buf, int base);
char *utoa(unsigned int value, char *buf, int base);
char *ultoa(unsigned long value, char *buf, int base);
char *dtostrf(double v, signed char width, unsigned char prec, char *buf);
int rand(void);
void srand(unsigned int seed);
#define RAND_MAX 0x7fffffff
#ifdef __cplusplus
}
#endif
