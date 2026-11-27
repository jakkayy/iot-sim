/**
 * Python-side modules that mirror the ESP32 MicroPython API and talk to the
 * simulator through the `_hal` JS module (see session.ts).
 * Installed into sys.modules at boot, before user code runs.
 */
export const PRELUDE = String.raw`
import sys, _hal
_time = __import__('time')

class _NS:
    pass

_irq = {}
_timers = {}
_timer_seq = 0

def _dispatch():
    s = _hal.take()
    if not s:
        return
    for tok in s.split(','):
        if tok[0] == 'p':
            h = _irq.get(int(tok[1:]))
            if h:
                h[0](h[1])
        else:
            h = _timers.get(int(tok[1:]))
            if h:
                h[0](h[1])

def _sleep(ms):
    end = _hal.millis() + ms
    _dispatch()
    while True:
        rem = end - _hal.millis()
        if rem <= 0:
            break
        _hal.delay_ms(rem)
        _dispatch()

class Pin:
    IN = 1
    OUT = 3
    OPEN_DRAIN = 7
    PULL_UP = 2
    PULL_DOWN = 1
    IRQ_RISING = 1
    IRQ_FALLING = 2

    def __init__(self, id, mode=-1, pull=-1, *, value=None):
        self.id = int(id)
        self._mode = -1
        self._pull = -1
        if mode != -1 or pull != -1 or value is not None:
            self.init(mode, pull, value=value)

    def init(self, mode=-1, pull=-1, *, value=None):
        if mode is None:
            mode = -1
        if pull is None:
            pull = -1
        if mode != -1:
            self._mode = mode
        if pull != -1:
            self._pull = pull
        m = self._mode
        if m == Pin.OUT:
            sim = 2
        elif m == Pin.OPEN_DRAIN:
            sim = 4
        elif self._pull == Pin.PULL_UP:
            sim = 3
        elif self._pull == Pin.PULL_DOWN:
            sim = 5
        else:
            sim = 1
        _hal.pin_mode(self.id, sim)
        if value is not None:
            _hal.write(self.id, 1 if value else 0)

    def value(self, x=None):
        _dispatch()
        if x is None:
            return _hal.read(self.id)
        _hal.write(self.id, 1 if x else 0)

    __call__ = value

    def on(self):
        self.value(1)

    def off(self):
        self.value(0)

    def irq(self, handler=None, trigger=3, *args, **kwargs):
        if handler is None:
            _irq.pop(self.id, None)
            _hal.irq(self.id, 0)
        else:
            _irq[self.id] = (handler, self)
            _hal.irq(self.id, trigger)

    def __str__(self):
        return 'Pin(' + str(self.id) + ')'

def _pin_id(p):
    return p.id if isinstance(p, Pin) else int(p)

class ADC:
    ATTN_0DB = 0
    ATTN_2_5DB = 1
    ATTN_6DB = 2
    ATTN_11DB = 3
    WIDTH_9BIT = 0
    WIDTH_10BIT = 1
    WIDTH_11BIT = 2
    WIDTH_12BIT = 3

    def __init__(self, pin, *, atten=None):
        self._id = _pin_id(pin)

    def read(self):
        return _hal.adc(self._id)

    def read_u16(self):
        return _hal.adc(self._id) * 16

    def read_uv(self):
        return _hal.adc(self._id) * 3300000 // 4095

    def atten(self, a):
        pass

    def width(self, w):
        pass

class PWM:
    def __init__(self, pin, freq=5000, duty=None, duty_u16=None):
        self._id = _pin_id(pin)
        self._freq = freq
        self._duty = 0
        if duty is not None:
            self._duty = duty * 64
        if duty_u16 is not None:
            self._duty = duty_u16
        self._apply()

    def _apply(self):
        _hal.pwm(self._id, self._freq, self._duty)

    def freq(self, f=None):
        if f is None:
            return self._freq
        self._freq = f
        self._apply()

    def duty(self, d=None):
        if d is None:
            return self._duty // 64
        self._duty = d * 64
        self._apply()

    def duty_u16(self, d=None):
        if d is None:
            return self._duty
        self._duty = d
        self._apply()

    def deinit(self):
        _hal.pwm_stop(self._id)

class Timer:
    ONE_SHOT = 0
    PERIODIC = 1

    def __init__(self, id=-1, **kwargs):
        global _timer_seq
        if id == -1:
            _timer_seq += 1
            id = 100 + _timer_seq
        self.id = id
        if kwargs:
            self.init(**kwargs)

    def init(self, *, mode=1, period=-1, callback=None, freq=-1, **kwargs):
        if freq != -1:
            period = 1000 / freq
        _timers[self.id] = (callback, self)
        _hal.timer(self.id, period, mode == 1)

    def deinit(self):
        _timers.pop(self.id, None)
        _hal.timer_stop(self.id)

machine = _NS()
machine.Pin = Pin
machine.ADC = ADC
machine.PWM = PWM
machine.Timer = Timer
machine.freq = lambda hz=None: 240000000
machine.idle = lambda: _sleep(1)
machine.unique_id = lambda: b'\xde\xad\xbe\xef\x00\x01'
machine.disable_irq = lambda: 0
machine.enable_irq = lambda state=0: None

def _reset():
    raise SystemExit

machine.reset = _reset
machine.soft_reset = _reset
sys.modules['machine'] = machine

import binascii

def _hex(buf):
    return binascii.hexlify(bytes(buf)).decode()

class _I2CBase:
    def _setup(self, scl, sda):
        self._scl = _pin_id(scl)
        self._sda = _pin_id(sda)

    def scan(self):
        s = _hal.i2c_scan(self._sda, self._scl)
        return [int(x) for x in s.split(',')] if s else []

    def writeto(self, addr, buf, stop=True):
        if not _hal.i2c_write(self._sda, self._scl, addr, _hex(buf)):
            raise OSError(19)
        return len(buf)

    def readfrom(self, addr, nbytes, stop=True):
        r = _hal.i2c_read(self._sda, self._scl, addr, nbytes)
        if not r:
            raise OSError(19)
        return binascii.unhexlify(r)

    def readfrom_into(self, addr, buf, stop=True):
        data = self.readfrom(addr, len(buf))
        for i in range(len(buf)):
            buf[i] = data[i]

    def writeto_mem(self, addr, memaddr, buf, *, addrsize=8):
        self.writeto(addr, bytes([memaddr]) + bytes(buf))

    def readfrom_mem(self, addr, memaddr, nbytes, *, addrsize=8):
        self.writeto(addr, bytes([memaddr]))
        return self.readfrom(addr, nbytes)

class I2C(_I2CBase):
    def __init__(self, id=-1, *, scl, sda, freq=400000):
        self._setup(scl, sda)

class SoftI2C(_I2CBase):
    def __init__(self, scl, sda, *, freq=400000, timeout=50000):
        self._setup(scl, sda)

machine.I2C = I2C
machine.SoftI2C = SoftI2C
machine.time_pulse_us = lambda pin, level, timeout_us=1000000: _hal.pulse_in(_pin_id(pin), level, timeout_us)

class _DHT:
    def __init__(self, pin):
        self._pin = pin
        self._t = 0.0
        self._h = 0.0

    def measure(self):
        r = _hal.sensor_read('dht22', _pin_id(self._pin))
        if not r:
            raise OSError(110)
        t, h = r.split(',')
        self._t = float(t)
        self._h = float(h)

    def temperature(self):
        return self._t

    def humidity(self):
        return self._h

class DHT22(_DHT):
    pass

class DHT11(_DHT):
    def temperature(self):
        return int(self._t)

    def humidity(self):
        return int(self._h)

dht = _NS()
dht.DHT22 = DHT22
dht.DHT11 = DHT11
sys.modules['dht'] = dht

import framebuf

class SSD1306_I2C(framebuf.FrameBuffer):
    def __init__(self, width, height, i2c, addr=0x3C, external_vcc=False):
        self.i2c = i2c
        self.addr = addr
        self.width = width
        self.height = height
        self.external_vcc = external_vcc
        self.pages = height // 8
        self.buffer = bytearray(self.pages * width)
        super().__init__(self.buffer, width, height, framebuf.MONO_VLSB)
        self.init_display()

    def write_cmd(self, cmd):
        self.i2c.writeto(self.addr, bytearray([0x80, cmd]))

    def write_data(self, buf):
        self.i2c.writeto(self.addr, b'\x40' + bytes(buf))

    def init_display(self):
        for cmd in (
            0xAE, 0x20, 0x00, 0x40, 0xA1, 0xA8, self.height - 1, 0xC8, 0xD3, 0x00,
            0xDA, 0x02 if self.width > 2 * self.height else 0x12, 0xD5, 0x80,
            0xD9, 0x22 if self.external_vcc else 0xF1, 0xDB, 0x30, 0x81, 0xFF,
            0xA4, 0xA6, 0x8D, 0x10 if self.external_vcc else 0x14, 0xAF,
        ):
            self.write_cmd(cmd)
        self.fill(0)
        self.show()

    def poweroff(self):
        self.write_cmd(0xAE)

    def poweron(self):
        self.write_cmd(0xAF)

    def contrast(self, contrast):
        self.write_cmd(0x81)
        self.write_cmd(contrast)

    def invert(self, invert):
        self.write_cmd(0xA6 | (invert & 1))

    def show(self):
        x0 = 0
        x1 = self.width - 1
        if self.width == 64:
            x0 += 32
            x1 += 32
        self.write_cmd(0x21)
        self.write_cmd(x0)
        self.write_cmd(x1)
        self.write_cmd(0x22)
        self.write_cmd(0)
        self.write_cmd(self.pages - 1)
        self.write_data(self.buffer)

ssd1306 = _NS()
ssd1306.SSD1306_I2C = SSD1306_I2C
sys.modules['ssd1306'] = ssd1306

class LcdApi:
    LCD_CLR = 0x01
    LCD_HOME = 0x02
    LCD_ENTRY_MODE = 0x04
    LCD_ENTRY_INC = 0x02
    LCD_ON_CTRL = 0x08
    LCD_ON_DISPLAY = 0x04
    LCD_ON_CURSOR = 0x02
    LCD_ON_BLINK = 0x01
    LCD_FUNCTION = 0x20
    LCD_FUNCTION_2LINES = 0x08
    LCD_DDRAM = 0x80
    LCD_CGRAM = 0x40

    def __init__(self, num_lines, num_columns):
        self.num_lines = min(num_lines, 4)
        self.num_columns = min(num_columns, 40)
        self.cursor_x = 0
        self.cursor_y = 0
        self.implied_newline = False
        self.backlight = True
        self.display_off()
        self.backlight_on()
        self.clear()
        self.hal_write_command(self.LCD_ENTRY_MODE | self.LCD_ENTRY_INC)
        self.hide_cursor()
        self.display_on()

    def clear(self):
        self.hal_write_command(self.LCD_CLR)
        self.hal_write_command(self.LCD_HOME)
        self.cursor_x = 0
        self.cursor_y = 0

    def show_cursor(self):
        self.hal_write_command(self.LCD_ON_CTRL | self.LCD_ON_DISPLAY | self.LCD_ON_CURSOR)

    def hide_cursor(self):
        self.hal_write_command(self.LCD_ON_CTRL | self.LCD_ON_DISPLAY)

    def blink_cursor_on(self):
        self.hal_write_command(self.LCD_ON_CTRL | self.LCD_ON_DISPLAY | self.LCD_ON_CURSOR | self.LCD_ON_BLINK)

    def blink_cursor_off(self):
        self.show_cursor()

    def display_on(self):
        self.hal_write_command(self.LCD_ON_CTRL | self.LCD_ON_DISPLAY)

    def display_off(self):
        self.hal_write_command(self.LCD_ON_CTRL)

    def backlight_on(self):
        self.backlight = True
        self.hal_backlight_on()

    def backlight_off(self):
        self.backlight = False
        self.hal_backlight_off()

    def move_to(self, cursor_x, cursor_y):
        self.cursor_x = cursor_x
        self.cursor_y = cursor_y
        addr = cursor_x & 0x3F
        if cursor_y & 1:
            addr += 0x40
        if cursor_y & 2:
            addr += self.num_columns
        self.hal_write_command(self.LCD_DDRAM | addr)

    def putchar(self, char):
        if char == '\n':
            if self.implied_newline:
                pass
            else:
                self.cursor_x = self.num_columns
        else:
            self.hal_write_data(ord(char))
            self.cursor_x += 1
        if self.cursor_x >= self.num_columns:
            self.cursor_x = 0
            self.cursor_y += 1
            self.implied_newline = (char != '\n')
        if self.cursor_y >= self.num_lines:
            self.cursor_y = 0
        self.move_to(self.cursor_x, self.cursor_y)

    def putstr(self, string):
        for char in string:
            self.putchar(char)

    def custom_char(self, location, charmap):
        location &= 0x7
        self.hal_write_command(self.LCD_CGRAM | (location << 3))
        for i in range(8):
            self.hal_write_data(charmap[i])
        self.move_to(self.cursor_x, self.cursor_y)

class I2cLcd(LcdApi):
    def __init__(self, i2c, i2c_addr, num_lines, num_columns):
        self.i2c = i2c
        self.i2c_addr = i2c_addr
        self.backlight = True
        self.i2c.writeto(self.i2c_addr, bytearray([0]))
        _sleep(20)
        self.hal_write_init_nibble(0x30)
        _sleep(5)
        self.hal_write_init_nibble(0x30)
        _sleep(1)
        self.hal_write_init_nibble(0x30)
        _sleep(1)
        self.hal_write_init_nibble(0x20)
        _sleep(1)
        cmd = self.LCD_FUNCTION
        if num_lines > 1:
            cmd |= self.LCD_FUNCTION_2LINES
        self.hal_write_command(cmd)
        super().__init__(num_lines, num_columns)

    def hal_write_init_nibble(self, nibble):
        byte = ((nibble >> 4) & 0x0F) << 4
        self.i2c.writeto(self.i2c_addr, bytearray([byte | 0x04]))
        self.i2c.writeto(self.i2c_addr, bytearray([byte]))

    def hal_backlight_on(self):
        self.i2c.writeto(self.i2c_addr, bytearray([1 << 3]))

    def hal_backlight_off(self):
        self.i2c.writeto(self.i2c_addr, bytearray([0]))

    def _write_byte(self, value, rs):
        bl = (1 << 3) if self.backlight else 0
        byte = bl | rs | (((value >> 4) & 0x0F) << 4)
        self.i2c.writeto(self.i2c_addr, bytearray([byte | 0x04]))
        self.i2c.writeto(self.i2c_addr, bytearray([byte]))
        byte = bl | rs | ((value & 0x0F) << 4)
        self.i2c.writeto(self.i2c_addr, bytearray([byte | 0x04]))
        self.i2c.writeto(self.i2c_addr, bytearray([byte]))

    def hal_write_command(self, cmd):
        self._write_byte(cmd, 0)
        if cmd <= 3:
            _sleep(5)

    def hal_write_data(self, data):
        self._write_byte(data, 1)

lcd_api = _NS()
lcd_api.LcdApi = LcdApi
sys.modules['lcd_api'] = lcd_api
i2c_lcd = _NS()
i2c_lcd.I2cLcd = I2cLcd
sys.modules['i2c_lcd'] = i2c_lcd

import json

class _WLAN:
    def __init__(self, iface):
        self._iface = iface
        self._active = False

    def active(self, is_active=None):
        if is_active is None:
            return self._active
        self._active = bool(is_active)
        return self._active

    def connect(self, ssid=None, key=None, *args, **kwargs):
        if not self._active:
            raise OSError('Wifi Unknown Error 0x0102')
        _hal.wifi_begin(ssid or '')

    def disconnect(self):
        _hal.wifi_disconnect()

    def isconnected(self):
        return self._iface == 0 and _hal.wifi_status() == 'connected'

    def status(self):
        st = _hal.wifi_status()
        if st == 'connected':
            return 1010
        if st == 'connecting':
            return 1001
        if st == 'failed':
            return 201
        return 1000

    def ifconfig(self, config=None):
        if self.isconnected():
            return (_hal.wifi_ip(), '255.255.255.0', '192.168.1.1', '8.8.8.8')
        return ('0.0.0.0', '0.0.0.0', '0.0.0.0', '0.0.0.0')

    def scan(self):
        return [(b'simulated-wifi', b'\x00\x11\x22\x33\x44\x55', 6, -45, 3, False)]

    def config(self, *args, **kwargs):
        if args and args[0] == 'mac':
            return b'\x24\x6f\x28\x00\x00\x01'
        if args and args[0] == 'ssid':
            return _hal.wifi_ssid()

network = _NS()
network.STA_IF = 0
network.AP_IF = 1
network.STAT_IDLE = 1000
network.STAT_CONNECTING = 1001
network.STAT_GOT_IP = 1010
network.STAT_NO_AP_FOUND = 201
network.WLAN = _WLAN
network.hostname = lambda name=None: 'esp32'
sys.modules['network'] = network

class MQTTException(Exception):
    pass

def _need_wifi():
    if _hal.wifi_status() != 'connected':
        raise OSError(113)

class MQTTClient:
    def __init__(self, client_id, server, port=0, user=None, password=None, keepalive=0, ssl=None, ssl_params={}):
        self.client_id = client_id
        self.server = server
        self.port = port if port else 1883
        self.user = user
        self.pswd = password
        self.keepalive = keepalive
        self.cb = None
        self._up = False

    def set_callback(self, f):
        self.cb = f

    def set_last_will(self, topic, msg, retain=False, qos=0):
        pass

    def connect(self, clean_session=True):
        _need_wifi()
        rc = _hal.mqtt_connect(self.server, self.port, self.client_id, self.user or '', self.pswd or '', self.keepalive)
        if rc != 0:
            raise MQTTException(rc)
        self._up = True
        return False

    def disconnect(self):
        _hal.mqtt_disconnect()
        self._up = False

    def ping(self):
        pass

    def publish(self, topic, msg, retain=False, qos=0):
        if not _hal.mqtt_connected():
            raise OSError(104)
        if isinstance(topic, str):
            topic = topic.encode()
        if isinstance(msg, str):
            msg = msg.encode()
        _hal.mqtt_publish(_hex(topic), _hex(msg), bool(retain), qos)

    def subscribe(self, topic, qos=0):
        if not _hal.mqtt_connected():
            raise OSError(104)
        if isinstance(topic, str):
            topic = topic.encode()
        if not _hal.mqtt_subscribe(_hex(topic), qos):
            raise MQTTException(128)

    def _deliver(self):
        r = _hal.mqtt_poll()
        if not r:
            return False
        t, m = r.split(':')
        if self.cb:
            self.cb(binascii.unhexlify(t), binascii.unhexlify(m))
        return True

    def check_msg(self, attempts=2):
        _dispatch()
        return self._deliver()

    def wait_msg(self):
        while not self._deliver():
            _sleep(10)

mqtt_simple = _NS()
mqtt_simple.MQTTClient = MQTTClient
mqtt_simple.MQTTException = MQTTException
umqtt = _NS()
umqtt.simple = mqtt_simple
sys.modules['umqtt'] = umqtt
sys.modules['umqtt.simple'] = mqtt_simple

class _Response:
    def __init__(self, status, body):
        self.status_code = status
        self.reason = b'OK' if 200 <= status < 300 else b'Error'
        self._body = body

    @property
    def content(self):
        return self._body.encode()

    @property
    def text(self):
        return self._body

    def json(self):
        return json.loads(self._body)

    def close(self):
        pass

def _request(method, url, data=None, json_data=None, headers={}, timeout=10):
    _need_wifi()
    h = dict(headers)
    body = ''
    if json_data is not None:
        body = json.dumps(json_data)
        h['Content-Type'] = 'application/json'
    elif data is not None:
        body = data if isinstance(data, str) else bytes(data).decode()
    r = _hal.http(method, url, json.dumps(h), body, int(timeout * 1000))
    res = json.loads(r)
    if res.get('error'):
        raise OSError(res['error'])
    return _Response(res['status'], res['body'])

def _get(url, headers={}, timeout=10):
    return _request('GET', url, None, None, headers, timeout)

def _post(url, data=None, json=None, headers={}, timeout=10):
    return _request('POST', url, data, json, headers, timeout)

def _put(url, data=None, json=None, headers={}, timeout=10):
    return _request('PUT', url, data, json, headers, timeout)

def _delete(url, headers={}, timeout=10):
    return _request('DELETE', url, None, None, headers, timeout)

requests = _NS()
requests.get = _get
requests.post = _post
requests.put = _put
requests.delete = _delete
requests.request = lambda method, url, data=None, json=None, headers={}, timeout=10: _request(method, url, data, json, headers, timeout)
sys.modules['urequests'] = requests
sys.modules['requests'] = requests

class _Time:
    def __getattr__(self, name):
        return getattr(_time, name)

    def sleep(self, s):
        _sleep(s * 1000)

    def sleep_ms(self, ms):
        _sleep(ms)

    def sleep_us(self, us):
        _sleep(us / 1000)

    def ticks_ms(self):
        _dispatch()
        return int(_hal.millis()) & 0x3FFFFFFF

    def ticks_us(self):
        _dispatch()
        return int(_hal.micros()) & 0x3FFFFFFF

    def ticks_cpu(self):
        return self.ticks_us()

    def ticks_diff(self, a, b):
        return ((a - b + 0x20000000) & 0x3FFFFFFF) - 0x20000000

    def ticks_add(self, t, d):
        return (t + d) & 0x3FFFFFFF

sys.modules['time'] = _Time()
`;
