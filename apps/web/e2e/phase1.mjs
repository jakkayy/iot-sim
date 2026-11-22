import { checker, openPage, startServer } from "./lib.mjs";

const stop = await startServer();
const { ok, done } = checker();
const { browser, page, errors } = await openPage();
try {
  await page.click("text=Load Blink circuit");
  await page.waitForTimeout(200);
  const kinds = await page.$$eval("[data-wire]", (els) =>
    Object.fromEntries(els.map((e) => [e.getAttribute("data-wire"), e.getAttribute("data-kind")])),
  );
  ok("wire kinds", kinds.w1 === "signal" && kinds.w3 === "ground", JSON.stringify(kinds));
  await page.click("button:has-text('Checks')");
  ok("no warnings on blink circuit", (await page.locator("[data-testid=no-warnings]").count()) === 1);

  await page.selectOption("[aria-label='Simulation speed']", "10");
  await page.click("[data-testid=run]");
  const fills = new Set();
  for (let i = 0; i < 30; i++) {
    fills.add(await page.$eval("[data-component=led1] [data-body]", (e) => e.getAttribute("fill")));
    await page.waitForTimeout(60);
  }
  ok("LED visual toggles while running", fills.size === 2, [...fills].join());
  await page.click("[data-testid=stop]");

  await page.locator("[data-component=r1] rect").first().click();
  await page.keyboard.press("Delete");
  ok(
    "resistor and its wires removed",
    (await page.locator("[data-component=r1]").count()) === 0 &&
      (await page.locator("[data-wire]").count()) === 1,
  );

  await page.locator("[data-pin='esp1:GPIO2']").click({ force: true });
  await page.locator("[data-pin='led1:A']").click({ force: true });
  await page.waitForTimeout(200);
  await page.click("button:has-text('Checks')");
  ok("LED without resistor warns", (await page.locator("[data-code=led-no-resistor]").count()) === 1);

  await page.click("[data-testid=lib-button]");
  ok("library adds a button", (await page.locator("[data-component=btn1]").count()) === 1);

  const before = await page.$eval("[data-testid=canvas] > g", (g) => g.getAttribute("transform"));
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(100);
  const after = await page.$eval("[data-testid=canvas] > g", (g) => g.getAttribute("transform"));
  ok("wheel zooms", before !== after, `${before} -> ${after}`);
  ok("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  stop();
}
done();
