"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SerialLog } from "../lib/serial";

const ROW = 16;
const OVERSCAN = 10;

/** Virtualized: only the visible rows exist in the DOM, so 5000 lines stay cheap. */
export function SerialMonitor({ log }: { log: SerialLog }) {
  const lines = useSyncExternalStore(log.subscribe, log.getSnapshot, log.getSnapshot);
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [view, setView] = useState({ top: 0, height: 200 });

  const update = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - ROW * 2;
    setView({ top: el.scrollTop, height: el.clientHeight });
  };

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) {
      el.scrollTop = el.scrollHeight;
      setView({ top: el.scrollTop, height: el.clientHeight });
    }
  }, [lines]);

  const first = Math.max(0, Math.floor(view.top / ROW) - OVERSCAN);
  const last = Math.min(lines.length, Math.ceil((view.top + view.height) / ROW) + OVERSCAN);

  return (
    <div
      ref={ref}
      onScroll={update}
      data-testid="serial"
      className="h-full overflow-auto bg-gray-950 font-mono text-xs text-gray-100"
    >
      <div style={{ height: lines.length * ROW, position: "relative" }}>
        {lines.slice(first, last).map((line, i) => (
          <div
            key={first + i}
            data-serial-line
            className="absolute left-0 right-0 truncate px-2"
            style={{ top: (first + i) * ROW, height: ROW, lineHeight: `${ROW}px` }}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
