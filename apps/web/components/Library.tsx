"use client";

import { useState } from "react";
import { devices } from "@esp32-sim/devices";
import { useCircuit } from "../lib/store";

export const DND_TYPE = "application/x-esp32-sim-device";

export function Library() {
  const [query, setQuery] = useState("");
  const addComponent = useCircuit((s) => s.addComponent);
  const list = Object.values(devices).filter((d) =>
    `${d.name} ${d.type} ${d.category}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <aside className="flex w-52 shrink-0 flex-col gap-2 border-r border-gray-300 bg-white p-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search parts"
        className="rounded border border-gray-300 px-2 py-1 text-sm"
        aria-label="Search parts"
      />
      <ul className="flex flex-col gap-1">
        {list.map((d) => (
          <li key={d.type}>
            <button
              draggable
              onDragStart={(e) => e.dataTransfer.setData(DND_TYPE, d.type)}
              onClick={() => addComponent(d.type, 200, 120)}
              className="w-full cursor-grab rounded border border-gray-200 px-2 py-1.5 text-left text-sm hover:bg-gray-100"
              data-testid={`lib-${d.type}`}
            >
              {d.name}
              <span className="ml-1 text-xs text-gray-500">{d.category}</span>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="text-sm text-gray-500">No parts found</li>}
      </ul>
      <p className="mt-auto text-xs text-gray-500">
        Drag onto the canvas or click to add. Click a pin, then another pin to wire.
      </p>
    </aside>
  );
}
