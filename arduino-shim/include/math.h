#pragma once
#ifdef __cplusplus
extern "C" {
#endif
#define NAN (__builtin_nanf(""))
#define INFINITY (__builtin_inff())
#define isnan(x) __builtin_isnan(x)
#define isinf(x) __builtin_isinf(x)
// Simple ones lower to wasm instructions; the rest are imported from JS Math.
static inline double sqrt(double x) { return __builtin_sqrt(x); }
static inline float sqrtf(float x) { return __builtin_sqrtf(x); }
static inline double fabs(double x) { return __builtin_fabs(x); }
static inline float fabsf(float x) { return __builtin_fabsf(x); }
static inline double floor(double x) { return __builtin_floor(x); }
static inline double ceil(double x) { return __builtin_ceil(x); }
static inline double trunc(double x) { return __builtin_trunc(x); }
double round(double x);
double sin(double x);
double cos(double x);
double tan(double x);
double asin(double x);
double acos(double x);
double atan(double x);
double atan2(double y, double x);
double exp(double x);
double log(double x);
double log10(double x);
double pow(double x, double y);
double fmod(double x, double y);
float sinf(float x);
float cosf(float x);
float tanf(float x);
float powf(float x, float y);
float logf(float x);
float expf(float x);
float roundf(float x);
float floorf(float x);
float ceilf(float x);
#ifdef __cplusplus
}
#endif
