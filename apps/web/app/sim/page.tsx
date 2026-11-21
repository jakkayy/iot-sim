"use client";

import { useEffect, useState } from "react";

export default function SimPage() {
  const [isolated, setIsolated] = useState<boolean | null>(null);
  useEffect(() => setIsolated(window.crossOriginIsolated), []);
  return (
    <main style={{ padding: 24 }}>
      <h1>Simulator</h1>
      <p>crossOriginIsolated: {String(isolated)}</p>
    </main>
  );
}
