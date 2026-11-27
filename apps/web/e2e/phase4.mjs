// Arduino mode against a real compile service (COMPILE_URL, default http://localhost:8788).
import { checker, openPage, startServer } from "./lib.mjs";

const stop = await startServer();
const { ok, done } = checker();
const { browser, page, errors } = await openPage();

const OFF = "#7f1d1d";
const ON = "#ff3b30";
const status = () => page.$eval("[data-testid=status]", (e) => e.textContent);
const fill = (id) => page.$eval(`[data-component=${id}] [data-body]`, (e) => e.getAttribute("fill"));
const waitFill = (id, color) =>
  page.waitForFunction(([i, c]) => document.querySelector(`[data-component=${i}] [data-body]`)?.getAttribute("fill") === c, [id, color], { timeout: 10000 }).then(() => true, () => false);
const showSerial = () => page.click("button:has-text('Serial Monitor')");
const serial = async () => {
  await showSerial();
  return page.$$eval("[data-serial-line]", (els) => els.map((e) => e.textContent));
};
const waitSerial = async (text, timeout = 20000) => {
  await showSerial();
  return page.waitForFunction((t) => [...document.querySelectorAll("[data-serial-line]")].some((e) => e.textContent?.includes(t)), text, { timeout }).then(() => true, () => false);
};
const openTab = (name) => page.click(`button:has-text('${name}')`);
const setCode = (lang, code) => page.evaluate(([l, c]) => window.__sim.useProject.getState().setCode(l, c), [lang, code]);
const useTemplate = async (id) => {
  await page.selectOption("[aria-label='Template']", id);
  await page.selectOption("[aria-label='Language']", "ino");
  await page.selectOption("[aria-label='Simulation speed']", "10");
};
const run = async () => {
  await page.click("[data-testid=run]");
  await page.waitForFunction(() => document.querySelector("[data-testid=status]")?.textContent?.startsWith("running"), null, { timeout: 30000 });
};
const halt = () => page.click("[data-testid=stop]");
const litPixels = (comp, min = 120) =>
  page.$eval(`[data-component=${comp}] canvas`, (c, m) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > m) n++;
    return n;
  }, min);

try {
  await page.waitForSelector(".monaco-editor", { timeout: 20000 });

  // --- Blink: compile, then the LED toggles
  await useTemplate("blink");
  await page.click("[data-testid=run]");
  ok("status shows compiling first", await page.waitForFunction(() => /^(compiling|starting|running)/.test(document.querySelector("[data-testid=status]")?.textContent ?? ""), null, { timeout: 5000 }).then(() => true, () => false));
  await page.waitForFunction(() => document.querySelector("[data-testid=status]")?.textContent?.startsWith("running"), null, { timeout: 30000 });
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    seen.add(await fill("led1"));
    await page.waitForTimeout(50);
  }
  ok("Arduino blink toggles the LED", seen.size === 2, [...seen].join());
  await halt();
  ok("stop returns to idle", (await status()).startsWith("idle"));

  // --- Button
  await useTemplate("button");
  await run();
  await page.waitForTimeout(400);
  ok("button: LED off at rest", (await fill("led1")) === OFF);
  const box = await page.locator("[data-testid=press-btn1]").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  ok("button: LED on while pressed", await waitFill("led1", ON));
  await page.mouse.up();
  ok("button: LED off after release", await waitFill("led1", OFF));
  await halt();

  // --- Dimmer (ledcAttach/ledcWrite + analogRead)
  await useTemplate("dimmer");
  await run();
  await openTab("Controls");
  const red = async (v) => {
    await page.locator("[data-testid=ctl-pot1-pos]").fill(String(v));
    await page.waitForTimeout(500);
    return parseInt((await fill("led1")).slice(1, 3), 16);
  };
  const low = await red(0.05);
  const high = await red(1);
  ok("dimmer: LED brighter at high knob position", high > low + 40, `low=${low} high=${high}`);
  await halt();

  // --- DHT22 -> OLED with Adafruit libraries
  await useTemplate("dht22-oled");
  await run();
  ok("dht22-oled: serial shows the reading", await waitSerial("25.00 50.00"));
  ok("dht22-oled: OLED draws text", (await litPixels("oled1")) > 100, `lit=${await litPixels("oled1")}`);
  await openTab("Controls");
  await page.locator("[data-testid=ctl-dht1-temperature]").fill("31.5");
  ok("dht22-oled: slider reaches the sketch", await waitSerial("31.50 50.00"));
  await halt();

  // --- PIR -> relay -> lamp
  await useTemplate("pir-relay");
  await run();
  await page.waitForTimeout(400);
  ok("pir: lamp off without motion", (await fill("led1")) === OFF);
  await openTab("Controls");
  await page.locator("[data-testid=ctl-pir1-motion]").check();
  ok("pir: motion lights the lamp through the relay", await waitFill("led1", ON));
  await halt();

  // --- HC-SR04 -> LCD
  await useTemplate("distance-lcd");
  await run();
  ok("distance: 100 cm measured with pulseIn", await waitSerial("100.0 cm"));
  ok("distance: LCD shows text", (await page.$eval("[data-component=lcd1] canvas", (c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const bg = [d[0], d[1], d[2]];
    let diff = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) > 60) diff++;
    return diff;
  })) > 30);
  await halt();

  // --- compile errors become editor markers and serial text
  await page.selectOption("[aria-label='Language']", "ino");
  await setCode("ino", "void setup() {\n  int x = 1;\n  undefinedThing(x);\n}\nvoid loop() {}\n");
  await page.click("[data-testid=run]");
  await page.waitForSelector(".squiggly-error", { timeout: 30000 }).catch(() => {});
  ok("compile error: marker in the editor", (await page.locator(".squiggly-error").count()) > 0);
  ok("compile error: message in the serial monitor", await waitSerial("undeclared identifier"), (await serial()).join("|"));
  ok("compile error: back to idle, nothing running", (await status()).startsWith("idle"));
  ok("compile error: no container paths leaked to the page", !(await serial()).join("\n").match(/\/tmp\/|\/shim\//));

  // --- unsupported library
  await setCode("ino", '#include <WiFi.h>\nvoid setup() { WiFi.begin("a", "b"); }\nvoid loop() {}\n');
  await page.click("[data-testid=run]");
  ok("missing library is reported", await waitSerial("WiFi.h"), (await serial()).slice(-3).join("|"));

  // --- the same sketch twice: second one is served from the service cache and still runs
  await useTemplate("blink");
  await run();
  await halt();
  await run();
  ok("recompiling the same sketch works", (await status()).startsWith("running"));
  await halt();

  ok("no page errors", errors.length === 0, errors.join(" | "));

  // --- service down: a clear message, MicroPython still works
  const down = await openPage("http://localhost:9");
  await down.page.waitForSelector(".monaco-editor", { timeout: 20000 });
  await down.page.selectOption("[aria-label='Template']", "blink");
  await down.page.selectOption("[aria-label='Language']", "ino");
  await down.page.click("[data-testid=run]");
  await down.page.waitForFunction(() => [...document.querySelectorAll("[data-serial-line]")].some((e) => e.textContent?.includes("Cannot reach the compile service")), null, { timeout: 15000 }).then(
    () => ok("service down: readable message", true),
    () => ok("service down: readable message", false),
  );
  ok("service down: back to idle", (await down.page.$eval("[data-testid=status]", (e) => e.textContent)).startsWith("idle"));
  await down.page.selectOption("[aria-label='Language']", "py");
  await down.page.click("[data-testid=run]");
  await down.page.waitForFunction(() => document.querySelector("[data-testid=status]")?.textContent?.startsWith("running"), null, { timeout: 15000 }).then(
    () => ok("service down: MicroPython still runs", true),
    () => ok("service down: MicroPython still runs", false),
  );
  await down.browser.close();
} finally {
  await browser.close();
  stop();
}
done();
