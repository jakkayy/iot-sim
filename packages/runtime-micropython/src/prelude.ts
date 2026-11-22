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
