import {
  LCD_COLS,
  LCD_FLAG_BACKLIGHT,
  LCD_FLAG_CURSOR,
  LCD_FLAG_ON,
  LCD_ROWS,
  SSD1306_FLAG_INVERT,
  SSD1306_FLAG_ON,
  SSD1306_PAGES,
  SSD1306_WIDTH,
  type DeviceDef,
} from "@esp32-sim/devices";
import type { ReactElement } from "react";

/** Live state pushed into a device's SVG once per animation frame. */
export interface VisualState {
  /** LED brightness 0..1 (PWM duty when driven by PWM). */
  brightness?: number;
  pressed?: boolean;
  /** Live device outputs from the engine (angle, on, active, r/g/b, powered...). */
  outputs?: Record<string, number>;
  /** Control values (slider positions, toggles). */
  values?: Record<string, number>;
  /** Display frame bytes (see devices/models), or null. */
  frame?: Uint8Array | null;
}

const OFF = [0x7f, 0x1d, 0x1d];
const ON = [0xff, 0x3b, 0x30];
const mix = (t: number) =>
  "#" +
  OFF.map((o, i) => Math.round(o + (ON[i] - o) * t).toString(16).padStart(2, "0")).join("");

const GLOW = "#ff3b30";

function Esp32({ def }: { def: DeviceDef }) {
  return (
    <g>
      <rect x={0} y={0} width={def.width} height={def.height} rx={6} fill="#1f2937" stroke="#374151" />
      <rect x={34} y={6} width={42} height={16} rx={2} fill="#9ca3af" />
      <rect x={30} y={44} width={50} height={60} rx={3} fill="#111827" stroke="#4b5563" />
      <text x={55} y={78} fontSize={9} fill="#d1d5db" textAnchor="middle">
        ESP32
      </text>
      {def.pins.map((p) => (
        <text
          key={p.name}
          x={p.x === 0 ? 8 : def.width - 8}
          y={p.y + 3}
          fontSize={8}
          fill="#e5e7eb"
          textAnchor={p.x === 0 ? "start" : "end"}
          pointerEvents="none"
        >
          {p.label}
        </text>
      ))}
    </g>
  );
}

function Led() {
  return (
    <g>
      <line x1={10} y1={34} x2={10} y2={60} stroke="#9ca3af" strokeWidth={2} />
      <line x1={30} y1={34} x2={30} y2={60} stroke="#9ca3af" strokeWidth={2} />
      <circle data-glow cx={20} cy={20} r={26} fill={GLOW} opacity={0} />
      <circle data-body cx={20} cy={20} r={16} fill="#7f1d1d" stroke="#450a0a" strokeWidth={2} />
      <rect x={4} y={30} width={32} height={6} fill="#7f1d1d" />
    </g>
  );
}

function Resistor() {
  return (
    <g>
      <line x1={0} y1={8} x2={70} y2={8} stroke="#9ca3af" strokeWidth={2} />
      <rect x={14} y={1} width={42} height={14} rx={4} fill="#d6b88a" stroke="#a3875c" />
      <rect x={22} y={1} width={4} height={14} fill="#7c2d12" />
      <rect x={30} y={1} width={4} height={14} fill="#111827" />
      <rect x={38} y={1} width={4} height={14} fill="#b45309" />
    </g>
  );
}

function Button() {
  return (
    <g>
      <rect x={10} y={5} width={30} height={40} rx={3} fill="#374151" stroke="#1f2937" />
      <circle data-cap cx={25} cy={25} r={11} fill="#3b82f6" stroke="#1d4ed8" strokeWidth={2} />
      <line x1={0} y1={25} x2={10} y2={25} stroke="#9ca3af" strokeWidth={2} />
      <line x1={40} y1={25} x2={50} y2={25} stroke="#9ca3af" strokeWidth={2} />
    </g>
  );
}


function Potentiometer() {
  return (
    <g>
      <rect x={5} y={5} width={60} height={60} rx={6} fill="#1d4ed8" stroke="#1e3a8a" />
      <circle cx={35} cy={32} r={20} fill="#e5e7eb" stroke="#9ca3af" strokeWidth={2} />
      <line data-needle x1={35} y1={32} x2={35} y2={16} stroke="#111827" strokeWidth={3} strokeLinecap="round" />
    </g>
  );
}

function Ldr() {
  return (
    <g>
      <rect x={4} y={4} width={62} height={44} rx={4} fill="#065f46" stroke="#064e3b" />
      <circle data-cell cx={35} cy={26} r={14} fill="#a16207" stroke="#713f12" strokeWidth={2} />
      <path d="M26 26h6l2-5 3 10 2-5h4" fill="none" stroke="#fde68a" strokeWidth={1.5} />
    </g>
  );
}

function Pir() {
  return (
    <g>
      <rect x={4} y={4} width={62} height={62} rx={4} fill="#065f46" stroke="#064e3b" />
      <circle data-dome cx={35} cy={32} r={22} fill="#f3f4f6" stroke="#9ca3af" strokeWidth={2} />
      <circle cx={35} cy={32} r={9} fill="#d1d5db" />
    </g>
  );
}

function Relay() {
  return (
    <g>
      <rect x={0} y={0} width={110} height={70} rx={4} fill="#1e3a8a" stroke="#172554" />
      <rect x={30} y={10} width={50} height={36} rx={3} fill="#2563eb" stroke="#1d4ed8" />
      <line data-lever x1={92} y1={34} x2={108} y2={34} stroke="#e5e7eb" strokeWidth={3} />
      <circle data-led cx={18} cy={60} r={4} fill="#7f1d1d" />
      <text x={55} y={32} fontSize={9} fill="#dbeafe" textAnchor="middle">
        RELAY
      </text>
    </g>
  );
}

function Buzzer({ passive }: { passive: boolean }) {
  return (
    <g>
      <line x1={14} y1={40} x2={14} y2={56} stroke="#9ca3af" strokeWidth={2} />
      <line x1={36} y1={40} x2={36} y2={56} stroke="#9ca3af" strokeWidth={2} />
      <circle cx={25} cy={24} r={22} fill="#111827" stroke="#374151" strokeWidth={2} />
      <circle cx={25} cy={24} r={5} fill="#374151" />
      <g data-wave opacity={0} fill="none" stroke="#f59e0b" strokeWidth={2}>
        <path d="M50 14q6 10 0 20" />
        <path d="M56 8q10 16 0 32" />
      </g>
      <text x={25} y={50} fontSize={7} fill="#9ca3af" textAnchor="middle">
        {passive ? "passive" : "active"}
      </text>
    </g>
  );
}

function RgbLed() {
  return (
    <g>
      <line x1={8} y1={40} x2={8} y2={66} stroke="#9ca3af" strokeWidth={2} />
      <line x1={21} y1={40} x2={21} y2={66} stroke="#9ca3af" strokeWidth={2} />
      <line x1={35} y1={40} x2={35} y2={66} stroke="#9ca3af" strokeWidth={2} />
      <line x1={48} y1={40} x2={48} y2={66} stroke="#9ca3af" strokeWidth={2} />
      <circle data-glow cx={28} cy={22} r={26} fill="#ffffff" opacity={0} />
      <circle data-body cx={28} cy={22} r={18} fill="#374151" stroke="#1f2937" strokeWidth={2} />
    </g>
  );
}

function Servo() {
  return (
    <g>
      <rect x={20} y={10} width={74} height={40} rx={4} fill="#1d4ed8" stroke="#1e3a8a" />
      <circle cx={34} cy={30} r={9} fill="#e5e7eb" stroke="#9ca3af" />
      <g data-horn transform="rotate(-90 34 30)">
        <rect x={31} y={4} width={6} height={26} rx={3} fill="#f9fafb" stroke="#9ca3af" />
      </g>
      <text x={70} y={34} fontSize={9} fill="#dbeafe" textAnchor="middle">
        SERVO
      </text>
    </g>
  );
}

function Dht22() {
  return (
    <g>
      <rect x={4} y={4} width={52} height={62} rx={4} fill="#e5e7eb" stroke="#9ca3af" />
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={i} x1={10} y1={12 + i * 5} x2={50} y2={12 + i * 5} stroke="#9ca3af" />
      ))}
      <text data-text x={30} y={52} fontSize={8} fill="#111827" textAnchor="middle">
        DHT22
      </text>
      <text data-text2 x={30} y={61} fontSize={7} fill="#374151" textAnchor="middle" />
    </g>
  );
}

function Hcsr04() {
  return (
    <g>
      <rect x={0} y={0} width={100} height={46} rx={3} fill="#1d4ed8" stroke="#1e3a8a" />
      <circle cx={26} cy={22} r={15} fill="#9ca3af" stroke="#374151" strokeWidth={3} />
      <circle cx={74} cy={22} r={15} fill="#9ca3af" stroke="#374151" strokeWidth={3} />
      <text data-text x={50} y={40} fontSize={7} fill="#dbeafe" textAnchor="middle" />
    </g>
  );
}

function Ssd1306() {
  return (
    <g>
      <rect x={0} y={0} width={150} height={100} rx={4} fill="#111827" stroke="#374151" />
      <foreignObject x={11} y={10} width={128} height={64}>
        <canvas data-screen width={SSD1306_WIDTH} height={SSD1306_PAGES * 8} style={{ width: 128, height: 64, display: "block" }} />
      </foreignObject>
      <text x={75} y={90} fontSize={8} fill="#6b7280" textAnchor="middle">
        SSD1306 128x64
      </text>
    </g>
  );
}

function LcdI2c() {
  return (
    <g>
      <rect x={0} y={0} width={190} height={80} rx={4} fill="#14532d" stroke="#052e16" />
      <foreignObject x={15} y={14} width={160} height={36}>
        <canvas data-screen width={LCD_COLS * 10} height={LCD_ROWS * 18} style={{ width: 160, height: 36, display: "block" }} />
      </foreignObject>
    </g>
  );
}

/** Static drawing of a device (no pins; the canvas draws pins for hit-testing). */
export function DeviceBody({ def }: { def: DeviceDef }): ReactElement | null {
  switch (def.type) {
    case "esp32-devkit":
      return <Esp32 def={def} />;
    case "led":
      return <Led />;
    case "resistor":
      return <Resistor />;
    case "button":
      return <Button />;
    case "potentiometer":
      return <Potentiometer />;
    case "ldr":
      return <Ldr />;
    case "pir":
      return <Pir />;
    case "relay":
      return <Relay />;
    case "buzzer":
      return <Buzzer passive={false} />;
    case "buzzer-passive":
      return <Buzzer passive />;
    case "rgb-led":
      return <RgbLed />;
    case "servo":
      return <Servo />;
    case "dht22":
      return <Dht22 />;
    case "hcsr04":
      return <Hcsr04 />;
    case "ssd1306":
      return <Ssd1306 />;
    case "lcd-i2c":
      return <LcdI2c />;
    default:
      return (
        <rect width={def.width} height={def.height} fill="#374151" stroke="#9ca3af" strokeDasharray="4" />
      );
  }
}

/**
 * Imperatively update a rendered device. Called from requestAnimationFrame
 * so state changes never trigger a React re-render of the whole canvas.
 */
export function applyVisual(type: string, g: SVGGElement, state: VisualState): void {
  const out = state.outputs ?? {};
  const vals = state.values ?? {};
  const set = (sel: string, attr: string, v: string) => g.querySelector(sel)?.setAttribute(attr, v);
  switch (type) {
    case "led": {
      const b = Math.min(1, Math.max(0, state.brightness ?? 0));
      set("[data-glow]", "opacity", String(+(b * 0.85).toFixed(3)));
      set("[data-body]", "fill", mix(b));
      break;
    }
    case "button":
      set("[data-cap]", "r", state.pressed ? "9" : "11");
      break;
    case "potentiometer":
      set("[data-needle]", "transform", `rotate(${-135 + (vals.pos ?? 0.5) * 270} 35 32)`);
      break;
    case "ldr":
      set("[data-cell]", "fill", mixColor([0x44, 0x2a, 0x05], [0xfd, 0xe6, 0x8a], vals.light ?? 0.5));
      break;
    case "pir":
      set("[data-dome]", "fill", (vals.motion ?? 0) > 0.5 ? "#86efac" : "#f3f4f6");
      break;
    case "relay":
      set("[data-lever]", "transform", out.active ? "rotate(-25 92 34)" : "");
      set("[data-led]", "fill", out.active ? "#ef4444" : "#7f1d1d");
      break;
    case "buzzer":
    case "buzzer-passive":
      set("[data-wave]", "opacity", out.on ? "1" : "0");
      break;
    case "rgb-led": {
      const r = out.r ?? 0;
      const gr = out.g ?? 0;
      const b = out.b ?? 0;
      const lum = Math.max(r, gr, b);
      set("[data-body]", "fill", rgb(55 + 200 * r, 55 + 200 * gr, 55 + 200 * b));
      set("[data-glow]", "fill", rgb(255 * r, 255 * gr, 255 * b));
      set("[data-glow]", "opacity", String(+(lum * 0.7).toFixed(3)));
      break;
    }
    case "servo":
      set("[data-horn]", "transform", `rotate(${(out.angle ?? 0) - 90} 34 30)`);
      break;
    case "dht22": {
      const t = vals.temperature ?? 25;
      const h = vals.humidity ?? 50;
      const el = g.querySelector("[data-text2]");
      if (el) el.textContent = out.powered ? `${t.toFixed(1)}°C ${h.toFixed(0)}%` : "no power";
      break;
    }
    case "hcsr04": {
      const el = g.querySelector("[data-text]");
      if (el) el.textContent = out.powered ? `${(vals.distance ?? 100).toFixed(0)} cm` : "no power";
      break;
    }
    case "ssd1306":
      drawSsd1306(g.querySelector<HTMLCanvasElement>("[data-screen]"), state.frame ?? null, !!out.powered);
      break;
    case "lcd-i2c":
      drawLcd(g.querySelector<HTMLCanvasElement>("[data-screen]"), state.frame ?? null, !!out.powered);
      break;
  }
}

function mixColor(a: number[], b: number[], t: number): string {
  return rgb(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}
function rgb(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Cheap checksum so unchanged frames are not redrawn every animation frame. */
function signature(frame: Uint8Array | null, extra: number): number {
  let h = extra | 0;
  if (frame) for (let i = 0; i < frame.length; i++) h = (Math.imul(h, 31) + frame[i]) | 0;
  return h;
}

function drawSsd1306(canvas: HTMLCanvasElement | null, frame: Uint8Array | null, powered: boolean): void {
  if (!canvas) return;
  const sig = signature(frame, powered ? 1 : 0);
  if (canvas.dataset.sig === String(sig)) return;
  canvas.dataset.sig = String(sig);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!powered || !frame || !(frame[0] & SSD1306_FLAG_ON)) return;
  const invert = (frame[0] & SSD1306_FLAG_INVERT) !== 0;
  const contrast = 0.35 + 0.65 * (frame[1] / 255);
  const img = ctx.createImageData(SSD1306_WIDTH, SSD1306_PAGES * 8);
  for (let page = 0; page < SSD1306_PAGES; page++) {
    for (let x = 0; x < SSD1306_WIDTH; x++) {
      const byte = frame[2 + page * SSD1306_WIDTH + x];
      for (let bit = 0; bit < 8; bit++) {
        const on = (((byte >> bit) & 1) === 1) !== invert;
        const i = ((page * 8 + bit) * SSD1306_WIDTH + x) * 4;
        img.data[i] = on ? 150 * contrast : 0;
        img.data[i + 1] = on ? 220 * contrast : 0;
        img.data[i + 2] = on ? 255 * contrast : 0;
        img.data[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function drawLcd(canvas: HTMLCanvasElement | null, frame: Uint8Array | null, powered: boolean): void {
  if (!canvas) return;
  const sig = signature(frame, powered ? 1 : 0);
  if (canvas.dataset.sig === String(sig)) return;
  canvas.dataset.sig = String(sig);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const on = powered && !!frame && (frame[0] & LCD_FLAG_ON) !== 0;
  const light = powered && !!frame && (frame[0] & LCD_FLAG_BACKLIGHT) !== 0;
  ctx.fillStyle = light ? "#9bd16a" : "#3f5a2d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!on || !frame) return;
  const cw = canvas.width / LCD_COLS;
  const ch = canvas.height / LCD_ROWS;
  ctx.fillStyle = "#1a2e0d";
  ctx.font = `bold ${Math.floor(ch * 0.8)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < LCD_COLS * LCD_ROWS; i++) {
    const code = frame[2 + i];
    if (code <= 0x20 || code > 0x7e) continue;
    ctx.fillText(String.fromCharCode(code), (i % LCD_COLS) * cw + cw / 2, Math.floor(i / LCD_COLS) * ch + ch / 2);
  }
  if (frame[0] & LCD_FLAG_CURSOR && frame[1] !== 255) {
    ctx.fillRect((frame[1] % LCD_COLS) * cw + 1, Math.floor(frame[1] / LCD_COLS) * ch + ch - 3, cw - 2, 2);
  }
}
