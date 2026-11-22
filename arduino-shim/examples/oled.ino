#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
  Wire.begin(21, 22);
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Hello OLED");
  display.drawRect(0, 20, 60, 20, SSD1306_WHITE);
  display.fillCircle(100, 30, 8, SSD1306_WHITE);
  display.display();
}

void loop() {
  delay(1000);
}
