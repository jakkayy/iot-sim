import type { DeviceDef } from "@esp32-sim/devices";
import type { ReactElement } from "react";

/** Live state pushed into a device's SVG once per animation frame. */
export interface VisualState {
  lit?: boolean;
  pressed?: boolean;
}

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
  if (type === "led") {
    g.querySelector("[data-glow]")?.setAttribute("opacity", state.lit ? "0.85" : "0");
    g.querySelector("[data-body]")?.setAttribute("fill", state.lit ? "#ff3b30" : "#7f1d1d");
  } else if (type === "button") {
    g.querySelector("[data-cap]")?.setAttribute("r", state.pressed ? "9" : "11");
  }
}
