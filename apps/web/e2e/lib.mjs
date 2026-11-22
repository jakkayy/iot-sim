// Tiny E2E helpers: start `next start`, launch Chrome via playwright-core.
// CHROME_PATH overrides the browser binary (default: system google-chrome).
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

export const PORT = Number(process.env.E2E_PORT ?? 3111);
export const BASE = `http://localhost:${PORT}`;

export async function startServer() {
  const proc = spawn("bunx", ["next", "start", "-p", String(PORT)], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
    detached: true,
  });
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`${BASE}/sim`)).ok) return () => process.kill(-proc.pid);
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  process.kill(-proc.pid);
  throw new Error("server did not start");
}

export async function openPage() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/sim?e2e`, { waitUntil: "networkidle" });
  return { browser, page, errors };
}

export function checker() {
  let failed = 0;
  const ok = (name, cond, extra = "") => {
    if (!cond) failed++;
    console.log(cond ? "PASS" : "FAIL", name, extra);
  };
  return { ok, done: () => process.exit(failed ? 1 : 0) };
}
