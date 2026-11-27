import { checker, openPage, startServer } from "./lib.mjs";

const stop = await startServer();
const { ok, done } = checker();
const { browser, page, errors } = await openPage();

const ledFill = () => page.$eval("[data-component=led1] [data-body]", (e) => e.getAttribute("fill"));
const sample = async (n, every) => {
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    seen.add(await ledFill());
    await page.waitForTimeout(every);
  }
  return seen;
};
const setCode = (code) => page.evaluate((c) => window.__sim.useProject.getState().setCode("py", c), code);
const serialText = () => page.$$eval("[data-serial-line]", (els) => els.map((e) => e.textContent));
const status = () => page.$eval("[data-testid=status]", (e) => e.textContent);

try {
  await page.waitForSelector(".monaco-editor", { timeout: 20000 });
  ok("monaco editor loads", true);

  // 1. Blink (default program) at 10x so the test is quick.
  await page.selectOption("[aria-label='Template']", "blink");
  await page.selectOption("[aria-label='Simulation speed']", "10");
  await page.click("[data-testid=run]");
  await page.waitForFunction(() => document.querySelector("[data-testid=status]")?.textContent?.startsWith("running"), null, { timeout: 15000 });
  ok("status becomes running", true);
  const blink = await sample(30, 40);
  ok("LED blinks from MicroPython", blink.size >= 2, [...blink].join());

  // 2. Stop works on `while True` and returns to idle immediately.
  await page.click("[data-testid=stop]");
  ok("stop returns to idle", (await status()).startsWith("idle"), await status());
  await page.waitForTimeout(200);
  ok("LED is off after stop", (await ledFill()) === "#7f1d1d");

  // 3. Button + serial: pressed (pin low) lights the LED; prints appear in the monitor.
  await page.evaluate(() => {
    window.__sim.useCircuit.getState().load(
      [
        { id: "esp1", type: "esp32-devkit", x: 260, y: 20 },
        { id: "r1", type: "resistor", x: 430, y: 88 },
        { id: "led1", type: "led", x: 540, y: 20 },
        { id: "btn1", type: "button", x: 80, y: 200 },
      ],
      [
        { id: "w1", a: "esp1:GPIO2", b: "r1:1" },
        { id: "w2", a: "r1:2", b: "led1:A" },
        { id: "w3", a: "led1:K", b: "esp1:GND.2" },
        { id: "w4", a: "esp1:GPIO4", b: "btn1:1" },
        { id: "w5", a: "btn1:2", b: "esp1:GND.1" },
      ],
    );
  });
  await setCode(`from machine import Pin
import time
btn = Pin(4, Pin.IN, Pin.PULL_UP)
led = Pin(2, Pin.OUT)
print("ready")
while True:
    led.value(0 if btn.value() else 1)
    time.sleep_ms(10)
`);
  await page.click("[data-testid=run]");
  await page.waitForFunction(() => [...document.querySelectorAll("[data-serial-line]")].some((e) => e.textContent === "ready"), null, { timeout: 15000 });
  ok("print() reaches the serial monitor", (await serialText()).includes("ready"));
  await page.waitForTimeout(300);
  ok("LED off while button released", (await ledFill()) === "#7f1d1d");
  const box = await page.locator("[data-testid=press-btn1]").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => document.querySelector("[data-component=led1] [data-body]")?.getAttribute("fill") === "#ff3b30", null, { timeout: 5000 }).catch(() => {});
  ok("LED on while button pressed", (await ledFill()) === "#ff3b30", await ledFill());
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector("[data-component=led1] [data-body]")?.getAttribute("fill") === "#7f1d1d", null, { timeout: 5000 }).catch(() => {});
  ok("LED off after release", (await ledFill()) === "#7f1d1d");
  await page.click("[data-testid=stop]");

  // 4. A Python error shows in the monitor and as an editor marker on the right line.
  await setCode("x = 1\ny = x + nope\n");
  await page.click("[data-testid=run]");
  await page.waitForSelector(".squiggly-error", { timeout: 15000 }).catch(() => {});
  ok("error marker appears in Monaco", (await page.locator(".squiggly-error").count()) > 0);
  await page.waitForFunction(() => [...document.querySelectorAll("[data-serial-line]")].some((e) => e.textContent?.includes("NameError")), null, { timeout: 5000 }).catch(() => {});
  const errText = (await serialText()).join("\n");
  ok("traceback shown in serial monitor", errText.includes("NameError"));
  ok("error text is not duplicated", errText.split("NameError").length - 1 === 1, errText);
  ok("status returns to idle after error", (await status()).startsWith("idle"), await status());

  // 5. Serial flood does not freeze the page and the DOM stays virtualized.
  await setCode(`for i in range(3000):\n    print("line", i)\n`);
  await page.click("[data-testid=reset]");
  await page.click("[data-testid=run]");
  await page.waitForFunction(() => [...document.querySelectorAll("[data-serial-line]")].some((e) => e.textContent === "line 2999"), null, { timeout: 20000 }).catch(() => {});
  const rows = await page.locator("[data-serial-line]").count();
  ok("flood: last line visible", (await serialText()).includes("line 2999"));
  ok("flood: DOM rows stay small (virtualized)", rows > 0 && rows < 100, `rows=${rows}`);

  // 6. Escape attempts: `import js` stays blocked even after deleting the sys.modules guard.
  await page.click("[data-testid=reset]");
  await setCode(`import sys
try:
    import js
    js.globalThis
    print("JS_ACCESS_OK")
except Exception as e:
    print("blocked:", e)
del sys.modules['js']
import js
print("fetch is", js.globalThis.fetch)
`);
  await page.click("[data-testid=run]");
  await page.waitForFunction(() => document.querySelector("[data-testid=status]")?.textContent?.startsWith("idle") && document.querySelectorAll("[data-serial-line]").length > 1, null, { timeout: 15000 });
  await page.waitForTimeout(200);
  const esc = (await serialText()).join("\n");
  ok("plain import js is blocked", !esc.includes("JS_ACCESS_OK") && esc.includes("blocked:"), esc);
  ok("fetch is gone from the worker even after re-importing js", !esc.includes("bound_method") && !esc.includes("function"), esc);

  // 7. The service worker caches the runtime binaries after the first run.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null || true);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".monaco-editor");
  await page.evaluate(() => window.__sim.useProject.getState().setCode("py", "print('cached run')"));
  await page.click("[data-testid=run]");
  await page.waitForFunction(() => [...document.querySelectorAll("[data-serial-line]")].some((e) => e.textContent === "cached run"), null, { timeout: 15000 });
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls = [];
    for (const k of keys) for (const r of await (await caches.open(k)).keys()) urls.push(new URL(r.url).pathname);
    return urls;
  });
  ok("service worker cached the wasm", cached.includes("/micropython/micropython.wasm"), cached.join());

  ok("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  stop();
}
done();
