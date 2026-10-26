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

// Synthetisch jaar zoals een Nederlandse energiemonitor: puntkomma, decimale komma en lokale tijd,
// dus zonder 02.00 uur eind maart en met 02.00 uur twee keer eind oktober.
function dutchLocalYear(dir) {
  const lines = ["Datum;Opwek (kWh);Verbruik (kWh)"];
  const local = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const start = Date.UTC(2024, 11, 31, 23);
  for (let hour = 0; hour < 8760; hour++) {
    const parts = Object.fromEntries(local.formatToParts(new Date(start + hour * 3600e3)).map(p => [p.type, p.value]));
    const h = Number(parts.hour);
    const solar = h >= 7 && h < 19 ? 0.4 * Math.sin(Math.PI * (h - 7) / 12) : 0;
    const load = 0.25 + (h >= 17 && h < 22 ? 0.6 : 0);
    const comma = v => v.toFixed(3).replace(".", ",");
    lines.push(`${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute};${comma(solar)};${comma(load)}`);
  }
  const file = path.join(dir, "energiemonitor.csv");
  fs.writeFileSync(file, `${lines.join("\r\n")}\r\n`);
  return file;
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
  // Ook een lege catalogus krijgt de onderzochte accu's: de app laadt ontbrekende sets zelf bij.
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
  // Het volle bereik rekent alle accu's door, zodat de deellink hieronder moet inkorten.
  await page.getByLabel("Kleinste accu (bruikbaar)").focus();
  await page.keyboard.press("Home");
  await page.getByLabel("Grootste accu (bruikbaar)").focus();
  await page.keyboard.press("End");
  for (const box of await page.$$("fieldset .check input")) await box.check();
  await page.click("button:has-text('Bereken mijn advies')");
  // Vijftig accu's doorrekenen duurt met de debug-build in CI zo'n 20 tot ruim 30 seconden.
  await page.waitForFunction(() => /berekeningen\/\d+/.test(location.hash), null, { timeout: 120000 });
  const runHash = await page.evaluate(() => location.hash);
  const summary = await page.textContent(".plain");
  // Wint geen accu, dan zegt ‘Dat verandert als’ wat er anders moet, met de stresstest als regel.
  const whatIf = /Dat verandert als:/.test(summary);
  assert.match(summary, whatIf
    ? /teruglevering vanaf 2030 niets meer oplevert \(‘Stresstest[^’]*’\): (dan komt .+ wel het beste uit|dan is .+ lonend tot ongeveer €\s*[\d.]+0|ook dan is .+ zelfs gratis niet lonend)\./
    : /Als teruglevering vanaf 2030 niets meer oplevert/);
  // De besparing van jaar 1 is na te rekenen en komt uit op hetzelfde bedrag als de samenvatting noemt.
  const euro = text => (/[−-]/.test(text) ? -1 : 1) * Number(text.replace(/\D/g, ""));
  const saving = summary.match(/bespaart in het eerste jaar ongeveer (€\s*[\d.]+)/)[1];
  const receipt = await page.locator(".plain .receipt li").allTextContents();
  const [, gain] = receipt[0].match(/^\+ [\d.]+ kWh minder van het net × €\s*[\d,]+ = (€\s*[\d.]+)$/);
  const [, sign, lost] = receipt[1].match(/^([+−]) [\d.]+ kWh minder teruggeleverd × €\s*[\d,]+ \(.+\) = (€\s*[\d.]+)$/);
  const [, total] = receipt[2].match(/^= (−?⁠?€\s*[\d.]+) per jaar$/);
  assert.ok(Math.abs(euro(total) - euro(saving)) <= 1, `${total} ≠ ${saving}`);
  assert.ok(Math.abs(euro(gain) + (sign === "−" ? -1 : 1) * euro(lost) - euro(total)) <= 1);
  // Zonder vergoeding scheelt elke niet teruggeleverde kWh de terugleverkosten.
  assert.match(summary, /wordt de tweede regel vanaf 2030: \+ [\d.]+ kWh minder teruggeleverd × €\s*0,0515 \(vergoeding €\s*0,0000 − terugleverkosten €\s*0,0515: terugleveren kost je geld\) = €\s*[\d.]+, samen €\s*[\d.]+ per jaar/);
  assert.match(summary, /‘Lonend’ betekent hier: de besparing verdient de investering binnen 15 jaar terug en levert daarbovenop 4,0% per jaar op/);
  // De grens voor een offerte, ook zonder terugleververgoeding.
  if (!whatIf) assert.match(summary, /(lonend zolang de startinvestering niet boven ongeveer €\s*[\d.]+ komt|ook als hij gratis zou zijn).* In de variant ‘Stresstest: geen terugleververgoeding vanaf 2030’ (ligt die grens bij €\s*[\d.]+0(: hoger, omdat zelf opslaan meer waard wordt als terugleveren niets oplevert)?|is hij zelfs gratis niet lonend)\./);
  assert.match(summary, /geschat uit jaartotalen/);
  // Met de stekker staat het veiligheidsadvies boven de som, met het vermogen waarmee is gerekend; de kaart
  // van een stekkerbatterij springt ernaartoe zonder de pagina te verlaten.
  assert.match(summary, /Milieu Centraal raadt stekkerbatterijen op dit moment af\. Dit gaat over: .+\. De reden.*ten hoogste 800 W in het stopcontact.*Voor .+ is gerekend met [\d,]+ kW ontladen.*energieleveren\.nl/);
  assert.ok(summary.indexOf("raadt stekkerbatterijen op dit moment af") < summary.indexOf("Zo reken je de besparing"));
  await page.locator("button:has-text('Milieu Centraal raadt stekkerbatterijen af: lees waarom')").first().click();
  assert.equal(await page.evaluate(() => document.activeElement.id), "stekkeradvies");
  assert.equal(await page.evaluate(() => location.hash), runHash);
  // De kostenopbouw telt de startposten op tot de startinvestering van de gekozen accu.
  await page.click(`[role=tab]:has-text("Kostenopbouw")`);
  const costPanel = page.locator("[role=tabpanel]:not([hidden])");
  assert.match(await costPanel.textContent(), /Startinvestering per kostenpost.*Accu of complete pakketprijs/);
  const costTable = costPanel.locator("table", { has: page.locator("caption", { hasText: "Kostenposten van" }) });
  const costCheck = await costTable.evaluate(table => {
    const value = text => Number(text.replace(/[^\d,−-]/g, "").replace("−", "-").replace(",", "."));
    const rows = [...table.querySelectorAll("tbody tr")].map(r => [...r.cells].map(c => c.textContent));
    const end = rows.findIndex(r => r[0] === "Startinvestering");
    const parts = rows.slice(0, end).filter(r => r[2].includes("€")).reduce((sum, r) => sum + value(r[2]), 0);
    return { parts, total: value(rows[end][2]) };
  });
  assert.ok(costCheck.total > 0 && Math.abs(costCheck.parts - costCheck.total) < 0.02, JSON.stringify(costCheck));
  for (const tab of ["Kasstromen", "Energie", "Gevoeligheid", "Invoer en aannames"]) {
    await page.click(`[role=tab]:has-text("${tab}")`);
  }
  assert.match(await page.textContent("[role=tabpanel]:not([hidden])"), /Terugleveringsvariant/);
  // De offertecheck noemt per vraag de waarde waarmee is gerekend; de keuzehulp neemt levensduur en
  // capaciteitsverlies altijd aan. Het afdrukblad bevat geen besparing, grensprijs of energiegegevens.
  await page.click(`[role=tab]:has-text("Offertecheck")`);
  const check = await page.textContent("[role=tabpanel]:not([hidden])");
  assert.match(check, /Bruikbare capaciteit[\s\S]*kWh bruikbaar/);
  assert.match(check, /capaciteitsverlies per jaar\s*aanname: vraag dit eerst/);
  assert.match(check, /Belastingdienst/);
  await page.evaluate(() => { window.print = () => { window.printed = true; }; });
  await page.click("button:has-text('Druk af voor de installateur')");
  assert.equal(await page.evaluate(() => window.printed && document.body.classList.contains("print-check")), true);
  const sheet = await page.textContent("#print-sheet");
  assert.match(sheet, /Offertecheck: .+Offerte zegt/);
  assert.doesNotMatch(sheet, /NPV|Lonend|netto voordeel|bespaart|kWh per jaar|€/i);
  // Aannames staan bovenaan, zodat je ze aan tafel niet hoeft te zoeken.
  assert.match(await page.textContent("#print-sheet tbody tr:first-child"), /aanname: vraag dit eerst/);
  // Afgedrukt is alleen het blad zichtbaar.
  await page.emulateMedia({ media: "print" });
  assert.deepEqual([await page.isVisible("#print-sheet"), await page.isVisible("#view")], [true, false]);
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => dispatchEvent(new Event("afterprint")));
  assert.equal(await page.evaluate(() => document.body.classList.contains("print-check")), false);
  // Op een telefoon schuift geen enkel tabblad van de uitkomst zijwaarts.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForSelector(".verdict");
  for (const tab of await page.$$eval("[role=tab]", tabs => tabs.map(t => t.textContent))) {
    await page.click(`[role=tab]:has-text("${tab.replace(/ \(\d+\)/, "")}")`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(over <= 0, `${tab}: ${over}px te breed`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // Delen: de link bevat de uitkomst zonder adres en opent ook in een browser zonder deze gegevens.
  await page.click("button:has-text('Deel als link')");
  const shared = await page.getByLabel("Link naar deze berekening").inputValue();
  assert.match(shared, /#\/gedeeld\/[A-Za-z0-9_-]+$/);
  // Alleen de beslissende opties gaan mee, zodat de link in een bericht past (zo'n 25.000 tekens bij 50 accu's).
  assert.ok(shared.length < 60000, `${shared.length} tekens`);
  const title = await page.textContent("#page-title");
  const other = await open();
  await other.page.goto(shared);
  await other.page.waitForSelector(".verdict", { timeout: 30000 });
  assert.equal(await other.page.textContent("#page-title"), title);
  const view = await other.page.textContent("#view");
  assert.match(view, /Gedeelde berekening/);
  assert.match(view, /Adres niet gedeeld/);
  assert.match(view, /De link bevat \d+ van de \d+ doorgerekende accu’s/);
  assert.equal(await other.page.locator("button:has-text('Pas aan')").count(), 0);
  assert.doesNotMatch(await other.page.textContent("#page-actions"), /null/);
  assert.equal(await other.page.getAttribute("#page-actions a:has-text('Reken je eigen situatie door')", "href"), "#/keuzehulp");
  // Een afgebroken link geeft een melding in plaats van een fout.
  await other.page.goto(shared.slice(0, -40));
  await other.page.waitForSelector("text=Deze link werkt niet");
  assert.deepEqual(other.problems, []);
  await other.close();

  // Verwijderen vanuit het overzicht vraagt eerst bevestiging; Annuleren heeft de focus.
  await page.goto(`${base}/#/berekeningen`);
  const runRow = page.locator("tr", { has: page.locator(`a[href="${runHash}"]`) });
  await runRow.locator("button:has-text('Verwijder')").click();
  const ask = page.locator("dialog[open]");
  assert.match(await ask.textContent(), /kan niet ongedaan worden gemaakt.*Het energieprofiel blijft staan/);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Annuleren");
  await ask.locator("button:has-text('Annuleren')").click();
  assert.equal(await runRow.count(), 1);
  await runRow.locator("button:has-text('Verwijder')").click();
  await page.locator("dialog[open] button:has-text('Verwijder berekening')").click();
  await runRow.waitFor({ state: "detached" });
  await page.goto(`${base}/${runHash}`);
  await page.waitForSelector("text=Berekening niet gevonden");
  assert.deepEqual(problems, []);
  await close();
});

test("keuzehulp zonder zonnepanelen rekent ter controle alleen de goedkoopste accu’s door", async () => {
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/keuzehulp`);
  await page.click("label:has-text('Nee') >> nth=0");
  await page.getByLabel("Stroom van het net per jaar (kWh)").fill("2800");
  await next(page);
  await next(page);
  for (const indication of await page.$$("button:has-text('Gebruik de indicatie')")) await indication.click();
  await next(page);
  await next(page);
  await page.waitForSelector(".product-group", { timeout: 30000 });
  const advice = await page.textContent(".wizard-body");
  assert.match(advice, /Zonder zonnepanelen is er geen zonnestroom om op te slaan/);
  assert.match(advice, /We rekenen de 5 goedkoopste van de \d+ accu’s door/);
  assert.doesNotMatch(advice, /zinvol bereik/);
  assert.match(await page.textContent(".product-group:last-of-type"), /ter controle rekenen we alleen de 5 goedkoopste door/);
  for (const box of await page.$$("fieldset .check input")) await box.check();
  await page.click("button:has-text('Bereken mijn advies')");
  await page.waitForFunction(() => /berekeningen\/\d+/.test(location.hash), null, { timeout: 60000 });
  assert.match(await page.textContent(".verdict"), /[Gg]een accu/);
  // Wat er zou moeten veranderen, met een getal uit deze berekening per regel.
  const noBattery = await page.textContent(".plain");
  assert.match(noBattery, /Dat verandert als:.*(minder kost dan ongeveer €\s*[\d.]+ \(nu €\s*[\d.]+\)|zelfs gratis niet lonend)/);
  assert.match(noBattery, /Bewaar deze berekening .* ‘Lonend’ betekent hier/);
  assert.doesNotMatch(noBattery, /warmtepomp vanaf/);
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
  await page.getByLabel("Maximaal budget (€, optioneel)").fill("1500");
  await next(page);
  await page.waitForSelector(".wizard-body figure.chart", { timeout: 30000 });
  // Boven het budget doet een accu niet mee; een stekkeraccu boven 800 W rekent met 800 W.
  assert.match(await page.textContent(".wizard-body"), /binnen je budget blijven/);
  assert.match(await page.textContent(".product-group:last-of-type"), /Boven je budget van €\s1\.500/);
  assert.match(await page.textContent(".product-group:first-of-type"), /begrensd op 800 W/);
  // De punten staan op afstand naar accugrootte, niet op gelijke afstand.
  const spread = await page.$eval(".wizard-body figure.chart", figure => {
    const sizes = [...figure.querySelectorAll("tbody td:first-child")]
      .map(cell => Number(cell.textContent.replace(/[^\d,]/g, "").replace(",", "."))).filter(Number.isFinite);
    const xs = [...figure.querySelectorAll("circle")].map(c => Number(c.getAttribute("cx")));
    const scale = (xs.at(-1) - xs[0]) / (sizes.at(-1) - sizes[0]);
    return Math.max(...xs.map((x, i) => Math.abs(x - xs[0] - (sizes[i] - sizes[0]) * scale)));
  });
  assert.ok(spread < 0.5, `afwijking ${spread}`);

  // De doelen zetten de schuiven; met het toetsenbord schuiven maakt er een eigen bereik van.
  const low = page.getByLabel("Kleinste accu (bruikbaar)"), high = page.getByLabel("Grootste accu (bruikbaar)");
  const preset = [await low.inputValue(), await high.inputValue()];
  assert.ok(Number(preset[0]) < Number(preset[1]), `bereik ${preset}`);
  await high.focus();
  await page.keyboard.press("End");
  assert.equal(await high.inputValue(), "20");
  assert.match(await page.textContent(".wizard-body .lead"), /Je eigen bereik is een bruikbare capaciteit van \S+ tot 20 kWh/);
  assert.equal(await page.locator("input[name=kh-sizing]:checked").count(), 0);
  // Alleen accu's binnen het bereik gaan mee; de rest staat met de reden bij de niet meegerekende.
  const sizes = () => page.$$eval(".product-group:first-of-type tbody tr td:nth-child(3)",
    cells => cells.map(c => Number(c.textContent.replace(/[^\d,]/g, "").replace(",", "."))));
  await low.focus();
  await page.keyboard.press("Home");
  await high.focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  assert.deepEqual([await low.inputValue(), await high.inputValue()], ["0", "3"]);
  const small = await sizes();
  assert.ok(small.length > 0 && small.every(s => s <= 3), `doorgerekend ${small}`);
  assert.match(await page.textContent(".wizard-body"), /binnen je eigen bereik/);
  assert.match(await page.textContent(".product-group:last-of-type"), /Groter dan je eigen bereik/);
  await low.focus();
  await page.keyboard.press("End");
  assert.equal(await high.inputValue(), "20");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await low.inputValue(), "19.5");
  // Valt niets binnen het bereik, dan gaan de dichtstbijzijnde accu's mee, met die uitleg.
  assert.match(await page.textContent(".wizard-body"), /Geen accu .* valt binnen je eigen bereik/);
  assert.ok((await sizes()).length <= 2);
  await page.click("text=Veel opbrengst per kWh accu");
  assert.deepEqual([await low.inputValue(), await high.inputValue()], preset);
  assert.equal(await page.locator("input[name=kh-sizing][value=value]").isChecked(), true);
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
  // Gemeten netafname en teruglevering zijn bewaard: de capaciteitscurve rekent met de meter.
  await row.locator("a").click();
  await page.waitForSelector("figure.chart >> nth=1", { timeout: 30000 });
  assert.match(await page.textContent("#view"), /volgens de gemeten netafname en teruglevering/);
  assert.equal(await page.locator(".callout", { hasText: "Importeer dit bestand opnieuw" }).count(), 0);
  // Verwijderen uit het overzicht; zonder berekeningen zegt de vraag dat ook.
  await page.goto(`${base}/#/energie`);
  await row.locator("button:has-text('Verwijder')").click();
  assert.match(await page.textContent("dialog[open]"), /Er zijn geen berekeningen op dit profiel/);
  await page.click("dialog[open] button:has-text('Verwijder profiel')");
  await row.waitFor({ state: "detached" });
  assert.deepEqual(problems, []);
  await close();
});

test("Nederlandse export in lokale tijd gaat zonder handwerk naar de keuzehulp", async () => {
  const file = dutchLocalYear(workdir);
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/energie/import`);
  await page.setInputFiles("input[type=file]", file);
  await next(page);
  await page.waitForSelector("text=Kolommen en eenheden");
  // De decimale komma in de voorbeeldrijen zet het decimaalteken.
  assert.equal(await page.getByLabel("Decimaalteken").inputValue(), "comma");
  await next(page);
  await next(page);
  await page.waitForSelector(".stats", { timeout: 30000 });
  // Het dubbele uur bij de overgang naar wintertijd is op volgorde gelezen, zonder gaten.
  assert.match(await page.textContent(".wizard-body"), /als zomertijd en het tweede als wintertijd gelezen/);
  assert.match(await page.textContent(".stats"), /8\.760 uur/);
  await next(page);
  await page.click("button:has-text('Bewaar energieprofiel')");
  await page.waitForFunction(() => /energie\/\d+/.test(location.hash), null, { timeout: 30000 });
  // De periode staat in Nederlandse tijd, met het einde van de laatste meetperiode als ‘tot’.
  // #view bestaat al voordat het profiel geladen is; wacht op de tekst, niet alleen op de nieuwe hash.
  await page.waitForSelector("text=bestand gelezen in tijdzone");
  assert.match(await page.textContent("#view"),
    /Van 1-1-2025, 00:00 CET tot 1-1-2026, 00:00 CET · bestand gelezen in tijdzone Europe\/Amsterdam/);
  // Het profiel opent de keuzehulp met dit bestand gekozen, ook zonder de pagina te herladen.
  await page.click("button:has-text('Gebruik in de keuzehulp')");
  await page.waitForSelector("text=Bewaard energieprofiel");
  assert.equal(await page.locator("input[value=file]").isChecked(), true);
  const profile = page.getByLabel("Bewaard energieprofiel");
  await page.waitForFunction(() => document.querySelectorAll(".wizard-body select option").length > 1);
  assert.match(await profile.evaluate(s => s.selectedOptions[0].textContent), /energiemonitor\.csv/);
  assert.deepEqual(problems, []);
  await close();
});

test("alleen een P1-export: uitleg dat opwek nodig is, kwartierperiode herkend", async () => {
  // Eén synthetische dag met kwartierwaarden van de slimme meter, zonder opwekkolom.
  const lines = ["Datum;Afname (kWh);Teruglevering (kWh)"];
  for (let q = 0; q < 96; q++) {
    const time = `${String(Math.floor(q / 4)).padStart(2, "0")}:${String(q % 4 * 15).padStart(2, "0")}`;
    lines.push(`02-01-2025 ${time};0,070;0,000`);
  }
  const file = path.join(workdir, "p1-dag.csv");
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/energie/import`);
  await page.setInputFiles("input[type=file]", file);
  await next(page);
  await page.waitForSelector("text=Kolommen en eenheden");
  assert.match(await page.textContent(".wizard-body .callout"), /geen kolom met zonne-opwek/);
  assert.equal(await page.getByLabel("Meetperiode").inputValue(), "15min");
  assert.deepEqual(problems, []);
  await close();
});

test("zelf doorrekenen met een eigen offerte, zonder adres", async () => {
  const file = dutchLocalYear(workdir);
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/energie/import`);
  await page.setInputFiles("input[type=file]", file);
  await next(page);
  await page.waitForSelector("text=Kolommen en eenheden");
  await next(page);
  await next(page);
  await page.waitForSelector(".stats", { timeout: 30000 });
  await next(page);
  await page.click("button:has-text('Bewaar energieprofiel')");
  await page.waitForFunction(() => /energie\/\d+/.test(location.hash), null, { timeout: 30000 });

  await page.goto(`${base}/#/zelf`);
  await page.getByLabel("Naam van de berekening").fill("Synthetische offerte");
  // Het adres is optioneel: alleen een label bij de berekening.
  await page.getByLabel(/Energieprofiel/).selectOption({ index: 1 });
  // Een warmtepomp vanaf het tweede jaar telt pas vanaf 1 januari van dat jaar mee.
  await page.click("button:has-text('+ Warmtepomp')");
  assert.equal(await page.getByLabel("Vanaf jaar (1 januari)").inputValue(), "2028");
  await page.getByLabel("Extra verbruik (kWh per jaar)").fill("2500");
  await page.getByText(/Je verbruik vanaf 1 januari 2028: [\d.]+ \+ 2\.500 = ongeveer [\d.]+ kWh/).waitFor();
  await next(page);
  await page.getByLabel("Stroomprijs, alles inbegrepen (€/kWh)").fill("0.25");
  await page.getByLabel("Terugleververgoeding (€/kWh)").fill("0.05");
  await next(page);
  await page.click("button:has-text('+ Eigen optie')");
  const card = page.locator(".option-editor").first();
  for (const [label, value] of [["Bruikbare capaciteit (kWh)", "10"], ["Laden AC (kW)", "5"], ["Ontladen AC (kW)", "5"],
    ["Rendement AC → AC (%)", "88"], ["Sluimerverbruik (W)", "10"], ["Capaciteitsverlies per jaar (%)", "2"],
    ["Levensduur (jaar)", "15"]]) await card.getByLabel(label, { exact: true }).fill(value);
  await card.getByLabel("Bron en aannames van de techniek").fill("Synthetische testinvoer.");
  await card.locator("button:has-text('Vul open posten met indicaties')").click();
  const row = title => card.locator(".cost-row", { hasText: title });
  await row("Accu of complete pakketprijs").getByLabel("Status").selectOption("priced");
  await row("Accu of complete pakketprijs").getByLabel("Bedrag (€)").fill("9000");
  await row("Accu of complete pakketprijs").getByLabel("Bron of aanname").fill("Synthetische offerte");
  await row("Extra/hybride omvormer").getByLabel("Status").selectOption("included");
  await row("Extra/hybride omvormer").getByLabel("Bron of aanname").fill("Synthetische offerte");
  await next(page);
  await page.waitForSelector("text=De invoer is compleet.");
  for (const box of await page.locator(".wizard-body fieldset input[type=checkbox]").all()) await box.check();
  await page.click("button:has-text('Bereken en bewaar')");
  await page.waitForFunction(() => /berekeningen\/\d+/.test(location.hash), null, { timeout: 120000 });
  await page.waitForSelector("text=Wat betekent dit voor jou?");
  const firstRun = await page.evaluate(() => location.hash);
  const view = await page.textContent("#view");
  assert.match(view, /Nederland \(geen adres opgegeven\)/);
  // Een dure offerte verdient zich niet terug; een negatieve ROI krijgt een echt minteken.
  assert.match(view, /ROI over looptijd−\d/);
  // De grens waarboven de offerte niet meer lonend is: startinvestering plus NPV.
  const option = await page.locator("article.option").nth(1).textContent();
  const euros = text => (/[−-]/.test(text) ? -1 : 1) * Number(text.replace(/\D/g, ""));
  const [, investment, npv] = option.match(/Startinvestering(.+?)Netto voordeel \(NPV\)(.+?)Nettowinst/);
  const limit = option.match(/Lonend bij een startinvestering(Tot .+?|Zelfs gratis niet)Eigen gebruik/)[1];
  const expected = euros(investment) + euros(npv);
  // De grens is naar beneden afgerond op € 10.
  if (limit.startsWith("Tot")) assert.ok(euros(limit) <= expected + 1 && euros(limit) > expected - 11, `${limit} ≠ ${expected}`);
  else assert.ok(expected <= 1, `${expected} zou positief zijn`);
  // Geen accu wint: wat er zou moeten veranderen, en de opgegeven warmtepomp zit er al in.
  assert.match(view, /Dat verandert als:de besparing groter wordt: Eigen optie 1 is zelfs gratis niet lonend.*de warmtepomp vanaf 2028 \(2\.500 kWh per jaar erbij\) zit al in deze berekening/);
  // De som voor 2028, het eerste warmtepompjaar, klopt en is gelijk aan het verschil in de jaartabel.
  const amount = text => { const m = text.match(/(−?)[\s\u2060]*€\s*([\d.]+(?:,\d+)?)(?!.*€)/);
    return (m[1] ? -1 : 1) * Number(m[2].replace(/\./g, "").replace(",", ".")); };
  assert.match(view, /In 2028, het eerste jaar met de warmtepomp, gebruikt het huis/);
  const heat = await page.locator(".plain .receipt").nth(1).locator("li").allTextContents();
  const heatTotal = amount(heat[2]);
  const signed = line => (line.startsWith("−") ? -1 : 1) * amount(line);
  assert.ok(Math.abs(signed(heat[0]) + signed(heat[1]) - heatTotal) <= 1, heat.join(" | "));
  // Bij een eigen offerte is de techniek in de offertecheck eigen invoer.
  await page.click(`[role=tab]:has-text("Offertecheck")`);
  await page.getByLabel("Offertecheck voor").selectOption({ label: "Eigen optie 1" });
  const own = await page.textContent("[role=tabpanel]:not([hidden])");
  assert.match(own, /10 kWh bruikbaar\s*jouw invoer/);
  assert.match(own, /Accu of complete pakketprijs €\s*9\.000/);
  // In de jaartabel springt het verbruik in 2028 met de warmtepomp omhoog, met de uitleg eronder.
  await page.click(`[role=tab]:has-text("Kasstromen")`);
  await page.getByLabel("Jaartabel van").selectOption({ label: "Eigen optie 1" });
  const bills = await page.locator("[role=tabpanel]:not([hidden]) table", { hasText: "Bruto verbruik" })
    .evaluate(t => [...t.tBodies[0].rows[1].cells].slice(2, 4).map(c => c.textContent));
  assert.ok(Math.abs(amount(bills[0]) - amount(bills[1]) - heatTotal) <= 1, `${bills} ≠ ${heatTotal}`);
  const yearly = await page.locator("[role=tabpanel]:not([hidden]) table", { hasText: "Bruto verbruik" })
    .evaluate(t => [...t.tBodies[0].rows].map(r => Number(r.cells[1].textContent.replace(/\D/g, ""))));
  assert.ok(Math.abs(yearly[1] - yearly[0] - 2500) < 50, JSON.stringify(yearly.slice(0, 2)));
  assert.match(await page.textContent("[role=tabpanel]:not([hidden])"),
    /Extra verbruik ‘Warmtepomp’: vanaf 1 januari 2028 komt er 2\.500 kWh per jaar bij/);
  // Een kopie begint met een leeg adresveld, niet met de omschrijving, en houdt de warmtepomp.
  await page.click("text=Pas aan en reken opnieuw");
  await page.waitForSelector("text=Profiel en doel");
  assert.equal(await page.getByLabel("Adres in Nederland (optioneel)").inputValue(), "");
  assert.equal(await page.getByLabel("Extra verbruik (kWh per jaar)").inputValue(), "2500");
  // Antwoorden uit de offerte (Nederlandse notatie) geven een nieuwe berekening; de oude blijft bewaard.
  await page.goto(`${base}/${firstRun}`);
  await page.click(`[role=tab]:has-text("Offertecheck")`);
  await page.getByLabel("Offerte zegt: bruikbare capaciteit (kWh)").fill("9,3");
  await page.getByLabel("Offerte zegt: sluimerverbruik (W)").fill("15");
  await page.getByLabel("Offerte zegt: totaalprijs inclusief btw (euro)").fill("8750");
  // Een vaste prijs laat de reserve vervallen; wat de offerte niet noemt (de eerste post) blijft apart staan.
  await page.getByLabel("Vaste prijs of onder voorbehoud van schouw?").selectOption("fixed");
  const kept = page.locator(".price-terms .check").first();
  const keptAmount = Number((await kept.textContent()).match(/geschat €\s*([\d.]+)/)[1].replace(/\./g, ""));
  await kept.locator("input").uncheck();
  const start = (8750 + keptAmount).toLocaleString("nl-NL");
  await page.click("button:has-text('Reken opnieuw met de offerte')");
  await page.waitForSelector("text=Controle en berekenen");
  const review = await page.textContent("#view");
  assert.match(review, new RegExp(`Uit de offerte.*bruikbare capaciteit 10 kWh → 9,3 kWh; sluimerverbruik 10 W → 15 W; startkosten vóór teruggaven €\\s*[\\d.,]+ → €\\s*${start.replace(".", "\\.")}`));
  assert.match(review, /bewust opnieuw aan/);
  for (const box of await page.locator(".wizard-body fieldset input[type=checkbox]").all()) await box.check();
  await page.click("button:has-text('Bereken en bewaar')");
  await page.waitForFunction(old => /berekeningen\/\d+/.test(location.hash) && location.hash !== old, firstRun, { timeout: 120000 });
  await page.waitForSelector("text=Herberekend met de antwoorden uit je offerte");
  const quotedView = await page.textContent("#view");
  assert.match(quotedView, /bruikbare capaciteit 10 kWh → 9,3 kWh; sluimerverbruik 10 W → 15 W; startkosten vóór teruggaven/);
  assert.doesNotMatch(quotedView, /nog de schatting|raadt stekkerbatterijen/);
  assert.match(quotedView, /is nu lonend tot ongeveer €\s*[\d.]+; met de oorspronkelijke waarden was dat €\s*[\d.]+/);
  await page.click(`[role=tab]:has-text("Offertecheck")`);
  const quotedCheck = await page.textContent("[role=tabpanel]:not([hidden])");
  assert.match(quotedCheck, /9,3 kWh bruikbaar\s*offerte/);
  assert.match(quotedCheck, new RegExp(`€\\s*${start.replace(".", "\\.")} startinvestering na teruggaven`));
  assert.deepEqual(problems, []);
  await close();
});

test("eigen accu met een offerte in Nederlandse notatie rekent mee in de keuzehulp", async () => {
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/accus`);
  await page.waitForSelector("table", { timeout: 30000 });
  await page.click("button:has-text('+ Eigen accu of offerte')");
  const dialog = page.locator("dialog[open]");
  assert.equal(await dialog.getByLabel("Markt of regio").inputValue(), "Nederland");
  await dialog.getByLabel("Fabrikant").fill("Fictief Merk");
  await dialog.getByLabel("Productnaam").fill("Voorbeeldaccu 10");
  await dialog.getByLabel("Concrete uitvoering").fill("1 unit · 10 kWh · fictieve offerte");
  await dialog.getByLabel("Bruikbare energie (kWh)").fill("9.6");
  await dialog.getByLabel("Continu laden (kW)").fill("5");
  await dialog.getByLabel("Continu ontladen (kW)").fill("5");
  await dialog.getByLabel("Meetgrens vermogen").selectOption("system_ac");
  // Zonder soort en omvormer zou de keuzehulp deze accu overslaan: de omvormer bleef dan een onbekende kostenpost.
  await dialog.getByLabel("Aansluiting").selectOption({ label: "Vaste installatie" });
  await dialog.getByLabel("Omvormer").selectOption({ label: "Zit in het product" });
  await dialog.getByLabel("Aanschafbedrag").fill("€ 6.500,00");
  await dialog.getByLabel("Verkoper").fill("Fictieve installateur");
  await dialog.getByLabel("Belastingbasis").selectOption("included");
  await dialog.getByLabel("Installatie inbegrepen").selectOption("true");
  await dialog.locator("button:has-text('Bewaar')").click();
  await page.waitForSelector("text=Opgeslagen als nieuwe bron");
  await page.fill("#view input[type=search]", "Fictief");
  assert.match(await page.textContent(".table-wrap"), /€\s6\.500 incl\. btw/);

  await page.goto(`${base}/#/keuzehulp`);
  await page.getByLabel("Stroom van het net per jaar (kWh)").fill("3500");
  await page.getByLabel("Teruggeleverd aan het net per jaar (kWh)").fill("2500");
  await page.getByLabel("Opwek van je panelen per jaar (kWh)").fill("4500");
  await next(page);
  await next(page);
  await page.click("button:has-text('Gebruik de indicatie')");
  await next(page);
  await next(page);
  await page.waitForSelector(".product-group", { timeout: 30000 });
  const row = page.locator(".product-group:first-of-type tr", { hasText: "Fictief Merk Voorbeeldaccu 10" });
  assert.match(await row.textContent(), /Vast.*9,6 kWh.*5,0 kW.*€\s6\.500/);
  assert.deepEqual(problems, []);
  await close();
});

test("rendement en sluimerverbruik uit bronclaims: voorzichtig en niet dubbel", async () => {
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/accus`);
  await page.waitForSelector("table", { timeout: 30000 });
  const solarCube = await page.evaluate(async () => {
    const cmp = await UI.api("/api/v1/comparison");
    return Object.fromEntries(cmp.configurations.filter(c => c.product_name === "SolarCube Pro")
      .map(c => [c.name, Data.describe(cmp, c)])
      .map(([name, p]) => [name, { efficiency: p.efficiency, standby: p.standby, notes: p.notes.join(" ") }]));
  });
  // Onderzochte set 3: gesloten cyclus 81,29% aan het stopcontact; de 80,05% over dezelfde cyclus bevat het
  // eigen verbruik in rust al en zou het met het sluimerverbruik dubbel tellen.
  const plug = solarCube["1 unit · 6 kWh · stekker 800 W"], circuit = solarCube["1 unit · 6 kWh · eigen groep (hogere netstand)"];
  assert.equal(plug.efficiency, 81.29);
  assert.match(plug.notes, /Rendement 80,05% \(claim #\d+\) bevat ook het eigen verbruik in rust/);
  // Sluimerverbruik: 9,3 W aan het stopcontact met het apparaat uit, maar in bedrijf 50,6 W in de rustfasen
  // (800 W-stand) en 41 tot 47 W bij 0 W vraag (3000 W-stand). De hoogste waarde aan de AC-kant telt.
  assert.equal(plug.standby, 50.6);
  assert.equal(circuit.standby, 41);
  assert.match(plug.notes, /hoogste waarde aan de AC-kant of zonder vermelde meetgrens/);
  // Een bovengrens (‘tot 90%’) is geen verwachte waarde: dan geldt de voorzichtige aanname.
  const nexus = await page.evaluate(async () => {
    const cmp = await UI.api("/api/v1/comparison");
    const p = Data.describe(cmp, cmp.configurations.find(c => c.product_name === "Nexus thuisbatterij"));
    return { efficiency: p.efficiency, notes: p.notes.join(" ") };
  });
  assert.equal(nexus.efficiency, 77);
  assert.match(nexus.notes, /Rendement 90% \(claim #\d+\) is een bovengrens/);
  assert.deepEqual(problems, []);
  await close();
});

test("na drie maanden waarschuwt de catalogus voor verouderde prijzen", async () => {
  const { page, problems, close } = await open();
  await page.clock.setFixedTime(new Date("2026-11-30T12:00:00"));
  await page.goto(`${base}/#/accus`);
  // De browserversie begint per test met een lege database; de onderzochte sets komen er vanzelf in.
  await page.waitForSelector("table", { timeout: 30000 });
  assert.equal(await page.locator(".callout", { hasText: "verouderd" }).count(), 0);
  assert.doesNotMatch(await page.textContent("#view"), /null/);
  await page.clock.setFixedTime(new Date("2027-02-01T12:00:00"));
  await page.reload();
  await page.waitForSelector("table");
  assert.match(await page.locator(".callout").first().textContent(), /3 maanden geleden/);
  assert.deepEqual(problems, []);
  await close();
});

test("instellingen: Nederlandse meldingen en de looptijd geldt ook in de keuzehulp", async () => {
  const { page, problems, close } = await open({ locale: "en-US" });
  await page.goto(`${base}/#/instellingen`);
  await page.getByLabel("Looptijd (jaren)").fill("40");
  await page.getByLabel("Discontovoet per jaar (%)").fill("");
  await page.click("button:has-text('Bewaar')");
  // Ook in een Engelstalige browser zijn de meldingen Nederlands, met dezelfde grenzen als Zelf doorrekenen.
  assert.deepEqual(await page.$$eval(".field .error", errors => errors.map(e => e.textContent)),
    ["Vul 30 of minder in.", "Vul dit veld in."]);
  await page.getByLabel("Looptijd (jaren)").fill("12");
  await page.getByLabel("Discontovoet per jaar (%)").fill("3");
  await page.click("button:has-text('Bewaar')");
  await page.waitForSelector("text=Standaardaannames bewaard");
  await page.goto(`${base}/#/keuzehulp`);
  await page.getByLabel("Stroom van het net per jaar (kWh)").fill("3000");
  await page.getByLabel("Teruggeleverd aan het net per jaar (kWh)").fill("2000");
  await page.getByLabel("Opwek van je panelen per jaar (kWh)").fill("3500");
  await next(page);
  await next(page);
  await page.click("button:has-text('Gebruik de indicatie')");
  await next(page);
  const horizon = page.getByLabel("Hoe ver wil je vooruitkijken?");
  assert.equal(await horizon.inputValue(), "12");
  assert.equal(await horizon.locator("option:checked").textContent(), "12 jaar");
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
  // De catalogus wordt op een telefoon een lijst kaartjes, met de kolomkop bij elke waarde.
  await page.goto(`${base}/#/accus`);
  await page.waitForSelector("table.stack", { timeout: 30000 });
  assert.equal(await page.$eval("table.stack td:nth-child(4)", td => getComputedStyle(td, "::before").content), "\"Prijs\"");
  const sideways = await page.$eval(".table-wrap", wrap => wrap.scrollWidth - wrap.clientWidth);
  assert.ok(sideways <= 1, `catalogus schuift ${sideways}px zijwaarts`);
  assert.deepEqual(problems, []);
  await close();
});

test("browserversie bewaart gegevens in deze browser en maakt een back-up", { skip: !BROWSER_MODE }, async () => {
  const { page, problems, close } = await open({ acceptDownloads: true });
  await page.goto(`${base}/#/accus`);
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
