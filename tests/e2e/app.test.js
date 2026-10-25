"use strict";

// Browsertests voor de webapp. Start de gebouwde server met een tijdelijke database, of met
// E2E_MODE=browser de statische browserversie (site/ van tools/build-site.sh) achter een
// eenvoudige lokale webserver. Gebruikt alleen synthetische gegevens en faalt bij elk verzoek
// buiten 127.0.0.1.
// Draaien: cargo build --locked -p thuisaccu-server && (cd tests/e2e && npm test)
//          sh tools/build-site.sh && (cd tests/e2e && E2E_MODE=browser npm test)
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const BINARY = process.env.THUISACCU_BIN
  || path.join(ROOT, "target", "debug", process.platform === "win32" ? "thuisaccu-server.exe" : "thuisaccu-server");

const BROWSER_MODE = process.env.E2E_MODE === "browser";
const SITE = path.resolve(process.env.THUISACCU_SITE || path.join(ROOT, "site"));

let server, base, browser, workdir;

// Statische site zoals GitHub Pages die levert, in een submap om relatieve paden te toetsen.
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".wasm": "application/wasm" };
function startSite() {
  return new Promise((resolve, reject) => {
    server = http.createServer((request, response) => {
      const url = new URL(request.url, "http://127.0.0.1");
      const relative = decodeURIComponent(url.pathname).replace(/^\/thuisaccu\//, "");
      const file = path.resolve(SITE, relative || "index.html");
      if (!url.pathname.startsWith("/thuisaccu/") || !file.startsWith(SITE + path.sep) || !fs.existsSync(file)) {
        response.writeHead(404).end(); return;
      }
      response.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(response);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}/thuisaccu`));
  });
}

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
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "thuisaccu-e2e-"));
  if (BROWSER_MODE) {
    assert.ok(fs.existsSync(path.join(SITE, "pkg")), `Bouw eerst de site: ${SITE} ontbreekt.`);
    base = await startSite();
  } else {
    assert.ok(fs.existsSync(BINARY), `Bouw eerst de server: ${BINARY} ontbreekt.`);
    base = await startServer();
  }
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  if (BROWSER_MODE) server?.close();
  else if (server && server.exitCode === null) {
    // Op Windows blijft de database bezet tot het proces echt gestopt is.
    const stopped = new Promise(resolve => server.once("exit", resolve));
    server.kill();
    await stopped;
  }
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
  await page.goto(`${base}/`);
  await page.waitForSelector(".wizard");
  await page.waitForSelector("#service.online");
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
  await page.waitForSelector(".product-group", { timeout: 30000 });
  // Opwek 3.800 − teruglevering 2.900 kWh: 24% direct zelf gebruikt, naast het geschatte profiel.
  assert.match(await page.textContent(".wizard-body [role=note]"),
    /Volgens je jaarafrekening gebruik je 24% van je zonnestroom direct zelf.*het geschatte profiel gaat uit van \d+%/);
  // Alle passende accu's met een prijs gaan automatisch mee; de rest staat ingeklapt met de reden.
  assert.match(await page.textContent(".wizard-body"), /We rekenen alle \d+ accu’s door/);
  assert.doesNotMatch(await page.textContent(".wizard-body"), /null/);
  assert.match(await page.textContent(".product-group:last-of-type summary"), /niet meegerekend/);
  assert.match(await page.textContent(".product-group:last-of-type"), /Past niet/);
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

test("keuzehulp met totaal verbruik en een capaciteitscurve op schaal", async () => {
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/keuzehulp`);
  await page.click("text=Het totale verbruik van het huis");
  assert.equal(await page.getByLabel("Teruggeleverd aan het net per jaar (kWh)").count(), 0);
  await page.getByLabel("Totaal verbruik per jaar (kWh)").fill("8000");
  await page.getByLabel("Opwek van je panelen per jaar (kWh)").fill("10000");
  await page.getByLabel("Waarvan elektrische auto, thuis geladen (kWh per jaar)").fill("3000");
  assert.match(await page.textContent(".derived"), /8\.000 kWh per jaar\./);
  await next(page);
  await next(page);
  await page.click("button:has-text('Gebruik de indicatie')");
  await next(page);
  await next(page);
  await page.waitForSelector(".wizard-body figure.chart", { timeout: 30000 });
  // De punten staan op afstand naar accugrootte, niet op gelijke afstand.
  const spread = await page.$eval(".wizard-body figure.chart", figure => {
    const sizes = [...figure.querySelectorAll("tbody td:first-child")]
      .map(cell => Number(cell.textContent.replace(/[^\d,]/g, "").replace(",", "."))).filter(Number.isFinite);
    const xs = [...figure.querySelectorAll("circle")].map(c => Number(c.getAttribute("cx")));
    const scale = (xs.at(-1) - xs[0]) / (sizes.at(-1) - sizes[0]);
    return Math.max(...xs.map((x, i) => Math.abs(x - xs[0] - (sizes[i] - sizes[0]) * scale)));
  });
  assert.ok(spread < 0.5, `afwijking ${spread}`);
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
  // De browserversie begint per test met een lege database; de server deelt er één.
  const load = page.getByRole("button", { name: "Laad onderzochte uitvoeringen" });
  await page.locator("table").or(load).first().waitFor();
  if (!await page.locator("table").count()) await load.click();
  await page.waitForSelector("table", { timeout: 30000 });
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

test("browserversie bewaart gegevens in deze browser en maakt een back-up", { skip: !BROWSER_MODE }, async () => {
  const { page, problems, close } = await open({ acceptDownloads: true });
  await page.goto(`${base}/#/accus`);
  await page.click("button:has-text('Laad onderzochte uitvoeringen')");
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const rows = await page.locator("table tbody tr").count();
  // Na herladen komt de catalogus uit IndexedDB, niet van een server.
  await page.reload();
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  assert.equal(await page.locator("table tbody tr").count(), rows);
  await page.goto(`${base}/#/instellingen`);
  await page.waitForSelector("text=Gegevens in deze browser");
  const [download] = await Promise.all([page.waitForEvent("download"),
    page.click("button:has-text('Download back-up')")]);
  const file = path.join(workdir, "backup.sqlite3");
  await download.saveAs(file);
  assert.equal(fs.readFileSync(file).subarray(0, 15).toString(), "SQLite format 3");
  // Terugzetten in een lege browser geeft dezelfde catalogus.
  const fresh = await open();
  await fresh.page.goto(`${base}/#/instellingen`);
  await fresh.page.setInputFiles("input[type=file]", file);
  await fresh.page.click("button:has-text('Vervang de gegevens in deze browser')");
  await fresh.page.waitForEvent("load");
  await fresh.page.goto(`${base}/#/accus`);
  await fresh.page.waitForSelector("table tbody tr", { timeout: 30000 });
  assert.equal(await fresh.page.locator("table tbody tr").count(), rows);
  assert.deepEqual([...problems, ...fresh.problems], []);
  await fresh.close();
  await close();
});
