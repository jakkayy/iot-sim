#include "Adafruit_GFX.h"
#include "Adafruit_SSD1306.h"
#include "glcdfont.h"

#define SWAP(a, b) { int16_t t = a; a = b; b = t; }

void Adafruit_GFX::drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color) {
  int16_t steep = abs(y1 - y0) > abs(x1 - x0);
  if (steep) { SWAP(x0, y0); SWAP(x1, y1); }
  if (x0 > x1) { SWAP(x0, x1); SWAP(y0, y1); }
  int16_t dx = x1 - x0, dy = abs(y1 - y0);
  int16_t err = dx / 2, ystep = y0 < y1 ? 1 : -1;
  for (; x0 <= x1; x0++) {
    if (steep) drawPixel(y0, x0, color);
    else drawPixel(x0, y0, color);
    err -= dy;
    if (err < 0) {
      y0 += ystep;
      err += dx;
    }
  }
}

void Adafruit_GFX::drawRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
  drawFastHLine(x, y, w, color);
  drawFastHLine(x, y + h - 1, w, color);
  drawFastVLine(x, y, h, color);
  drawFastVLine(x + w - 1, y, h, color);
}

void Adafruit_GFX::fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
  for (int16_t i = x; i < x + w; i++)
    for (int16_t j = y; j < y + h; j++) drawPixel(i, j, color);
}

void Adafruit_GFX::drawCircle(int16_t x0, int16_t y0, int16_t r, uint16_t color) {
  int16_t f = 1 - r, ddF_x = 1, ddF_y = -2 * r, x = 0, y = r;
  drawPixel(x0, y0 + r, color);
  drawPixel(x0, y0 - r, color);
  drawPixel(x0 + r, y0, color);
  drawPixel(x0 - r, y0, color);
  while (x < y) {
    if (f >= 0) {
      y--;
      ddF_y += 2;
      f += ddF_y;
    }
    x++;
    ddF_x += 2;
    f += ddF_x;
    drawPixel(x0 + x, y0 + y, color);
    drawPixel(x0 - x, y0 + y, color);
    drawPixel(x0 + x, y0 - y, color);
    drawPixel(x0 - x, y0 - y, color);
    drawPixel(x0 + y, y0 + x, color);
    drawPixel(x0 - y, y0 + x, color);
    drawPixel(x0 + y, y0 - x, color);
    drawPixel(x0 - y, y0 - x, color);
  }
}

void Adafruit_GFX::fillCircle(int16_t x0, int16_t y0, int16_t r, uint16_t color) {
  for (int16_t y = -r; y <= r; y++)
    for (int16_t x = -r; x <= r; x++)
      if (x * x + y * y <= r * r) drawPixel(x0 + x, y0 + y, color);
}

void Adafruit_GFX::drawTriangle(int16_t x0, int16_t y0, int16_t x1, int16_t y1, int16_t x2, int16_t y2, uint16_t color) {
  drawLine(x0, y0, x1, y1, color);
  drawLine(x1, y1, x2, y2, color);
  drawLine(x2, y2, x0, y0, color);
}

void Adafruit_GFX::drawBitmap(int16_t x, int16_t y, const uint8_t bitmap[], int16_t w, int16_t h, uint16_t color) {
  int16_t byteWidth = (w + 7) / 8;
  for (int16_t j = 0; j < h; j++)
    for (int16_t i = 0; i < w; i++)
      if (bitmap[j * byteWidth + i / 8] & (128 >> (i & 7))) drawPixel(x + i, y + j, color);
}

void Adafruit_GFX::drawChar(int16_t x, int16_t y, unsigned char c, uint16_t color, uint16_t bg, uint8_t size) {
  if (x >= _width || y >= _height || x + 6 * size - 1 < 0 || y + 8 * size - 1 < 0) return;
  if (c < 32 || c > 126) c = '?';
  for (int8_t i = 0; i < 5; i++) {
    uint8_t line = glcdfont[(c - 32) * 5 + i];
    for (int8_t j = 0; j < 8; j++, line >>= 1) {
      if (line & 1) {
        if (size == 1) drawPixel(x + i, y + j, color);
        else fillRect(x + i * size, y + j * size, size, size, color);
      } else if (bg != color) {
        if (size == 1) drawPixel(x + i, y + j, bg);
        else fillRect(x + i * size, y + j * size, size, size, bg);
      }
    }
  }
  if (bg != color) {  // gap column between characters
    if (size == 1) drawFastVLine(x + 5, y, 8, bg);
    else fillRect(x + 5 * size, y, size, 8 * size, bg);
  }
}

size_t Adafruit_GFX::write(uint8_t c) {
  if (c == '\n') {
    cursor_x = 0;
    cursor_y += textsize * 8;
  } else if (c != '\r') {
    if (wrap && (cursor_x + textsize * 6 > _width)) {
      cursor_x = 0;
      cursor_y += textsize * 8;
    }
    drawChar(cursor_x, cursor_y, c, textcolor, textbgcolor, textsize);
    cursor_x += textsize * 6;
  }
  return 1;
}

void Adafruit_GFX::getTextBounds(const char *s, int16_t x, int16_t y, int16_t *x1, int16_t *y1, uint16_t *w, uint16_t *h) {
  uint16_t maxw = 0, curw = 0, lines = 1;
  for (; *s; s++) {
    if (*s == '\n') {
      if (curw > maxw) maxw = curw;
      curw = 0;
      lines++;
    } else if (*s != '\r') {
      curw += textsize * 6;
    }
  }
  if (curw > maxw) maxw = curw;
  *x1 = x;
  *y1 = y;
  *w = maxw;
  *h = (uint16_t)(lines * textsize * 8);
}

// ---- SSD1306 ---------------------------------------------------------------
Adafruit_SSD1306::Adafruit_SSD1306(uint8_t w, uint8_t h, TwoWire *twi, int8_t, uint32_t, uint32_t)
    : Adafruit_GFX(w, h), wire(twi), buffer(nullptr), i2caddr(0), vccstate(0), contrast(0) {}

Adafruit_SSD1306::~Adafruit_SSD1306() { free(buffer); }

void Adafruit_SSD1306::command(uint8_t c) {
  wire->beginTransmission(i2caddr);
  wire->write((uint8_t)0x00);
  wire->write(c);
  wire->endTransmission();
}
void Adafruit_SSD1306::ssd1306_command(uint8_t c) { command(c); }

bool Adafruit_SSD1306::begin(uint8_t switchvcc, uint8_t addr, bool, bool periphBegin) {
  if (!buffer) {
    buffer = (uint8_t *)malloc((size_t)WIDTH * ((HEIGHT + 7) / 8));
    if (!buffer) return false;
  }
  clearDisplay();
  vccstate = switchvcc;
  i2caddr = addr ? addr : (HEIGHT == 32 ? 0x3C : 0x3D);  // same default as the real library
  if (periphBegin) wire->begin();
  static const uint8_t comPins64 = 0x12, comPins32 = 0x02;
  const uint8_t init[] = {0xAE, 0xD5, 0x80, 0xA8, (uint8_t)(HEIGHT - 1), 0xD3, 0x00, 0x40,
                          0x8D, (uint8_t)(vccstate == SSD1306_EXTERNALVCC ? 0x10 : 0x14), 0x20, 0x00, 0xA1, 0xC8,
                          0xDA, (uint8_t)(HEIGHT == 32 ? comPins32 : comPins64), 0x81,
                          (uint8_t)(vccstate == SSD1306_EXTERNALVCC ? 0x9F : (HEIGHT == 32 ? 0x8F : 0xCF)),
                          0xD9, (uint8_t)(vccstate == SSD1306_EXTERNALVCC ? 0x22 : 0xF1), 0xDB, 0x40, 0xA4, 0xA6, 0x2E, 0xAF};
  contrast = init[17];
  for (uint8_t c : init) command(c);
  return true;
}

void Adafruit_SSD1306::display() {
  if (!buffer) return;
  command(0x22);
  command(0);
  command(0xFF);
  command(0x21);
  command(0);
  command((uint8_t)(WIDTH - 1));
  size_t count = (size_t)WIDTH * ((HEIGHT + 7) / 8);
  const uint8_t *p = buffer;
  while (count) {
    size_t n = count < 16 ? count : 16;
    wire->beginTransmission(i2caddr);
    wire->write((uint8_t)0x40);
    for (size_t i = 0; i < n; i++) wire->write(*p++);
    wire->endTransmission();
    count -= n;
  }
}

void Adafruit_SSD1306::clearDisplay() {
  if (buffer) memset(buffer, 0, (size_t)WIDTH * ((HEIGHT + 7) / 8));
}
void Adafruit_SSD1306::invertDisplay(bool i) { command(i ? 0xA7 : 0xA6); }
void Adafruit_SSD1306::dim(bool d) {
  command(0x81);
  command(d ? 0 : contrast);
}

void Adafruit_SSD1306::drawPixel(int16_t x, int16_t y, uint16_t color) {
  if (x < 0 || x >= _width || y < 0 || y >= _height || !buffer) return;
  switch (rotation) {
    case 1: SWAP(x, y); x = WIDTH - x - 1; break;
    case 2: x = WIDTH - x - 1; y = HEIGHT - y - 1; break;
    case 3: SWAP(x, y); y = HEIGHT - y - 1; break;
  }
  uint8_t *p = &buffer[x + (y / 8) * WIDTH];
  uint8_t mask = (uint8_t)(1 << (y & 7));
  switch (color) {
    case SSD1306_WHITE: *p |= mask; break;
    case SSD1306_BLACK: *p &= ~mask; break;
    case SSD1306_INVERSE: *p ^= mask; break;
  }
}

bool Adafruit_SSD1306::getPixel(int16_t x, int16_t y) {
  if (x < 0 || x >= _width || y < 0 || y >= _height || !buffer) return false;
  switch (rotation) {
    case 1: SWAP(x, y); x = WIDTH - x - 1; break;
    case 2: x = WIDTH - x - 1; y = HEIGHT - y - 1; break;
    case 3: SWAP(x, y); y = HEIGHT - y - 1; break;
  }
  return buffer[x + (y / 8) * WIDTH] & (1 << (y & 7));
}
