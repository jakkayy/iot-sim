#pragma once
#include "Arduino.h"

// Subset of Adafruit_GFX: shapes and the built-in 5x7 text. Subclasses implement drawPixel.
class Adafruit_GFX : public Print {
 public:
  Adafruit_GFX(int16_t w, int16_t h) : WIDTH(w), HEIGHT(h), _width(w), _height(h) {}

  virtual void drawPixel(int16_t x, int16_t y, uint16_t color) = 0;
  virtual void fillScreen(uint16_t color) { fillRect(0, 0, _width, _height, color); }

  void drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color);
  void drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t color) { drawLine(x, y, x + w - 1, y, color); }
  void drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t color) { drawLine(x, y, x, y + h - 1, color); }
  void drawRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
  virtual void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
  void drawCircle(int16_t x0, int16_t y0, int16_t r, uint16_t color);
  void fillCircle(int16_t x0, int16_t y0, int16_t r, uint16_t color);
  void drawTriangle(int16_t x0, int16_t y0, int16_t x1, int16_t y1, int16_t x2, int16_t y2, uint16_t color);
  void drawBitmap(int16_t x, int16_t y, const uint8_t bitmap[], int16_t w, int16_t h, uint16_t color);
  void drawChar(int16_t x, int16_t y, unsigned char c, uint16_t color, uint16_t bg, uint8_t size);
  void getTextBounds(const char *s, int16_t x, int16_t y, int16_t *x1, int16_t *y1, uint16_t *w, uint16_t *h);

  void setCursor(int16_t x, int16_t y) { cursor_x = x; cursor_y = y; }
  void setTextColor(uint16_t c) { textcolor = textbgcolor = c; }
  void setTextColor(uint16_t c, uint16_t bg) { textcolor = c; textbgcolor = bg; }
  void setTextSize(uint8_t s) { textsize = s ? s : 1; }
  void setTextWrap(bool w) { wrap = w; }
  void setRotation(uint8_t r) {
    rotation = r & 3;
    _width = (rotation & 1) ? HEIGHT : WIDTH;
    _height = (rotation & 1) ? WIDTH : HEIGHT;
  }
  uint8_t getRotation() const { return rotation; }
  int16_t getCursorX() const { return cursor_x; }
  int16_t getCursorY() const { return cursor_y; }
  int16_t width() const { return _width; }
  int16_t height() const { return _height; }

  size_t write(uint8_t c) override;
  using Print::write;

 protected:
  int16_t WIDTH, HEIGHT, _width, _height;
  int16_t cursor_x = 0, cursor_y = 0;
  uint16_t textcolor = 1, textbgcolor = 1;
  uint8_t textsize = 1, rotation = 0;
  bool wrap = true;
};
