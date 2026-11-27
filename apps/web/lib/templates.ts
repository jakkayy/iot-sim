import type { ControlValues, Wire } from "@esp32-sim/sim-core";
import type { PlacedView } from "./store";

export interface Template {
  id: string;
  name: string;
  description: string;
  components: PlacedView[];
  wires: Wire[];
  values?: ControlValues;
  /** The same program in both languages. */
  code: { py: string; ino: string };
}

const ESP: PlacedView = { id: "esp1", type: "esp32-devkit", x: 60, y: 20 };
const wire = (n: number, a: string, b: string): Wire => ({ id: `w${n}`, a, b });
const wires = (pairs: Array<[string, string]>): Wire[] => pairs.map(([a, b], i) => wire(i + 1, a, b));

export const TEMPLATES: Template[] = [
  {
    id: "blink",
    name: "Blink",
    description: "Blink an LED on GPIO2 through a resistor.",
    components: [
      ESP,
      { id: "r1", type: "resistor", x: 250, y: 108 },
      { id: "led1", type: "led", x: 350, y: 50 },
    ],
    wires: wires([
      ["esp1:GPIO2", "r1:1"],
      ["r1:2", "led1:A"],
      ["led1:K", "esp1:GND.2"],
    ]),
    code: {
      py: `from machine import Pin
import time

led = Pin(2, Pin.OUT)

while True:
    led.value(1)
    time.sleep(0.5)
    led.value(0)
    time.sleep(0.5)
`,
      ino: `void setup() {
  pinMode(2, OUTPUT);
}

void loop() {
  digitalWrite(2, HIGH);
  delay(500);
  digitalWrite(2, LOW);
  delay(500);
}
`,
    },
  },
  {
    id: "button",
    name: "Button",
    description: "Hold the button to light the LED (input with pull-up).",
    components: [
      ESP,
      { id: "r1", type: "resistor", x: 250, y: 108 },
      { id: "led1", type: "led", x: 350, y: 50 },
      { id: "btn1", type: "button", x: 260, y: 210 },
    ],
    wires: wires([
      ["esp1:GPIO2", "r1:1"],
      ["r1:2", "led1:A"],
      ["led1:K", "esp1:GND.2"],
      ["esp1:GPIO4", "btn1:1"],
      ["btn1:2", "esp1:GND.2"],
    ]),
    code: {
      py: `from machine import Pin
import time

led = Pin(2, Pin.OUT)
button = Pin(4, Pin.IN, Pin.PULL_UP)  # pressed reads 0

while True:
    led.value(0 if button.value() else 1)
    time.sleep_ms(10)
`,
      ino: `const int LED = 2;
const int BUTTON = 4;

void setup() {
  pinMode(LED, OUTPUT);
  pinMode(BUTTON, INPUT_PULLUP);  // pressed reads LOW
}

void loop() {
  digitalWrite(LED, digitalRead(BUTTON) ? LOW : HIGH);
  delay(10);
}
`,
    },
  },
  {
    id: "dimmer",
    name: "Potentiometer dimmer",
    description: "Turn the knob (Controls tab) to change the LED brightness with PWM.",
    components: [
      ESP,
      { id: "r1", type: "resistor", x: 250, y: 108 },
      { id: "led1", type: "led", x: 350, y: 50 },
      { id: "pot1", type: "potentiometer", x: 250, y: 220 },
    ],
    wires: wires([
      ["esp1:GPIO2", "r1:1"],
      ["r1:2", "led1:A"],
      ["led1:K", "esp1:GND.2"],
      ["pot1:VCC", "esp1:3V3"],
      ["pot1:GND", "esp1:GND.2"],
      ["pot1:SIG", "esp1:GPIO32"],
    ]),
    values: { pot1: { pos: 0.7 } },
    code: {
      py: `from machine import Pin, ADC, PWM
import time

pot = ADC(Pin(32))
led = PWM(Pin(2), freq=1000)

while True:
    led.duty_u16(pot.read_u16())
    time.sleep_ms(20)
`,
      ino: `const int LED = 2;
const int POT = 32;

void setup() {
  ledcAttach(LED, 1000, 12);  // 1 kHz, 12-bit duty
}

void loop() {
  ledcWrite(LED, analogRead(POT));  // ADC is 12-bit too
  delay(20);
}
`,
    },
  },
  {
    id: "dht22-oled",
    name: "DHT22 to OLED",
    description: "Read temperature and humidity and show them on the OLED.",
    components: [
      ESP,
      { id: "dht1", type: "dht22", x: 260, y: 30 },
      { id: "oled1", type: "ssd1306", x: 330, y: 150 },
    ],
    wires: wires([
      ["dht1:VCC", "esp1:3V3"],
      ["dht1:GND", "esp1:GND.2"],
      ["dht1:DATA", "esp1:GPIO4"],
      ["oled1:VCC", "esp1:3V3"],
      ["oled1:GND", "esp1:GND.2"],
      ["oled1:SDA", "esp1:GPIO21"],
      ["oled1:SCL", "esp1:GPIO22"],
    ]),
    code: {
      py: `from machine import Pin, I2C
from ssd1306 import SSD1306_I2C
import dht
import time

i2c = I2C(0, scl=Pin(22), sda=Pin(21))
oled = SSD1306_I2C(128, 64, i2c)
sensor = dht.DHT22(Pin(4))

while True:
    sensor.measure()
    oled.fill(0)
    oled.text("Temp: %.1f C" % sensor.temperature(), 0, 8)
    oled.text("Hum:  %.1f %%" % sensor.humidity(), 0, 24)
    oled.show()
    print(sensor.temperature(), sensor.humidity())
    time.sleep(2)
`,
      ino: `#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <DHT.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);
DHT dht(4, DHT22);

void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  dht.begin();
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 8);
  display.print("Temp: ");
  display.print(t, 1);
  display.println(" C");
  display.setCursor(0, 24);
  display.print("Hum:  ");
  display.print(h, 1);
  display.println(" %");
  display.display();
  Serial.printf("%.2f %.2f\\n", t, h);
  delay(2000);
}
`,
    },
  },
  {
    id: "pir-relay",
    name: "PIR to relay",
    description: "Motion (Controls tab) switches a relay that powers a lamp LED.",
    components: [
      ESP,
      { id: "pir1", type: "pir", x: 260, y: 30 },
      { id: "relay1", type: "relay", x: 260, y: 180 },
      { id: "r1", type: "resistor", x: 420, y: 232 },
      { id: "led1", type: "led", x: 520, y: 170 },
    ],
    wires: wires([
      ["pir1:VCC", "esp1:3V3"],
      ["pir1:GND", "esp1:GND.2"],
      ["pir1:OUT", "esp1:GPIO4"],
      ["relay1:VCC", "esp1:3V3"],
      ["relay1:GND", "esp1:GND.2"],
      ["relay1:IN", "esp1:GPIO5"],
      ["relay1:COM", "esp1:3V3"],
      ["relay1:NO", "r1:1"],
      ["r1:2", "led1:A"],
      ["led1:K", "esp1:GND.2"],
    ]),
    code: {
      py: `from machine import Pin
import time

pir = Pin(4, Pin.IN)
relay = Pin(5, Pin.OUT)

while True:
    relay.value(pir.value())
    time.sleep_ms(50)
`,
      ino: `const int PIR = 4;
const int RELAY = 5;

void setup() {
  pinMode(PIR, INPUT);
  pinMode(RELAY, OUTPUT);
}

void loop() {
  digitalWrite(RELAY, digitalRead(PIR));
  delay(50);
}
`,
    },
  },
  {
    id: "distance-lcd",
    name: "Distance to LCD",
    description: "HC-SR04 distance (Controls tab) shown on a 16x2 LCD.",
    components: [
      ESP,
      { id: "us1", type: "hcsr04", x: 260, y: 30 },
      { id: "lcd1", type: "lcd-i2c", x: 280, y: 170 },
    ],
    wires: wires([
      ["us1:VCC", "esp1:5V"],
      ["us1:GND", "esp1:GND.2"],
      ["us1:TRIG", "esp1:GPIO5"],
      ["us1:ECHO", "esp1:GPIO18"],
      ["lcd1:VCC", "esp1:3V3"],
      ["lcd1:GND", "esp1:GND.2"],
      ["lcd1:SDA", "esp1:GPIO21"],
      ["lcd1:SCL", "esp1:GPIO22"],
    ]),
    code: {
      py: `from machine import Pin, I2C, time_pulse_us
from i2c_lcd import I2cLcd
import time

i2c = I2C(0, scl=Pin(22), sda=Pin(21))
lcd = I2cLcd(i2c, 0x27, 2, 16)
trig = Pin(5, Pin.OUT)
echo = Pin(18, Pin.IN)

while True:
    trig.value(1)
    time.sleep_us(10)
    trig.value(0)
    us = time_pulse_us(echo, 1, 30000)
    lcd.clear()
    if us < 0:
        lcd.putstr("No echo")
    else:
        lcd.putstr("Distance:")
        lcd.move_to(0, 1)
        lcd.putstr("%.1f cm" % (us / 58))
        print("%.1f cm" % (us / 58))
    time.sleep_ms(500)
`,
      ino: `#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);
const int TRIG = 5;
const int ECHO = 18;

void setup() {
  Serial.begin(115200);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  lcd.init();
  lcd.backlight();
}

void loop() {
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long us = pulseIn(ECHO, HIGH, 30000);
  lcd.clear();
  if (us == 0) {
    lcd.print("No echo");
  } else {
    lcd.print("Distance:");
    lcd.setCursor(0, 1);
    lcd.print(us / 58.0, 1);
    lcd.print(" cm");
    Serial.printf("%.1f cm\\n", us / 58.0);
  }
  delay(500);
}
`,
    },
  },
];

export const templateById = (id: string): Template | undefined => TEMPLATES.find((t) => t.id === id);
