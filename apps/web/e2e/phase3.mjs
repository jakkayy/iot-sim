import { checker, openPage, startServer } from "./lib.mjs";

const stop = await startServer();
const { ok, done } = checker();
const { browser, page, errors } = await openPage();

const loadTemplate = async (id) => {
  await page.selectOption("[aria-label='Template']", id);
  await page.selectOption("[aria-label='Simulation speed']", "10");
};
const run = async () => {
  await page.click("[data-testid=run]");
  await page.waitForFunction(() => document.querySelector("[data-testid=status]")?.textContent?.startsWith("running"), null, { timeout: 15000 });
};
const halt = () => page.click("[data-testid=stop]");
const fill = (id) => page.$eval(`[data-component=${id}] [data-body]`, (e) => e.getAttribute("fill"));
const waitFill = (id, color) =>
  page.waitForFunction(([i, c]) => document.querySelector(`[data-component=${i}] [data-body]`)?.getAttribute("fill") === c, [id, color], { timeout: 8000 }).then(() => true, () => false);
// The serial monitor is only mounted on its own tab, so switch to it before reading.
const showSerial = () => page.click("button:has-text('Serial Monitor')");
const serial = async () => {
  await showSerial();
  return page.$$eval("[data-serial-line]", (els) => els.map((e) => e.textContent));
};
const waitSerial = async (text) => {
  await showSerial();
  return page.waitForFunction((t) => [...document.querySelectorAll("[data-serial-line]")].some((e) => e.textContent?.includes(t)), text, { timeout: 15000 }).then(() => true, () => false);
};
const openTab = (name) => page.click(`button:has-text('${name}')`);
const litPixels = (comp) =>
  page.$eval(`[data-component=${comp}] canvas`, (c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) n++;
    return n;
  });
const canvasSig = (comp) => page.$eval(`[data-component=${comp}] canvas`, (c) => c.toDataURL());
const OFF = "#7f1d1d";
const ON = "#ff3b30";

try {
  await page.waitForSelector(".monaco-editor", { timeout: 20000 });

  // --- DHT22 -> OLED: the sensor slider reaches the program and the OLED shows it
  await loadTemplate("dht22-oled");
  await run();
  ok("OLED shows text (lit pixels)", (await waitSerial("25.0 50.0")) && (await litPixels("oled1")) > 100, `lit=${await litPixels("oled1")}`);
  await openTab("Controls");
  await page.locator("[data-testid=ctl-dht1-temperature]").fill("31.5");
  ok("DHT22 slider value reaches MicroPython", await waitSerial("31.5 50.0"), (await serial()).slice(-3).join("|"));
  await halt();

  // --- Button
  await loadTemplate("button");
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

  // --- Potentiometer dimmer: brightness follows the knob
  await loadTemplate("dimmer");
  await run();
  await openTab("Controls");
  const brightness = async (v) => {
    await page.locator("[data-testid=ctl-pot1-pos]").fill(String(v));
    await page.waitForTimeout(400);
    const hex = await fill("led1");
    return parseInt(hex.slice(1, 3), 16); // red channel rises with brightness
  };
  const low = await brightness(0.05);
  const high = await brightness(1);
  ok("dimmer: LED brighter at high knob position", high > low + 40, `low=${low} high=${high}`);
  await halt();

  // --- PIR -> relay -> lamp
  await loadTemplate("pir-relay");
  await run();
  await page.waitForTimeout(400);
  ok("pir: lamp off without motion", (await fill("led1")) === OFF);
  await openTab("Controls");
  await page.locator("[data-testid=ctl-pir1-motion]").check();
  ok("pir: motion switches the relay and lights the lamp", await waitFill("led1", ON));
  await page.locator("[data-testid=ctl-pir1-motion]").uncheck();
  ok("pir: lamp off again when motion stops", await waitFill("led1", OFF));
  await halt();

  // --- HC-SR04 -> LCD
  await loadTemplate("distance-lcd");
  await run();
  ok("distance: default 100 cm measured", await waitSerial("100.0 cm"));
  const before = await canvasSig("lcd1");
  ok("distance: LCD shows text (lit pixels differ from blank)", (await page.$eval("[data-component=lcd1] canvas", (c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const bg = [d[0], d[1], d[2]];
    let diff = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) > 60) diff++;
    return diff;
  })) > 30);
  await openTab("Controls");
  await page.locator("[data-testid=ctl-us1-distance]").fill("50");
  ok("distance: slider change is measured", await waitSerial("50.0 cm"));
  ok("distance: LCD redraws", (await canvasSig("lcd1")) !== before);
  await halt();

  // --- unpowered module reports no data
  await page.selectOption("[aria-label='Template']", "dht22-oled");
  await page.evaluate(() => {
    const s = window.__sim.useCircuit.getState();
    s.load(s.components, s.wires.filter((w) => !w.a.startsWith("dht1:VCC") && !w.b.startsWith("dht1:VCC")), s.values);
  });
  await page.click("[data-testid=run]");
  ok("unpowered DHT22 raises a timeout error", await waitSerial("OSError"), (await serial()).join("|"));

  // --- undo / redo
  await page.selectOption("[aria-label='Template']", "blink");
  await page.locator("[data-component=r1] rect").first().click();
  await page.keyboard.press("Delete");
  ok("delete removes the resistor", (await page.locator("[data-component=r1]").count()) === 0);
  await page.click("[aria-label=Undo]");
  ok("undo button brings the resistor and its wires back", (await page.locator("[data-component=r1]").count()) === 1 && (await page.locator("[data-wire]").count()) === 3);
  await page.click("[aria-label=Redo]");
  ok("redo removes it again", (await page.locator("[data-component=r1]").count()) === 0);
  await page.locator("[data-testid=canvas]").click({ position: { x: 300, y: 520 } });
  await page.keyboard.press("Control+z");
  ok("Ctrl+Z undoes too", (await page.locator("[data-component=r1]").count()) === 1);

  // --- export: zip with main.py, wiring.md, project.json
  await page.selectOption("[aria-label='Template']", "button");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-testid=export]")]);
  const path = await dl.path();
  const { execFileSync } = await import("node:child_process");
  const listing = execFileSync("unzip", ["-l", path]).toString();
  ok("export zip lists main.py, wiring.md and project.json", ["main.py", "wiring.md", "project.json"].every((n) => listing.includes(n)), listing);
  ok("export zip passes unzip -t", execFileSync("unzip", ["-t", path]).toString().includes("No errors detected"));
  const wiring = execFileSync("unzip", ["-p", path, "wiring.md"]).toString();
  ok("wiring table maps the button to GPIO4", /btn1 \(Push button\) \| 1 \| GPIO4/.test(wiring), wiring.split("\n").filter((l) => l.includes("btn1")).join(" / "));

  // --- autosave: reload restores circuit and code
  await page.selectOption("[aria-label='Template']", "dht22-oled");
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".monaco-editor");
  await page.waitForSelector("[data-component=oled1]", { timeout: 5000 }).catch(() => {});
  ok("reload restores the circuit", (await page.locator("[data-component=oled1]").count()) === 1);
  const restoredCode = await page.evaluate(() => window.__sim.useProject.getState().code.py);
  ok("reload restores the program", restoredCode.includes("SSD1306_I2C"));

  ok("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  stop();
}
done();
