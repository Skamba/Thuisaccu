"use strict";

// Browsertests voor de ingebakken webapp. Start de gebouwde server met een tijdelijke
// database, gebruikt alleen synthetische gegevens en faalt bij elk verzoek buiten 127.0.0.1.
// Draaien: cargo build --locked -p thuisaccu-server && (cd tests/e2e && npm test)
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const BINARY = process.env.THUISACCU_BIN
  || path.join(ROOT, "target", "debug", process.platform === "win32" ? "thuisaccu-server.exe" : "thuisaccu-server");

let server, base, browser, workdir;

function startServer() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, LISTEN_ADDR: "127.0.0.1:0", DATABASE_PATH: path.join(workdir, "e2e.sqlite3"),
      RUST_LOG: "info", NO_COLOR: "1" };
    server = spawn(BINARY, [], { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Server start niet binnen 20 s:\n${output}`)), 20000);
    const read = chunk => {
      output += chunk.toString();
      // Verwijder ANSI-kleurcodes voordat het adres wordt gelezen.
      const found = output.replace(/\x1b\[[0-9;]*m/g, "").match(/address=(127\.0\.0\.1:\d+)/);
      if (found) { clearTimeout(timer); resolve(`http://${found[1]}`); }
    };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
    server.on("exit", code => { clearTimeout(timer); reject(new Error(`Server stopte met code ${code}:\n${output}`)); });
  });
}

before(async () => {
  assert.ok(fs.existsSync(BINARY), `Bouw eerst de server: ${BINARY} ontbreekt.`);
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "thuisaccu-e2e-"));
  base = await startServer();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.kill();
  if (workdir) fs.rmSync(workdir, { recursive: true, force: true });
});

// Nieuwe pagina die externe verzoeken blokkeert en pagina- en consolefouten verzamelt.
async function open(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
  const page = await context.newPage();
  const problems = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    problems.push(`extern verzoek: ${url.href}`);
    return route.abort();
  });
  page.on("pageerror", error => problems.push(`paginafout: ${error.message}`));
  page.on("console", message => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });
  return { page, problems, close: () => context.close() };
}
const next = page => page.click(".wizard-footer button:has-text('Volgende')");

// Synthetisch jaar: omvormer per kwartier, slimme meter per uur, zonder bestaande accu.
function syntheticYear(dir) {
  const inverter = ["tijdstip,opwek_kwh"], meter = ["datum,afname_kwh,teruglevering_kwh"];
  const start = Date.UTC(2025, 0, 1);
  for (let hour = 0; hour < 8760; hour++) {
    const time = new Date(start + hour * 3600e3), h = time.getUTCHours();
    let produced = 0;
    for (let q = 0; q < 4; q++) {
      const value = h >= 6 && h < 18 ? Math.max(0, 0.3 * Math.sin(Math.PI * (h + q / 4 - 6) / 12)) : 0;
      produced += value;
      inverter.push(`${new Date(time.getTime() + q * 900e3).toISOString().slice(0, 19)}Z,${value.toFixed(4)}`);
    }
    const load = 0.25 + (h >= 17 && h < 22 ? 0.6 : 0);
    meter.push(`${time.toISOString().slice(0, 19)}Z,${Math.max(0, load - produced).toFixed(4)},`
      + `${Math.max(0, produced - load).toFixed(4)}`);
  }
  const files = { inverter: path.join(dir, "omvormer.csv"), meter: path.join(dir, "p1.csv") };
  fs.writeFileSync(files.inverter, `${inverter.join("\n")}\n`);
  fs.writeFileSync(files.meter, `${meter.join("\n")}\n`);
  return files;
}

test("startscherm is de keuzehulp, offline en zonder fouten", async () => {
  const { page, problems, close } = await open();
  await page.goto(base);
  await page.waitForSelector(".wizard");
  assert.match(await page.evaluate(() => location.hash), /keuzehulp/);
  // Elk formulierveld heeft een zichtbaar label of een toegankelijke naam.
  const unlabelled = await page.$$eval("input, select, textarea", controls => controls
    .filter(c => c.type !== "radio" && c.type !== "hidden")
    .filter(c => !(c.labels?.length || c.getAttribute("aria-label")))
    .map(c => c.outerHTML.slice(0, 80)));
  assert.deepEqual(unlabelled, []);
  assert.deepEqual(problems, []);
  await close();
});

test("keuzehulp met jaartotalen, warmtepomp en terugleveringsvariant", async () => {
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/keuzehulp`);
  await page.getByLabel("Stroom van het net per jaar (kWh)").fill("4600");
  await page.getByLabel("Teruggeleverd aan het net per jaar (kWh)").fill("2900");
  await page.getByLabel("Opwek van je panelen per jaar (kWh)").fill("3800");
  await page.getByLabel("Waarvan warmtepomp (kWh per jaar)").fill("1500");
  assert.match(await page.textContent(".derived"), /5\.500 kWh/);
  await next(page);
  await page.waitForSelector("text=Je woning");
  await page.click("text=Zelf, met de stekker");
  await next(page);
  await page.click("button:has-text('Gebruik de indicatie')");
  assert.equal(await page.getByLabel("Prijs voor stroom van het net (€ per kWh, alles inbegrepen)").inputValue(), "0.2596");
  await next(page);
  await next(page);
  // Lege catalogus: de onderzochte accu's worden pas op verzoek geladen.
  await page.click("button:has-text('Laad onderzochte accu’s')");
  await page.waitForSelector(".product", { timeout: 30000 });
  const lead = () => page.textContent(".wizard-body .lead");
  const before = await lead();
  await page.click("text=Zo veel mogelijk eigen zonnestroom");
  assert.notEqual(await lead(), before);
  assert.match(await lead(), /zo veel mogelijk eigen zonnestroom/);
  for (const box of await page.$$("fieldset .check input")) await box.check();
  await page.click("button:has-text('Bereken mijn advies')");
  await page.waitForFunction(() => /berekeningen\/\d+/.test(location.hash), null, { timeout: 30000 });
  const summary = await page.textContent(".plain");
  assert.match(summary, /Als teruglevering vanaf 2030 niets meer oplevert/);
  assert.match(summary, /geschat uit jaartotalen/);
  for (const tab of ["Kasstromen", "Energie", "Gevoeligheid", "Invoer en aannames"]) {
    await page.click(`[role=tab]:has-text("${tab}")`);
  }
  assert.match(await page.textContent("[role=tabpanel]:not([hidden])"), /Terugleveringsvariant/);
  assert.deepEqual(problems, []);
  await close();
});

test("omvormer- en meterbestand worden één bruikbaar jaarprofiel", async () => {
  const files = syntheticYear(workdir);
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/energie/import`);
  await page.setInputFiles("input[type=file]", files.inverter);
  await next(page);
  await page.waitForSelector("text=Kolommen en eenheden");
  await page.getByLabel("Meetperiode").selectOption("15min");
  await page.getByLabel("Tijdzone").fill("UTC");
  await next(page);
  await page.click("text=Ja, ik heb een P1- of meterexport");
  await page.setInputFiles(".wizard-body input[type=file]", files.meter);
  await page.click("button:has-text('Lees meterbestand')");
  await page.waitForSelector("text=Netafname");
  await page.getByLabel("Meetperiode").selectOption("hour");
  await page.getByLabel("Tijdzone").fill("UTC");
  await next(page);
  await page.waitForSelector(".stats", { timeout: 30000 });
  // 0,25 kWh per uur plus 0,6 kWh van 17 tot 22 uur: 2190 + 1095 = 3285 kWh bruto verbruik.
  assert.match(await page.textContent(".stats"), /3\.285 kWh/);
  await next(page);
  await page.click("button:has-text('Bewaar energieprofiel')");
  await page.waitForFunction(() => /energie\/\d+/.test(location.hash), null, { timeout: 30000 });
  await page.goto(`${base}/#/energie`);
  const row = page.locator("tr", { hasText: "omvormer.csv + p1.csv" });
  assert.match(await row.textContent(), /Bruikbaar/);
  assert.deepEqual(problems, []);
  await close();
});

test("na drie maanden waarschuwt de catalogus voor verouderde prijzen", async () => {
  const { page, problems, close } = await open();
  await page.clock.setFixedTime(new Date("2026-11-30T12:00:00"));
  await page.goto(`${base}/#/accus`);
  await page.waitForSelector("table");
  assert.equal(await page.locator(".callout", { hasText: "verouderd" }).count(), 0);
  await page.clock.setFixedTime(new Date("2027-02-01T12:00:00"));
  await page.reload();
  await page.waitForSelector("table");
  assert.match(await page.locator(".callout").first().textContent(), /3 maanden geleden/);
  assert.deepEqual(problems, []);
  await close();
});

test("smal scherm: menu werkt met het toetsenbord", async () => {
  const { page, problems, close } = await open({ viewport: { width: 390, height: 844 } });
  await page.goto(`${base}/#/keuzehulp`);
  await page.focus("#menu");
  await page.keyboard.press("Enter");
  assert.equal(await page.getAttribute("#menu", "aria-expanded"), "true");
  await page.click("#nav a[data-page='instellingen']");
  await page.waitForSelector("text=Standaardaannames");
  assert.equal(await page.getAttribute("#menu", "aria-expanded"), "false");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `horizontaal scrollen: ${overflow}px`);
  assert.deepEqual(problems, []);
  await close();
});
