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
// Vervangt in de browserversie de tekst van worker.js, om fouten na te bootsen; null levert het gebouwde bestand.
let patchWorker = null;
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
      if (relative === "worker.js" && patchWorker) response.end(patchWorker(fs.readFileSync(file, "utf8")));
      else fs.createReadStream(file).pipe(response);
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
// Tekstknopen met ‘null’, ‘undefined’ of ‘NaN’: een waarde die als tekst in de pagina belandde.
const strayText = page => page.evaluate(() => {
  const walker = document.createTreeWalker(document.getElementById("view"), NodeFilter.SHOW_TEXT), found = [];
  while (walker.nextNode()) if (/\b(null|undefined|NaN)\b/.test(walker.currentNode.data)) found.push(walker.currentNode.data);
  return found;
});

// Synthetisch jaar: omvormer per kwartier, slimme meter per uur, zonder bestaande accu.
function syntheticYear(dir) {
  // Teruglevering vóór ‘levering’ (afname, zoals leveranciers het noemen): de kolomkeuze mag ze niet verwarren.
  const inverter = ["tijdstip,opwek_kwh"], meter = ["datum,teruglevering_kwh,levering_kwh"];
  // Dezelfde meter als cumulatieve tellerstanden per tarief, zoals een P1-logger ze exporteert: T1 overdag, T2 ’s nachts.
  const readings = ["time,Import T1 kWh,Import T2 kWh,Export T1 kWh,Export T2 kWh"];
  const counters = [12345.678, 23456.789, 3456.789, 4567.891];
  const reading = time => readings.push(`${time.toISOString().slice(0, 19)}Z,${counters.map(c => c.toFixed(3)).join(",")}`);
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
    meter.push(`${time.toISOString().slice(0, 19)}Z,${Math.max(0, produced - load).toFixed(4)},`
      + `${Math.max(0, load - produced).toFixed(4)}`);
    reading(time);
    const tariff = h >= 7 && h < 23 ? 0 : 1;
    counters[tariff] += Math.max(0, load - produced);
    counters[2 + tariff] += Math.max(0, produced - load);
  }
  reading(new Date(start + 8760 * 3600e3));
  const files = { inverter: path.join(dir, "omvormer.csv"), meter: path.join(dir, "p1.csv"),
    readings: path.join(dir, "p1-standen.csv") };
  fs.writeFileSync(files.inverter, `${inverter.join("\n")}\n`);
  fs.writeFileSync(files.meter, `${meter.join("\n")}\n`);
  fs.writeFileSync(files.readings, `${readings.join("\n")}\n`);
  return files;
}

// Synthetisch jaar zoals een Nederlandse energiemonitor: puntkomma, decimale komma en lokale tijd,
// dus zonder 02.00 uur eind maart en met 02.00 uur twee keer eind oktober.
// `baseLoad`: verbruik per uur buiten de avond; een andere waarde geeft een ander bestand, dus een nieuw profiel.
function dutchLocalYear(dir, hours = 8760, name = "energiemonitor.csv", timeZone = "Europe/Amsterdam", baseLoad = 0.25) {
  const lines = ["Datum;Opwek (kWh);Verbruik (kWh)"];
  const local = new Intl.DateTimeFormat("nl-NL", { timeZone, day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const start = Date.UTC(2024, 11, 31, 23);
  for (let hour = 0; hour < hours; hour++) {
    const parts = Object.fromEntries(local.formatToParts(new Date(start + hour * 3600e3)).map(p => [p.type, p.value]));
    const h = Number(parts.hour);
    const solar = h >= 7 && h < 19 ? 0.4 * Math.sin(Math.PI * (h - 7) / 12) : 0;
    const load = baseLoad + (h >= 17 && h < 22 ? 0.6 : 0);
    const comma = v => v.toFixed(3).replace(".", ",");
    lines.push(`${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute};${comma(solar)};${comma(load)}`);
  }
  const file = path.join(dir, name);
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
  // Zonder opwek staat de fout bij het veld waar je hem oplost, met de focus daar, en wordt hij voorgelezen.
  await next(page);
  const production = page.getByLabel("Opwek van je panelen per jaar (kWh)");
  assert.equal(await production.evaluate(el => el === document.activeElement), true);
  const describedBy = await production.getAttribute("aria-describedby");
  assert.match(await page.textContent(`[id="${describedBy.split(" ").pop()}"]`), /Vul de opwek van je panelen in, of hieronder het vermogen in kWp/);
  await production.fill("3800");
  await page.getByLabel("Waarvan warmtepomp (kWh per jaar)").fill("1500");
  // Een jaartotaal zoals op de jaarafrekening: ‘4.600’ is 4600 kWh, ook met komma en decimalen.
  const gridImport = page.getByLabel("Stroom van het net per jaar (kWh)");
  await gridImport.fill("4.600");
  assert.match(await page.textContent(".derived"), /5\.500 kWh/);
  await gridImport.fill("4.600,00");
  assert.match(await page.textContent(".derived"), /5\.500 kWh/);
  await next(page);
  await page.waitForSelector("text=Je woning");
  // Na Volgende staat de focus op de kop van de nieuwe stap.
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Je woning");
  await page.click("text=Zelf, met de stekker");
  await next(page);
  // Alleen het leveringstarief invullen geeft een waarschuwing; de indicatie (met energiebelasting) niet.
  const price = page.getByLabel("Prijs voor stroom van het net (€ per kWh, alles inbegrepen)");
  await price.fill("0,14");
  assert.match(await page.textContent(".live-check"), /Is dit alleen het leveringstarief\?/);
  await page.click("button:has-text('Gebruik de indicatie')");
  assert.equal(await price.inputValue(), "0,2552");
  assert.equal(await page.textContent(".live-check"), "");
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
  // De knop staat in de vaste balk; zonder bevestigingen gaat de focus naar de eerste, met de melding erbij.
  // Vóór het berekenen staan de antwoorden op een rij, met een weg terug naar elke stap.
  const recap = await page.textContent(".recap");
  assert.match(recap, /Verbruik 5\.500 kWh per jaar/);
  assert.match(recap, /Opwek 3\.800 kWh per jaar/);
  assert.equal(await page.locator(".recap button:has-text('Wijzig')").count(), 4);
  const calculate = page.locator(".wizard-footer button:has-text('Bereken mijn advies')");
  await calculate.click();
  assert.equal(await page.evaluate(() => document.activeElement.closest(".check") !== null), true);
  assert.match(await page.textContent(".wizard-body fieldset .error"), /Vink elke bevestiging aan/);
  for (const box of await page.$$("fieldset .check input")) await box.check();
  await calculate.click();
  // Vijftig accu's doorrekenen duurt met de debug-build in CI zo'n 20 tot ruim 30 seconden.
  await page.waitForFunction(() => /berekeningen\/\d+/.test(location.hash), null, { timeout: 120000 });
  const runHash = await page.evaluate(() => location.hash);
  // De titel zegt waarmee is gerekend, zodat berekeningen van dezelfde dag uit elkaar te houden zijn.
  await page.waitForSelector("#page-title:text-is('Keuzehulp: 5.500 kWh verbruik, 3.800 kWh opwek, stekker')");
  // Liggen de beste twee binnen de onzekerheid, dan noemt het korte antwoord de nummer twee (aangepaste kopie van deze run).
  const closeCall = await page.evaluate(async id => {
    const run = structuredClone(await Data.run(id)), [a, b, ...others] = run.result.candidates;
    run.input.request.parameters.objective = "net_present_value";
    run.result.recommended_key = a.key;
    Object.assign(a, { npv_eur: 900, initial_investment_eur: 2000, within_budget: true, pessimistic: { ...a.pessimistic, npv_eur: 500 } });
    Object.assign(b, { npv_eur: 880, initial_investment_eur: 1750, within_budget: true, pessimistic: { ...b.pessimistic, npv_eur: 600 } });
    for (const c of others) c.npv_eur = Math.min(c.npv_eur, 0);
    const view = document.createElement("div");
    await Results.render(run, view, document.createElement("div"), () => {});
    return view.querySelector(".verdict-close")?.textContent;
  }, Number(runHash.match(/\d+/)[0]));
  assert.match(closeCall, /^Bijna even goed: .+\. Netto €\s20 minder, €\s250 goedkoper in aanschaf\. Bij ongunstiger prijzen en kosten komt die zelfs beter uit\. Dat verschil valt binnen de onzekerheid/);
  // Accu's met een bekende garantie krijgen de garantiestresstest; de kaart noemt de grensprijs daarvan.
  const stressed = await page.evaluate(async id => {
    const run = await Data.run(id);
    return run.input.request.candidates.filter(c => c.warranty_stress)
      .map(c => run.result.candidates.find(r => r.key === c.key).warranty_stress?.break_even_investment_eur != null);
  }, Number(runHash.match(/\d+/)[0]));
  assert.ok(stressed.length > 0 && stressed.every(Boolean));
  // Het capaciteitsbereik uit stap 1 gaat met de run mee; wint een accu, dan zegt het advies of hij erbinnen valt.
  const sizing = await page.evaluate(async id => (await Data.run(id)).input.request.sizing_range, Number(runHash.match(/\d+/)[0]));
  // Hierboven is het bereik met de schuifjes op het volle bereik gezet.
  assert.equal(sizing.label, "je eigen bereik");
  assert.ok(sizing.low_kwh === 0 && sizing.high_kwh > 0);
  if (await page.locator(".verdict .stats").count())
    assert.match(await page.textContent(".verdict"), /bruikbaar\) valt binnen je eigen bereik van 0 tot [\d,]+ kWh\./);
  assert.match((await page.locator(".more-figures").allTextContents()).join(" "), /Stopt na de garantie \(\d+ jaar\): lonend tot/);
  const summary = await page.textContent(".plain");
  // De tarieven staan direct onder het antwoord; de woordenlijst staat in de uitleg.
  assert.match(await page.textContent(".rates"), /^Gerekend met stroom €\s[\d,]+ per kWh · terugleververgoeding €\s[\d,]+ per kWh/);
  assert.match(summary, /Wat betekenen deze woorden\?.*Zelfvoorziening/s);
  // De garantiestresstest is één waarschuwing met een tabel per accu, niet een zin per accu.
  const warningTexts = await page.locator(".warnings > li").allTextContents();
  assert.equal(warningTexts.filter(w => w.startsWith("Garantiestresstest bij")).length, stressed.length === 1 ? 1 : 0);
  assert.equal(warningTexts.filter(w => /^Garantiestresstest voor \d+ accu’s/.test(w)).length, stressed.length > 1 ? 1 : 0);
  assert.ok(await page.isVisible("[role=tab]:has-text('Waarschuwingen (" + warningTexts.length + ")')"));
  // Het gratis alternatief staat erbij, met de waarde per verschoven kWh.
  assert.match(summary, /Elke kWh die je naar zonuren verschuift .+ levert €\s*0,\d\d op/);
  // Bij een lonende accu staan de grensprijzen in een tabel, met de stresstests als eigen regels.
  if (!/Dat verandert als:/.test(summary)) assert.match(summary, /Grensprijs voor .+Zoals berekend \(alle startposten\).+Geen terugleververgoeding vanaf 2030/);
  // Wint geen accu, dan zegt ‘Dat verandert als’ wat er anders moet, met de stresstest als regel.
  const whatIf = /Dat verandert als:/.test(summary);
  assert.match(summary, whatIf
    ? /teruglevering vanaf 2030 niets meer oplevert \(‘Geen terugleververgoeding[^’]*’\): (dan komt .+ wel het beste uit|dan is .+ lonend tot ongeveer €\s*[\d.]+0|ook dan is .+ zelfs gratis niet lonend)\./
    : /Als teruglevering vanaf 2030 niets meer oplevert/);
  // De besparing van jaar 1 is na te rekenen en komt uit op hetzelfde bedrag als de samenvatting noemt.
  const euro = text => (/[−-]/.test(text) ? -1 : 1) * Number(text.replace(/\D/g, ""));
  const saving = await page.textContent(".verdict .stats div:has(dt:text-is('Besparing in jaar 1')) dd");
  const receipt = await page.locator(".plain .receipt li").allTextContents();
  const [, gain] = receipt[0].match(/^\+ [\d.]+ kWh minder van het net × €\s*[\d,]+ = (€\s*[\d.]+)$/);
  const [, sign, lost] = receipt[1].match(/^([+−]) [\d.]+ kWh minder teruggeleverd × €\s*[\d,]+ \(.+\) = (€\s*[\d.]+)$/);
  const [, total] = receipt[2].match(/^= (−?⁠?€\s*[\d.]+) per jaar$/);
  assert.ok(Math.abs(euro(total) - euro(saving)) <= 1, `${total} ≠ ${saving}`);
  assert.ok(Math.abs(euro(gain) + (sign === "−" ? -1 : 1) * euro(lost) - euro(total)) <= 1);
  // Met de indicatie vallen in de variant vergoeding én terugleverkosten weg: een niet teruggeleverde kWh scheelt niets.
  assert.match(summary, /wordt de tweede regel vanaf 2030: \+ [\d.]+ kWh minder teruggeleverd × €\s*0,0000 \(vergoeding €\s*0,0000 − terugleverkosten €\s*0,0000\) = €\s*0, samen €\s*[\d.]+ per jaar/);
  assert.match(summary, /‘Lonend’ betekent hier: de besparing verdient de investering binnen 15 jaar terug en levert daarbovenop 4,0% per jaar op/);
  // De grens voor een offerte, ook zonder terugleververgoeding.
  if (!whatIf) assert.match(summary, /(lonend zolang de startinvestering niet boven ongeveer €\s*[\d.]+ komt|ook als hij gratis zou zijn).* In de variant ‘Geen terugleververgoeding vanaf 2030’ (ligt die grens bij €\s*[\d.]+0(: hoger, omdat zelf opslaan meer waard wordt als terugleveren minder oplevert of geld kost)?|is hij zelfs gratis niet lonend)\./);
  assert.match(summary, /geschat uit jaartotalen/);
  // Met de stekker staat het veiligheidsadvies boven de som, met het vermogen waarmee is gerekend; de kaart
  // van een stekkerbatterij springt ernaartoe zonder de pagina te verlaten.
  assert.match(summary, /Milieu Centraal raadt stekkerbatterijen op dit moment af\. Dit gaat over: .+\. De reden.*ten hoogste 800 W in het stopcontact.*Voor .+ is gerekend met [\d,]+ kW ontladen.*energieleveren\.nl/);
  assert.ok(summary.indexOf("raadt stekkerbatterijen op dit moment af") < summary.indexOf("Zo reken je de besparing"));
  // Elke kaart noemt aansluiting, bruikbare capaciteit en vermogen; de grafiek gebruikt korte namen met dezelfde gegevens.
  assert.match(await page.locator("article.option").nth(1).textContent(), /Stekker · [\d,]+ kWh bruikbaar · 0,8 kW ontladen, [\d,]+ kW laden/);
  assert.match(await page.locator("figure.chart").first().textContent(), /Stekker 0,8 kW · .+? · [\d,]+ kWh/);
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
  // Lange lijsten: de beste vijf in beeld, de rest ingeklapt.
  assert.match(await page.textContent("[role=tabpanel]:not([hidden])"), /Toon de invoer van de overige \d+ opties/);
  // Gewoon afdrukken geeft het overzicht en de waarschuwingen; ‘Alles afdrukken’ alle tabbladen.
  const printed = () => page.$$eval("[role=tabpanel]", panels => panels.map(p => getComputedStyle(p).display !== "none"));
  await page.emulateMedia({ media: "print" });
  assert.deepEqual(await printed(), [true, true, false, false, false, false, false, false]);
  assert.equal(await page.locator(".all-options").first().isVisible(), false);
  await page.evaluate(() => document.body.classList.add("print-all"));
  assert.ok((await printed()).every(Boolean));
  await page.evaluate(() => document.body.classList.remove("print-all"));
  await page.emulateMedia({ media: "screen" });
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
  // De tabbladen staan in drie kolommen op drie regels, allemaal in beeld.
  const tops = await page.$$eval("[role=tab]", tabs => new Set(tabs.map(t => t.offsetTop)).size);
  assert.ok(tops <= 3, `tabbladen lopen over ${tops} regels`);
  assert.ok(await page.evaluate(() => [...document.querySelectorAll("[role=tab]")].every(t => t.getBoundingClientRect().right <= innerWidth)));
  for (const tab of await page.$$eval("[role=tab]", tabs => tabs.map(t => t.textContent))) {
    await page.click(`[role=tab]:has-text("${tab.replace(/ \(\d+\)/, "")}")`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(over <= 0, `${tab}: ${over}px te breed`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // ‘Pas aan en reken opnieuw’ neemt bij meer dan twaalf opties de beste over, zodat er nog een eigen optie bij past.
  const candidates = await page.evaluate(async hash => (await UI.api(`/api/v1/analysis/runs/${hash.split("/").pop()}`)).input.request.candidates.length, runHash);
  await page.click("text=Pas aan en reken opnieuw");
  await page.waitForSelector("text=Profiel en doel");
  const copied = (await page.evaluate(() => JSON.parse(localStorage.getItem("thuisaccu-scenario")))).options.length;
  if (candidates > 12) {
    assert.ok(copied >= 5 && copied <= 7, `${copied} van ${candidates}`);
    assert.match(await page.textContent(".toast"), new RegExp(`Kopie geladen met de ${copied} beste van ${candidates} opties`));
  } else assert.equal(copied, candidates);
  await page.goto(`${base}/${runHash}`);
  await page.waitForSelector(".verdict", { timeout: 30000 });

  // Delen: de link bevat de uitkomst zonder adres en opent ook in een browser zonder deze gegevens.
  await page.click(".actions .menu summary");
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
  // De verwijderde berekening geeft bewust een 404 van de server; de browser meldt dat in de console.
  assert.deepEqual(problems.filter(p => !/status of 404/.test(p)), []);
  await close();
});

test("keuzehulp zonder zonnepanelen rekent ter controle alleen de goedkoopste accu’s door", async () => {
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/keuzehulp`);
  await page.click("label:has-text('Nee') >> nth=0");
  // Meteen bij de vraag, niet pas na vier stappen: wat een accu zonder panelen in dit model betekent.
  assert.match(await page.textContent(".wizard-body .callout"), /Zonder zonnepanelen levert een accu in deze berekening niets op/);
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
  assert.match(noBattery, /Deze berekening blijft bewaard onder Mijn berekeningen.* ‘Lonend’ betekent hier/);
  assert.doesNotMatch(noBattery, /warmtepomp vanaf/);
  // Ook als geen accu wint, tonen kostenopbouw en offertecheck de accu die het dichtst in de buurt komt.
  await page.click(`[role=tab]:has-text("Kostenopbouw")`);
  assert.match(await page.textContent("[role=tabpanel]:not([hidden])"), /Kostenposten van/);
  await page.click(`[role=tab]:has-text("Offertecheck")`);
  assert.match(await page.textContent("[role=tabpanel]:not([hidden])"), /Bruikbare capaciteit.*kWh bruikbaar/);
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
  // Dezelfde stekkeraccu doet ook mee als afgeleide uitvoering op een eigen groep, met de kosten van die groep.
  assert.match(await page.textContent(".wizard-body"), /eigen groep [\d,]+ kW \(afgeleid\)/);
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
  await page.getByLabel("Tijdzone", { exact: true }).selectOption("UTC");
  await next(page);
  await page.click("text=Ja, ik heb een P1- of meterexport");
  await page.setInputFiles(".wizard-body input[type=file]", files.meter);
  await page.click("button:has-text('Lees meterbestand')");
  await page.waitForSelector("text=Netafname");
  await page.getByLabel("Meetperiode").selectOption("hour");
  await page.getByLabel("Tijdzone", { exact: true }).selectOption("UTC");
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
  assert.deepEqual(await strayText(page), []);
  // Verwijderen uit het overzicht; zonder berekeningen zegt de vraag dat ook.
  await page.goto(`${base}/#/energie`);
  await row.locator("button:has-text('Verwijder')").click();
  assert.match(await page.textContent("dialog[open]"), /Er zijn geen berekeningen op dit profiel/);
  await page.click("dialog[open] button:has-text('Verwijder profiel')");
  await row.waitFor({ state: "detached" });
  assert.deepEqual(problems, []);
  await close();
});

test("cumulatieve meterstanden per tarief: herkend, opgeteld en een leesfout wordt niet bewaard", async () => {
  const files = syntheticYear(workdir);
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/energie/import`);
  await page.setInputFiles("input[type=file]", files.inverter);
  await next(page);
  await page.waitForSelector("text=Kolommen en eenheden");
  assert.match(await page.textContent(".wizard-body [role=status]"), /35\.040 rijen ingelezen/);
  await page.getByLabel("Meetperiode").selectOption("15min");
  await page.getByLabel("Tijdzone", { exact: true }).selectOption("UTC");
  await next(page);
  await page.click("text=Ja, ik heb een P1- of meterexport");
  await page.setInputFiles(".wizard-body input[type=file]", files.readings);
  await page.click("button:has-text('Lees meterbestand')");
  await page.waitForSelector("text=Netafname, tarief 2");
  // Beide tarieven tellen op, en de oplopende standen zetten de soort waarden.
  const picked = label => page.getByLabel(label, { exact: true }).evaluate(s => s.selectedOptions[0].textContent);
  assert.equal(await picked("Netafname"), "2. Import T1 kWh");
  assert.equal(await picked("Netafname, tarief 2"), "3. Import T2 kWh");
  assert.equal(await picked("Teruglevering"), "4. Export T1 kWh");
  assert.equal(await picked("Teruglevering, tarief 2"), "5. Export T2 kWh");
  assert.equal(await page.getByLabel("Soort waarden").inputValue(), "cumulative");
  assert.match(await page.textContent(".wizard-body"), /dit lijken meterstanden/);
  await page.getByLabel("Meetperiode").selectOption("hour");
  await page.getByLabel("Tijdzone", { exact: true }).selectOption("UTC");
  // Als waarden per meetperiode gelezen komt het jaar ver boven een huishouden uit: niet te bewaren.
  await page.getByLabel("Soort waarden").selectOption("interval");
  await next(page);
  await page.waitForSelector(".stats", { timeout: 30000 });
  assert.match(await page.textContent(".wizard-body .callout.problem"), /ver boven wat een huishouden/);
  await next(page);
  assert.equal(await page.locator("text=Bewaar energieprofiel").count(), 0);
  // Waarom het niet verder kan staat boven de knoppen, niet als melding die over Volgende valt.
  assert.match(await page.textContent(".wizard-problem"), /Pas eerst bij Kolommen of Meter/);
  assert.equal(await page.locator(".toast.error").count(), 0);
  await page.click(".wizard-footer button:has-text('Vorige')");
  assert.equal(await page.locator(".wizard-problem").textContent(), "");
  await page.getByLabel("Soort waarden").selectOption("cumulative");
  await next(page);
  await page.waitForSelector(".stats", { timeout: 30000 });
  // Hetzelfde verbruik als het meterbestand per uur: 3.285 kWh, met de netafname om na te rekenen.
  assert.match(await page.textContent(".stats"), /3\.285 kWh/);
  assert.match(await page.textContent(".wizard-body"), /Gemeten netafname: .+kWh\. Teruglevering: .+jaarafrekening/);
  assert.equal(await page.locator(".wizard-body .callout.problem").count(), 0);
  assert.deepEqual(await strayText(page), []);
  // Een eigen naam verandert alleen de naam; het bestandsformaat volgt nog uit de bestandsnaam.
  await next(page);
  await page.getByLabel("Naam van het profiel").fill("Ons jaar met meterstanden");
  await page.click("button:has-text('Bewaar energieprofiel')");
  await page.waitForFunction(() => /energie\/\d+/.test(location.hash), null, { timeout: 30000 });
  await page.goto(`${base}/#/energie`);
  assert.match(await page.locator("tr", { hasText: "Ons jaar met meterstanden" }).textContent(), /Bruikbaar/);
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
  assert.doesNotMatch(await page.textContent(".wizard-body"), /niet doorrekenen/);
  await next(page);
  await page.click("button:has-text('Bewaar energieprofiel')");
  await page.waitForFunction(() => /energie\/\d+/.test(location.hash), null, { timeout: 30000 });
  // De periode staat in Nederlandse tijd, met het einde van de laatste meetperiode als ‘tot’.
  // #view bestaat al voordat het profiel geladen is; wacht op de tekst, niet alleen op de nieuwe hash.
  await page.waitForSelector("text=tijden in het bestand:");
  assert.match(await page.textContent("#view"),
    /Van 1-1-2025, 00:00 CET tot 1-1-2026, 00:00 CET · tijden in het bestand: Nederlandse tijd, met zomertijd/);
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

test("een export die het hele jaar wintertijd aanhoudt: uitleg en één klik bij Kolommen", async () => {
  // Zonder zomertijd staat 30-03-2025 02:00 in het bestand; in Nederlandse tijd bestaat dat uur niet.
  const file = dutchLocalYear(workdir, 8760, "wintertijd.csv", "Etc/GMT-1");
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/energie/import`);
  await page.setInputFiles("input[type=file]", file);
  await next(page);
  await page.waitForSelector("text=Kolommen en eenheden");
  await next(page);
  // De fout komt al bij Kolommen, bij het tijdzoneveld, niet pas bij de controle.
  const callout = page.locator("[role=alert]", { hasText: "30-03-2025 02:00" });
  await callout.waitFor({ timeout: 30000 });
  assert.match(await callout.textContent(), /bestaat niet in tijdzone Europe\/Amsterdam/);
  await callout.getByRole("button", { name: "Lees als wintertijd (UTC+1)" }).click();
  assert.equal(await page.getByLabel("Tijdzone", { exact: true }).inputValue(), "Etc/GMT-1");
  await next(page);
  await next(page);
  await page.waitForSelector(".stats", { timeout: 30000 });
  assert.match(await page.textContent(".stats"), /8\.760 uur/);
  assert.deepEqual(await strayText(page), []);
  // De eerste controle wijst het bestand bewust af (400); verder geen fouten.
  assert.deepEqual(problems.filter(p => !/status of 400/.test(p)), []);
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

test("een te kort bestand zegt vóór het bewaren dat het niet door te rekenen is", async () => {
  const file = dutchLocalYear(workdir, 72, "drie-dagen.csv");
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/energie/import`);
  await page.setInputFiles("input[type=file]", file);
  await next(page);
  await page.waitForSelector("text=Kolommen en eenheden");
  await next(page);
  await next(page);
  await page.waitForSelector(".stats", { timeout: 30000 });
  assert.match(await page.textContent(".wizard-body [role=note]"), /dekt 3 dagen\..+niet doorrekenen/);
  await next(page);
  await page.click("button:has-text('Bewaar energieprofiel')");
  await page.waitForFunction(() => /energie\/\d+/.test(location.hash), null, { timeout: 30000 });
  await page.waitForSelector("#view [role=note]");
  assert.match(await page.textContent("#view [role=note]"), /dekt 3 dagen/);
  assert.equal(await page.locator("#view a:has-text('Naar de keuzehulp')").count(), 1);
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
  // Het eerste profiel dat door te rekenen is; een te kort profiel uit een eerdere test staat uitgeschakeld in de lijst.
  const profiles = page.getByLabel(/Energieprofiel/);
  await page.waitForFunction(() => [...document.querySelectorAll("select option")].some(o => /energiemonitor/.test(o.textContent) && !o.disabled));
  await profiles.selectOption(await profiles.evaluate(s => [...s.options].find(o => o.value && !o.disabled).value));
  // Een warmtepomp vanaf het tweede jaar telt pas vanaf 1 januari van dat jaar mee.
  await page.click("button:has-text('+ Warmtepomp')");
  assert.equal(await page.getByLabel("Vanaf jaar (1 januari)").inputValue(), "2028");
  await page.getByLabel("Extra verbruik (kWh per jaar)").fill("2500");
  await page.getByText(/Je verbruik vanaf 1 januari 2028: [\d.]+ \+ 2\.500 = ongeveer [\d.]+ kWh/).waitFor();
  await next(page);
  await page.getByLabel("Stroomprijs, alles inbegrepen (€/kWh)").fill("0.25");
  await page.getByLabel("Terugleververgoeding (€/kWh)").fill("0.05");
  // Terugleverkosten beginnen leeg: onbekend is geen nul.
  assert.equal(await page.getByLabel("Terugleverkosten (€/kWh)").inputValue(), "");
  await page.getByLabel("Terugleverkosten (€/kWh)").fill("0");
  await next(page);
  await page.click("button:has-text('+ Eigen optie')");
  const card = page.locator(".option-editor").first();
  for (const [label, value] of [["Bruikbare capaciteit (kWh)", "10"], ["Laden AC (kW)", "5"], ["Ontladen AC (kW)", "5"],
    ["Rendement AC → AC (%)", "88"], ["Sluimerverbruik (W)", "10"], ["Capaciteitsverlies per jaar (%)", "2"],
    ["Levensduur (jaar)", "15"]]) await card.getByLabel(label, { exact: true }).fill(value);
  await card.getByLabel("Bron en aannames van de techniek").fill("Synthetische testinvoer.");
  // Open kostenposten staan in de controlestap als één punt per optie, met een weg terug.
  await next(page);
  const group = page.locator(".problem-group", { hasText: "Eigen optie 1" });
  assert.match(await group.textContent(), /\d+ van \d+ kostenposten zijn nog onbekend: ‘[^’]+’, ‘[^’]+’, ‘[^’]+’ en \d+ andere\./);
  await group.locator("button:has-text('Vul open posten met indicaties')").click();
  await page.waitForSelector("text=posten gevuld met indicaties");
  await page.locator(".problem-group button:has-text('Ga naar deze optie')").click();
  await page.waitForFunction(() => document.activeElement?.matches(".cost-row select"));
  assert.equal(await page.evaluate(() => document.activeElement.value), "unknown");
  await card.locator("button:has-text('Vul open posten met indicaties')").click();
  const row = title => card.locator(".cost-row", { hasText: title });
  await row("Accu of complete pakketprijs").getByLabel("Status").selectOption("priced");
  // In een bedrag is ‘9.000’ negenduizend; het lopende totaal telt het meteen mee.
  const total = async () => Number((await card.locator(".cost-total").textContent())
    .match(/Startkosten volgens deze posten: €\s*([\d.]+)/)[1].replace(/\./g, ""));
  await row("Accu of complete pakketprijs").getByLabel("Bedrag (€)").fill("");
  const before = await total();
  await row("Accu of complete pakketprijs").getByLabel("Bedrag (€)").fill("9.000");
  assert.equal(await total(), before + 9000);
  await row("Accu of complete pakketprijs").getByLabel("Bron of aanname").fill("Synthetische offerte");
  await row("Extra/hybride omvormer").getByLabel("Status").selectOption("included");
  await row("Extra/hybride omvormer").getByLabel("Bron of aanname").fill("Synthetische offerte");
  // Als stekkerbatterij met 5 kW laden en ontladen: het advies noemt dat beide boven de 800 W liggen. Na het vullen
  // gekozen, dus de kosten blijven die van een vaste installatie.
  // Een eigen optie begint met een onbekende soort aansluiting.
  assert.equal(await card.getByLabel("Soort aansluiting").inputValue(), "unknown");
  await card.getByLabel("Soort aansluiting").selectOption("plug");
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
  // De kaart zegt waarmee gerekend is: aansluiting, bruikbare capaciteit en vermogen.
  assert.match(option, /Stekker · 10 kWh bruikbaar · 5 kW ontladen, 5 kW laden/);
  assert.match(view, /Voor Eigen optie 1 is gerekend met [\d,]+ kW ontladen: meer dan 800 W.*en met [\d,]+ kW laden: ook dat is meer dan 800 W/);
  const euros = text => (/[−-]/.test(text) ? -1 : 1) * Number(text.replace(/\D/g, ""));
  // Met het netto voordeel als doel staat dat vooraan op de kaart, anders na de besparing.
  const [, npv, limit, investment] = option.match(/Netto voordeel \(NPV\)(.+?)Lonend tot(€.+?|Zelfs gratis niet)Startinvestering nu(.+?)Besparing in jaar 1/);
  const expected = euros(investment) + euros(npv);
  // De grens is naar beneden afgerond op € 10.
  if (limit.startsWith("€")) assert.ok(euros(limit) <= expected + 1 && euros(limit) > expected - 11, `${limit} ≠ ${expected}`);
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
    .evaluate(t => { const at = name => [...t.tHead.rows[0].cells].findIndex(c => c.textContent === name);
      return ["Rekening zonder accu", "Rekening met accu"].map(name => t.tBodies[0].rows[1].cells[at(name)].textContent); });
  assert.ok(Math.abs(amount(bills[0]) - amount(bills[1]) - heatTotal) <= 1, `${bills} ≠ ${heatTotal}`);
  const yearly = await page.locator("[role=tabpanel]:not([hidden]) table", { hasText: "Bruto verbruik" })
    .evaluate(t => { const at = [...t.tHead.rows[0].cells].findIndex(c => c.textContent === "Bruto verbruik");
      return [...t.tBodies[0].rows].map(r => Number(r.cells[at].textContent.replace(/\D/g, ""))); });
  assert.ok(Math.abs(yearly[1] - yearly[0] - 2500) < 50, JSON.stringify(yearly.slice(0, 2)));
  // Zonder lening zijn rente en aflossing elk jaar € 0: één zin in plaats van twee lege kolommen.
  // Bedragen staan rechts uitgelijnd, zodat ze onder elkaar te vergelijken zijn.
  const yearTable = page.locator("[role=tabpanel]:not([hidden]) table", { hasText: "Bruto verbruik" });
  assert.doesNotMatch(await yearTable.locator("thead").textContent(), /Leningrente|Aflossing/);
  assert.match(await page.textContent("[role=tabpanel]:not([hidden])"), /eningrente en aflossing: € 0 in alle jaren\./);
  assert.equal(await yearTable.locator("tbody td.num").first().evaluate(td => getComputedStyle(td).textAlign), "right");
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
  // Ingevulde waarden en afgevinkte regels blijven in deze browser bewaard, ook na herladen.
  await page.getByLabel("Klopt: Bruikbare capaciteit").check();
  assert.match(await page.textContent("[role=tabpanel]:not([hidden])"), /1 van \d+ nagekeken/);
  await page.reload();
  await page.click(`[role=tab]:has-text("Offertecheck")`);
  assert.equal(await page.getByLabel("Offerte zegt: bruikbare capaciteit (kWh)").inputValue(), "9,3");
  assert.equal(await page.getByLabel("Vaste prijs of onder voorbehoud van schouw?").inputValue(), "fixed");
  assert.equal(await page.getByLabel("Klopt: Bruikbare capaciteit").isChecked(), true);
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
  // Het oordeel gaat over de accu uit de offerte, ook als een andere optie beter uitkomt.
  assert.match(await page.textContent(".verdict"), /Je offerte, binnen deze aannames/);
  // De herkomst staat open in de uitleg, met de oorspronkelijke berekening in de titel.
  assert.equal(await page.locator("details:has(> summary:has-text('Uit je offerte, op basis van ‘Synthetische offerte’'))").evaluate(d => d.open), true);
  await page.waitForSelector("text=Herberekend met de antwoorden uit je offerte");
  const quotedView = await page.textContent("#view");
  assert.match(quotedView, /bruikbare capaciteit 10 kWh → 9,3 kWh; sluimerverbruik 10 W → 15 W; startkosten vóór teruggaven/);
  assert.doesNotMatch(quotedView, /nog de schatting/);
  // De soort aansluiting gaat mee naar de herberekening: nog steeds een stekkerbatterij.
  assert.match(quotedView, /Voor Eigen optie 1 is gerekend met/);
  // De startkosten als som: de offerteprijs plus wat apart bleef; bij een vaste prijs geen reserve.
  assert.match(quotedView, new RegExp(`De startkosten zijn nu:€\\s*8\\.750 totaalprijs uit de offerte\\+ €\\s*[\\d.]+ apart gehouden: .+ \\(geschat, niet in de offerte\\)= €\\s*${start.replace(".", "\\.")} startkosten vóór teruggaven`));
  assert.doesNotMatch(quotedView, /reserve voor meerwerk \(/);
  assert.match(quotedView, /is nu lonend tot (ongeveer €\s*[\d.]+|niets: zelfs gratis niet); met de oorspronkelijke waarden was dat (ongeveer €\s*[\d.]+|niets: zelfs gratis niet)\.|is ook met deze waarden zelfs gratis niet lonend\./);
  await page.click(`[role=tab]:has-text("Offertecheck")`);
  const quotedCheck = await page.textContent("[role=tabpanel]:not([hidden])");
  assert.match(quotedCheck, /9,3 kWh bruikbaar\s*offerte/);
  assert.match(quotedCheck, new RegExp(`€\\s*${start.replace(".", "\\.")} startinvestering na teruggaven`));
  // Twee bewaarde berekeningen naast elkaar, met het verschil in woorden en de begrippen eronder.
  await page.goto(`${base}/#/berekeningen`);
  const compare = page.locator("button:has-text('Vergelijk')");
  await page.getByLabel(/^Vergelijk Synthetische offerte van /).check();
  assert.match(await page.textContent("#view"), /Besproken accu.*Je offerte/);
  assert.equal(await compare.isDisabled(), true);
  await page.getByLabel(/^Vergelijk Synthetische offerte · offerte .+ van /).check();
  await compare.click();
  await page.waitForSelector("table.compare");
  const side = await page.textContent("table.compare");
  assert.match(side, /Uitkomst(Gelijk in alle berekeningen)?(Advies: |Geen accu komt het beste uit)/);
  assert.match(side, /Lonend tot.*(Zelfs gratis niet|Tot €)/);
  assert.match(side, /Wat is anders.*offerte: bruikbare capaciteit 10 kWh → 9,3 kWh.*vaste prijs/);
  // Ook de accu zelf staat bij ‘Wat is anders’, per accu met dezelfde naam.
  assert.match(side, /: 10 kWh bruikbaar, .*: 9,3 kWh bruikbaar, /);
  assert.doesNotMatch(side, /ouder rekenmodel/);
  assert.deepEqual(await strayText(page), []);
  assert.match(await page.textContent(".glossary"), /Discontovoet.*kWh en kW/);
  // Een berekening van een ouder rekenmodel nabootsen (alleen in de pagina): met één klik opnieuw, met
  // dezelfde invoer, en de nieuwe neemt in de vergelijking de plaats van de oude in.
  const compareHash = await page.evaluate(() => {
    const run = Data.run;
    Data.run = async id => {
      const r = await run(id);
      return r.title === "Synthetische offerte" ? { ...r, result: { ...r.result, model_version: "nl-self-consumption-v4" } } : r;
    };
    const hash = location.hash;
    location.hash = "#/berekeningen";
    return hash;
  });
  await page.waitForSelector("text=Nieuwe keuzehulp");
  await page.evaluate(hash => { location.hash = hash; }, compareHash);
  const old = page.locator("table.compare thead th", { hasText: "ouder rekenmodel" });
  await old.getByRole("button", { name: "Reken opnieuw met het huidige model" }).click();
  await page.waitForFunction(hash => location.hash !== hash, compareHash);
  await page.waitForSelector("table.compare thead >> text=Synthetische offerte · huidig model");
  const swapped = await page.textContent("table.compare thead");
  assert.match(swapped, /Synthetische offerte · huidig model.*Synthetische offerte · offerte/);
  assert.doesNotMatch(swapped, /ouder rekenmodel/);
  await page.click("table.compare thead >> text=Synthetische offerte · huidig model");
  // De herkomst staat ingeklapt in de uitleg; de titel zegt waar de berekening vandaan komt.
  await page.click("summary:has-text('Herberekend uit ‘Synthetische offerte’ met het huidige rekenmodel')");
  assert.match(await page.textContent("#view"),
    /Herberekend met het huidige rekenmodel op basis van ‘Synthetische offerte’\. Invoer ongewijzigd, met de prijzen en tarieven van toen\. .+: lonend tot (€\s*[\d.]+|zelfs gratis niet) → (€\s*[\d.]+|zelfs gratis niet)\./);
  // De oude blijft bewaard en wijst naar de nieuwe, zodat je niet twee keer opnieuw rekent.
  await page.click("#view .fold a:text-is('‘Synthetische offerte’')");
  await page.waitForSelector("text=Al opnieuw gerekend");
  // Zonder lening raakt de enige verbetering sinds versie 4 deze berekening niet, en dat staat er.
  assert.match(await page.textContent("#view"), /Sinds deze berekening is het rekenmodel verbeterd\. Geen van die verbeteringen raakt deze berekening.*Een lening telt als rente en aflossing.* Raakt deze berekening niet\.Al opnieuw gerekend: Synthetische offerte · huidig model/);
  assert.equal(await page.locator("button:has-text('Reken opnieuw met het huidige model')").count(), 0);
  if (BROWSER_MODE) {
    // Drie berekeningen alleen in deze browser: een rustige herinnering aan een back-up, tot je er een maakt.
    await page.evaluate(() => { location.hash = "#/berekeningen"; });
    const hint = page.locator(".backup-hint");
    await hint.waitFor();
    assert.match(await hint.textContent(), /Je 3 berekeningen staan alleen in deze browser/);
    await hint.locator("button:has-text('Download back-up')").click();
    await hint.waitFor({ state: "detached" });
  }
  // Een berekening van ruim drie maanden geleden zegt dat haar prijzen van toen zijn.
  assert.doesNotMatch(await page.textContent("#view"), /maanden oud/);
  await page.clock.setFixedTime(new Date(Date.now() + 100 * 864e5));
  await page.goto(`${base}/${firstRun}`);
  await page.reload();
  await page.waitForSelector("text=Wat betekent dit voor jou?");
  assert.match(await page.textContent("#view"), /Deze berekening is 3 maanden oud\. Stroomprijs/);
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
  // Overnemen in Zelf doorrekenen houdt de aansluiting; een uitvoering zonder bekende koppeling wordt niet ‘vast’.
  const kinds = await page.evaluate(async () => {
    const cmp = await Data.catalog(), mine = cmp.configurations.find(c => c.manufacturer_name === "Fictief Merk");
    await Scenario.addConfigurations([mine.id]);
    // Elke onderzochte uitvoering heeft een koppeling; zonder (zoals een eigen accu met ‘Niet bekend’) blijft hij onbekend.
    const unknown = cmp.configurations.find(c => c.id !== mine.id), connectionOf = Data.connectionOf;
    Data.connectionOf = () => null;
    try { await Scenario.addConfigurations([unknown.id]); } finally { Data.connectionOf = connectionOf; }
    const options = JSON.parse(localStorage.getItem("thuisaccu-scenario")).options;
    return [mine, unknown].map(c => options.find(o => o.configuration_id === c.id).kind);
  });
  assert.deepEqual(kinds, ["fixed", "unknown"]);
  assert.deepEqual(problems, []);
  await close();
});

test("een onderzochte accu zonder prijs doet met een eigen prijs mee", async () => {
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/accus`);
  await page.waitForSelector("table", { timeout: 30000 });
  const fold = page.locator("details.priceless");
  assert.match(await fold.locator("summary").textContent(), /^\d+ onderzochte uitvoeringen? miss(en|t) alleen een prijs$/);
  await fold.locator("summary").click();
  const first = fold.locator("tbody tr").first();
  const name = await first.locator("td").first().textContent();
  await first.locator("button:has-text('Prijs aanvullen')").click();
  const dialog = page.locator("dialog[open]");
  // De uitvoering ligt vast en de prijs is verplicht; een prijs zonder btw telt niet.
  assert.equal(await dialog.getByLabel("Fabrikant").getAttribute("readonly"), "");
  assert.equal(await dialog.getByLabel("Bruikbare energie (kWh)").count(), 0);
  await dialog.locator("button:has-text('Bewaar')").click();
  assert.equal(await dialog.getByLabel("Aanschafbedrag").getAttribute("aria-invalid"), "true");
  await dialog.getByLabel("Aanschafbedrag").fill("1.234,00");
  await dialog.getByLabel("Verkoper").fill("Fictieve winkel");
  await dialog.getByLabel("Belastingbasis").selectOption("excluded");
  await dialog.locator("button:has-text('Bewaar')").click();
  assert.match(await dialog.locator(".error").first().textContent(), /inclusief btw/);
  await dialog.getByLabel("Belastingbasis").selectOption("included");
  await dialog.locator("button:has-text('Bewaar')").click();
  await page.waitForSelector("text=De keuzehulp rekent deze accu nu mee");
  // Nu staat hij in de catalogus met de eigen prijs, niet meer bij de uitvoeringen zonder prijs.
  const product = name.split(" · ")[0];
  await page.fill("#view input[type=search]", product);
  assert.match(await page.textContent("#view .table-wrap"), /€\s1\.234 incl\. btw/);
  assert.equal(await page.locator("details.priceless tbody tr", { hasText: name }).count(), 0);
  assert.deepEqual(problems, []);
  await close();
});

test("rendement en sluimerverbruik uit bronclaims: voorzichtig en niet dubbel", async () => {
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/accus`);
  await page.waitForSelector("table", { timeout: 30000 });
  // Filteren op aansluiting zegt hoeveel uitvoeringen overblijven; de telling is een live-regio.
  const total = Number((await page.textContent("p[aria-live=polite]:has-text('uitvoeringen')")).match(/\d+/)[0]);
  await page.getByLabel("Aansluiting").selectOption("plug");
  const shown = await page.textContent("p[aria-live=polite]:has-text('bij deze filters')");
  const [, kept, of] = shown.match(/^(\d+) van (\d+) uitvoeringen bij deze filters$/);
  assert.ok(Number(kept) < total && Number(of) === total, shown);
  assert.ok(await page.locator("tbody tr:has-text('SolarCube Pro')").count() > 0);
  await page.getByLabel("Aansluiting").selectOption("");
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

test("accu’s uit de catalogusvergelijking worden opties in Zelf doorrekenen", async () => {
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/accus`);
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const boxes = page.locator("table tbody input[type=checkbox]");
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.click("a:has-text('Vergelijk (2)')");
  await page.waitForSelector("table.compare");
  assert.deepEqual(await strayText(page), []);
  await page.click("button:has-text('Reken deze accu’s door')");
  // Zonder gekozen profiel begint de wizard bij het profiel; de opties staan klaar met kostenindicaties.
  await page.waitForSelector("text=Profiel en doel");
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("thuisaccu-scenario")));
  assert.equal(draft.options.length, 2);
  assert.ok(draft.options.every(o => o.configuration_id != null && o.costs.installation?.status !== "unknown"));
  // Nog eens op de knop: wat al in het concept staat, komt er niet dubbel bij.
  await page.goBack();
  await page.click("button:has-text('Reken deze accu’s door')");
  await page.waitForSelector("text=Profiel en doel");
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem("thuisaccu-scenario")))).options.length, 2);
  // Een stekkeraccu met meer dan 800 W ontladen rekent hier net als in de keuzehulp met 800 W.
  const plug = await page.evaluate(async () => {
    const cmp = await Data.catalog();
    const config = cmp.configurations.map(c => Data.describe(cmp, c)).find(p => p.kind === "plug" && p.dischargeKw > 0.8)?.config;
    await Scenario.addConfigurations([config.id]);
    return JSON.parse(localStorage.getItem("thuisaccu-scenario")).options.find(o => o.configuration_id === config.id);
  });
  assert.equal(plug.battery.discharge_power_kw, "0,8");
  assert.equal(plug.kind, "plug");
  assert.match(plug.assumptions, /ontladen ingesteld op 800 W/);
  // Op een eigen groep volgt het volle vermogen uit de bronnen, met naam, aannames en de kosten van een extra groep;
  // terug naar de stekker weer 800 W. Eigen invoer blijft staan.
  const switched = await page.evaluate(async option => {
    const steps = [], to = async kind => { const previous = option.kind; option.kind = kind;
      steps.push({ message: await Scenario.followConnection(option, previous), ...structuredClone(option) }); };
    await to("circuit");
    await to("plug");
    option.battery.discharge_power_kw = "1,5"; await to("plug");
    return steps;
  }, plug);
  assert.ok(Number(switched[0].battery.discharge_power_kw.replace(",", ".")) > 0.8, switched[0].battery.discharge_power_kw);
  assert.match(switched[0].message, /Vermogen aangepast aan de aansluiting/);
  assert.doesNotMatch(switched[0].name, /begrensd op 800 W/);
  assert.doesNotMatch(switched[0].assumptions, /ontladen ingesteld op 800 W/);
  assert.match(switched[0].assumptions, /afgeleide uitvoering op een eigen groep|^Overgenomen uit de catalogus/);
  assert.equal(switched[0].costs.installation.status, "priced");
  assert.notDeepEqual(switched[0].costs.installation, plug.costs.installation);
  assert.equal(switched[1].battery.discharge_power_kw, "0,8");
  assert.equal(switched[1].name, plug.name);
  assert.equal(switched[1].assumptions, plug.assumptions);
  assert.deepEqual(switched[1].costs, plug.costs);
  assert.equal(switched[2].battery.discharge_power_kw, "1,5");
  assert.match(switched[2].message, /meer dan 800 W/);
  // Een optie uit een keuzehulpberekening (aannames beginnen met ‘Keuzehulp.’) verliest de 800 W-zin ook; een
  // stekkerbatterij tot 800 W houdt zijn vermogen maar krijgt op een eigen groep wel de kosten van de extra groep.
  const more = await page.evaluate(async option => {
    const copied = { ...structuredClone(option), assumptions: option.assumptions.replace(/^Overgenomen uit de catalogus\./, "Keuzehulp.") };
    copied.kind = "circuit"; await Scenario.followConnection(copied, "plug");
    const cmp = await Data.catalog();
    const small = cmp.configurations.map(c => Data.describe(cmp, c)).find(p => p.kind === "plug" && p.battery &&
      p.dischargeKw <= 0.8 && p.chargeKw <= 0.8 && !Data.circuitVariant(cmp, p))?.config;
    await Scenario.addConfigurations([small.id]);
    const low = JSON.parse(localStorage.getItem("thuisaccu-scenario")).options.find(o => o.configuration_id === small.id);
    const before = structuredClone(low);
    low.kind = "circuit";
    return { copied, before, message: await Scenario.followConnection(low, "plug"), after: low };
  }, plug);
  assert.match(more.copied.assumptions, /^Keuzehulp\./);
  assert.doesNotMatch(more.copied.assumptions, /ingesteld op 800 W/);
  assert.deepEqual(more.after.battery, more.before.battery);
  assert.match(more.message, /kostenpost/);
  assert.notDeepEqual(more.after.costs.installation, more.before.costs.installation);
  assert.deepEqual(problems, []);
  await close();
});

test("optie-editor: kosten in groepen, één totaalprijs uit een offerte en een terugleverwaarschuwing", async () => {
  // In een browser in een andere tijdzone staan de datums van het profiel toch in Nederlandse tijd.
  const { page, problems, close } = await open({ timezoneId: "America/New_York" });
  await page.goto(`${base}/#/energie/import`);
  // Zonder bestand: een melding onder het sleepvak, gekoppeld aan het bestandsveld.
  await next(page);
  const missing = page.locator(".drop + .error");
  assert.equal(await missing.textContent(), "Kies een bestand.");
  assert.equal(await page.locator(".drop input[type=file]").getAttribute("aria-describedby"), await missing.getAttribute("id"));
  await page.setInputFiles("input[type=file]", dutchLocalYear(workdir, 8760, "optie-editor.csv", "Europe/Amsterdam", 0.3));
  await next(page);
  await page.waitForSelector("text=Kolommen en eenheden");
  await next(page);
  await next(page);
  await page.waitForSelector(".stats", { timeout: 30000 });
  await next(page);
  await page.click("button:has-text('Bewaar energieprofiel')");
  await page.waitForFunction(() => /energie\/\d+/.test(location.hash), null, { timeout: 30000 });
  await page.goto(`${base}/#/energie`);
  await page.waitForSelector("text=optie-editor.csv");
  assert.match(await page.textContent("#view"), /1-1-2025 – 31-12-2025/);

  await page.goto(`${base}/#/zelf`);
  await page.getByLabel("Naam van de berekening").fill("Synthetische totaalprijs");
  const profiles = page.getByLabel(/Energieprofiel/);
  await page.waitForFunction(() => [...document.querySelectorAll("select option")].some(o => /optie-editor/.test(o.textContent) && !o.disabled));
  await profiles.selectOption(await profiles.evaluate(s => [...s.options].find(o => /optie-editor/.test(o.textContent)).value));
  await next(page);
  // Een vast bedrag per jaar als 0 per kWh: dezelfde waarschuwing als in de keuzehulp, met de staffels als uitweg.
  await page.getByLabel("Stroomprijs, alles inbegrepen (€/kWh)").fill("0,25");
  await page.getByLabel("Terugleververgoeding (€/kWh)").fill("0,10");
  await page.getByLabel("Terugleverkosten (€/kWh)").fill("0");
  const feeWarning = page.locator(".live-check", { hasText: "Vergoeding min terugleverkosten" });
  assert.match(await feeWarning.textContent(), /10,0 cent per kWh.*staffels hieronder/);
  await page.getByLabel("Terugleverkosten (€/kWh)").fill("0,06");
  assert.equal(await feeWarning.count(), 0);
  await next(page);

  const fixed = await page.evaluate(async () => {
    const cmp = await Data.catalog();
    return String(cmp.configurations.find(c => Data.describe(cmp, c).kind === "fixed").id);
  });
  await page.getByLabel("Uit de catalogus").selectOption(fixed);
  await page.click("button:has-text('Neem over')");
  const card = page.locator(".option-editor").first();
  await card.waitFor();
  // Vier groepen met een telling in de kop.
  const groups = card.locator(".cost-group > summary");
  assert.deepEqual((await groups.allTextContents()).map(t => t.split(" · ")[0]),
    ["Startkosten", "Per jaar", "Later: vervanging en einde", "Teruggaven, subsidie en restwaarde"]);
  assert.match(await groups.first().textContent(), /Startkosten · \d+ van 12 beoordeeld/);

  await card.locator("summary:has-text('Eén totaalprijs uit een offerte invullen')").click();
  await card.locator("button:has-text('Zet in de kostenposten')").click();
  assert.match(await card.textContent(), /Vul de totaalprijs uit de offerte in\./);
  await card.getByLabel("Totaalprijs inclusief btw (€)").fill("8.000");
  await card.getByLabel("Soort prijs").selectOption("fixed");
  const boxes = card.locator(".option-editor fieldset input[type=checkbox], fieldset input[type=checkbox]");
  const kept = await boxes.count();
  assert.ok(kept >= 2, `${kept} posten met een bedrag`);
  await boxes.first().uncheck();
  await card.locator("button:has-text('Zet in de kostenposten')").click();
  const status = page.locator(".option-editor [role=status]").first();
  await status.waitFor();
  assert.match(await status.textContent(), /Totaalprijs €\s*8\.000(,00)? staat op de accupost\. Als inbegrepen gemarkeerd: .+\. Apart gehouden: .+\./);
  // Het concept wordt kort na een wijziging bewaard.
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("thuisaccu-scenario"))?.options?.[0]?.costs.battery.amount === "8000,00");
  const option = await page.evaluate(() => JSON.parse(localStorage.getItem("thuisaccu-scenario")).options[0]);
  assert.equal(option.costs.battery.status, "priced");
  assert.equal(option.costs.battery.amount, "8000,00");
  assert.equal(Object.values(option.costs).filter(l => l.source === "In de totaalprijs van de offerte").length, kept - 1);

  // Een subsidie boven de startkosten weigert de rekenkern; de controlestap zegt dat al vóór het berekenen.
  await card.locator(".cost-group > summary", { hasText: "Teruggaven" }).evaluate(s => { s.parentElement.open = true; });
  const grant = card.locator(".cost-row", { hasText: "Bevestigde subsidie" });
  await grant.getByLabel("Status").selectOption("priced");
  await grant.getByLabel("Bedrag (€)").fill("100.000");
  await next(page);
  const review = page.locator(".review-problems");
  await review.waitFor();
  assert.match(await review.textContent(), /Teruggaven en subsidie zijn samen €\s*[\d.]+ hoger dan de startkosten/);
  await page.getByRole("button", { name: /Vorige/ }).click();
  await grant.getByLabel("Status").selectOption("unknown");

  // Op een telefoon staan status en bron elk over de volle breedte.
  await page.setViewportSize({ width: 375, height: 800 });
  await card.locator(".cost-group > summary").first().evaluate(s => { s.parentElement.open = true; });
  const widths = await card.locator(".cost-row").first().evaluate(row => ["cost-controls", "cost-status", "cost-source"]
    .map(name => Math.round((name === "cost-controls" ? row.querySelector(".cost-controls") : row.querySelector(`.${name}`)).getBoundingClientRect().width)));
  assert.equal(widths[1], widths[0]);
  assert.equal(widths[2], widths[0]);
  assert.deepEqual(problems, []);
  await close();
});

test("een traag scherm schrijft niet over het volgende, een mislukt scherm biedt opnieuw proberen", async () => {
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/accus`);
  await page.waitForSelector("text=Accucatalogus", { timeout: 30000 });
  // Een berekening die pas binnenkomt als je al naar de catalogus bent gegaan: de kop blijft van de catalogus.
  await page.evaluate(() => {
    Data.run = () => new Promise(resolve => setTimeout(() => resolve({ title: "Trage berekening" }), 700));
    location.hash = "#/berekeningen/1";
  });
  await page.waitForSelector("#view[aria-busy=true]");
  await page.evaluate(() => { location.hash = "#/accus"; });
  await page.waitForSelector("text=Accucatalogus");
  await page.waitForTimeout(1000);
  assert.equal(await page.textContent("#page-title"), "Accu’s vergelijken");
  assert.equal(await page.title(), "Accu’s vergelijken · Thuisaccu");
  // Een scherm dat niet laadt, zegt dat met de reden en een knop om het opnieuw te proberen.
  await page.evaluate(() => {
    const runs = Data.runs;
    Data.runs = () => { Data.runs = runs; return Promise.reject(new Error("Synthetische storing.")); };
    location.hash = "#/berekeningen";
  });
  const failed = page.locator(".empty", { hasText: "Dit scherm kon niet worden geladen" });
  assert.match(await failed.textContent(), /Synthetische storing\./);
  await failed.locator("button:has-text('Probeer opnieuw')").click();
  await failed.waitFor({ state: "detached" });
  await page.waitForSelector("#page-actions >> text=Nieuwe keuzehulp");
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
  // Een SQLite-bestand van iets anders wordt geweigerd; er wordt eerst om bevestiging gevraagd.
  const { DatabaseSync } = await import("node:sqlite");
  const foreign = path.join(workdir, "ander.db"), db = new DatabaseSync(foreign);
  db.exec("CREATE TABLE notes (text TEXT); INSERT INTO notes VALUES ('niet van Thuisaccu');");
  db.close();
  await fresh.page.setInputFiles("input[type=file]", foreign);
  await fresh.page.click("button:has-text('Vervang de gegevens in deze browser')");
  await fresh.page.click("dialog button:has-text('Vervang alles')");
  await fresh.page.waitForSelector("text=Dit is geen back-up van Thuisaccu");
  await fresh.page.setInputFiles("input[type=file]", file);
  await fresh.page.click("button:has-text('Vervang de gegevens in deze browser')");
  await Promise.all([fresh.page.waitForEvent("load"), fresh.page.click("dialog button:has-text('Vervang alles')")]);
  await fresh.page.goto(`${base}/#/accus`);
  await fresh.page.waitForSelector("table tbody tr", { timeout: 30000 });
  assert.equal(await fresh.page.locator("table tbody tr").count(), rows);
  // Een tweede tabblad wacht met een melding tot het eerste sluit; samen zouden ze elkaars wijzigingen overschrijven.
  const second = await page.context().newPage();
  await second.goto(`${base}/#/accus`);
  assert.match(await second.locator("#elsewhere").textContent(), /al open in een ander tabblad/);
  await page.close();
  await second.waitForSelector("#elsewhere", { state: "detached" });
  await second.waitForSelector("table tbody tr", { timeout: 30000 });
  assert.deepEqual([...problems, ...fresh.problems], []);
  await fresh.close();
  await close();
});

test("een niet bewaarde wijziging vraagt om bevestiging bij sluiten", { skip: !BROWSER_MODE, timeout: 60000 }, async () => {
  const closing = page => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    dispatchEvent(event);
    return event.defaultPrevented;
  });
  // Bewaren in IndexedDB mislukt altijd, zoals bij een volle schijf; het laden van de referentiesets is een wijziging.
  const marker = "const bytes = snapshot(), at = changes();";
  patchWorker = body => { assert.ok(body.includes(marker));
    return body.replace(marker, `return Promise.reject(new Error("test: opslag vol")); ${marker}`); };
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/accus`);
  await page.waitForSelector("#unsaved", { timeout: 30000 });
  assert.match(await page.textContent("#unsaved"), /Maak een back-up voordat je dit tabblad sluit/);
  assert.equal(await closing(page), true);
  await close();
  patchWorker = null;
  // Zonder openstaande of mislukte wijziging sluit het tabblad zonder vraag.
  const normal = await open();
  await normal.page.goto(`${base}/#/accus`);
  await normal.page.waitForSelector("table tbody tr", { timeout: 30000 });
  assert.equal(await closing(normal.page), false);
  assert.deepEqual([...problems, ...normal.problems], []);
  await normal.close();
});

test("na een fout in de rekenmodule houdt dit tabblad de database", { skip: !BROWSER_MODE, timeout: 60000 }, async () => {
  // Een worker die op twee testpaden een fout in de module nabootst, zoals een paniek in Rust: direct in het
  // verzoek, en in een microtaak, zoals bij een async Rust-functie (buiten de catch van het verzoek).
  const marker = 'if (data.type === "request") {';
  patchWorker = body => { assert.ok(body.includes(marker)); return body.replace(marker,
    `${marker} if (data.path.includes("__fout")) throw new WebAssembly.RuntimeError("test");
    if (data.path.includes("__later")) { queueMicrotask(() => { throw new WebAssembly.RuntimeError("test"); }); return; }`); };
  const { page, problems, close } = await open();
  await page.goto(`${base}/#/accus`);
  await page.waitForSelector("table tbody tr", { timeout: 30000 });
  const second = await page.context().newPage();
  await second.goto(`${base}/#/accus`);
  await second.waitForSelector("#elsewhere");
  const failed = await page.evaluate(() => Local.fetch("api/v1/__fout").then(() => null, error => error.message));
  assert.match(failed, /opnieuw geladen/);
  const later = await page.evaluate(() => Local.fetch("api/v1/__later").then(() => null, error => error.message));
  assert.match(later, /opnieuw geladen/);
  // De nieuwe worker krijgt het slot van de pagina; het tweede tabblad blijft wachten.
  assert.equal(await page.evaluate(() => Local.fetch("api/v1/health").then(r => r.status)), 200);
  assert.equal(await page.locator("#elsewhere").count(), 0);
  assert.equal(await second.locator("#elsewhere").count(), 1);
  await second.close();
  patchWorker = null;
  assert.deepEqual(problems, []);
  await close();
});
