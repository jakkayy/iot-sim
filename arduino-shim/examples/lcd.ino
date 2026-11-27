#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

void setup() {
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Hello, LCD!");
  lcd.setCursor(0, 1);
  lcd.print(42);
  lcd.print(" ");
  lcd.print(3.5);
}

void loop() {
  delay(1000);
}
