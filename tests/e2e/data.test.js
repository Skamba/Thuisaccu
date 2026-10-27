"use strict";

// Eenheidstests voor web/data.js en de zinnen uit web/results.js zonder browser: ui.js, data.js en results.js draaien
// in een eigen context.
// Alleen synthetische, hier opgebouwde gegevens.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = { console, Intl, Map, Set };
context.window = context;
vm.createContext(context);
for (const file of ["ui.js", "data.js", "results.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", "web", file), "utf8"), context, { filename: file });
}
const { Data, Results } = context;

const config = { id: 1, name: "FICTIEF 5 kWh", manufacturer_name: "Fictief", product_name: "Testaccu" };
const UNITS = { _wh: "Wh", _w: "W", _pct: "%", _va: "VA" };
const claim = (id, metric_key, value, boundary = "ac_ac", extra = {}) => ({
  id, configuration_id: 1, review_status: "unreviewed", metric_key, value, boundary,
  unit: Object.entries(UNITS).find(([suffix]) => metric_key.endsWith(suffix))?.[1],
  qualifier: "exact", conditions: "", source_title: "Synthetische bron", ...extra
});
const catalog = numbers => ({ numbers, features: [], texts: [], offers: [], warranties: [] });

test("elke aanname van describe() wordt herkend door Data.isAssumed", () => {
  // Alleen nominale capaciteit en ontlaadvermogen: de rest is een aanname.
  const sparse = Data.describe(catalog([claim(1, "nominal_energy_wh", 5000, "unspecified"),
    claim(2, "continuous_discharge_power_w", 2500)]), config);
  const text = sparse.notes.join(" ");
  for (const field of ["usable_capacity_kwh", "charge_power_kw", "ac_round_trip_efficiency_pct", "standby_w",
    "annual_capacity_loss_pct", "operating_life_years"]) {
    assert.equal(Data.isAssumed(field, text), true, `${field} niet herkend in: ${text}`);
  }
  assert.equal(Data.isAssumed("discharge_power_kw", text), false);

  // Een rendement met meetgrens PV → AC telt als AC → AC-aanname; een AC → AC-claim niet.
  const pv = Data.describe(catalog([claim(3, "round_trip_efficiency_pct", 90, "pv_ac")]), config);
  assert.equal(Data.isAssumed("ac_round_trip_efficiency_pct", pv.notes.join(" ")), true);
  const ac = Data.describe(catalog([claim(4, "usable_energy_wh", 5000), claim(5, "round_trip_efficiency_pct", 88),
    claim(6, "standby_power_w", 8)]), config);
  const known = ac.notes.join(" ");
  for (const field of ["usable_capacity_kwh", "ac_round_trip_efficiency_pct", "standby_w"]) {
    assert.equal(Data.isAssumed(field, known), false, `${field} ten onrechte als aanname: ${known}`);
  }
});

test("een stekkeraccu die meer dan 800 W kan, krijgt een afgeleide uitvoering op een eigen groep", () => {
  const stekker = { ...config, name: "1 unit · 5 kWh · stekker" };
  const cmp = { ...catalog([claim(1, "usable_energy_wh", 5000), claim(2, "continuous_discharge_power_w", 800, "system_ac"),
    claim(3, "continuous_discharge_power_w", 2500, "unspecified", { source_title: "Andere bron" }),
    claim(4, "continuous_charge_power_w", 2500, "system_ac")]),
    texts: [{ id: 5, configuration_id: 1, review_status: "unreviewed", metric_key: "coupling", value: "AC-gekoppeld (stekker)" }],
    configurations: [stekker] };
  const base = Data.describe(cmp, stekker);
  assert.equal(base.dischargeKw, 0.8, "de stekkeruitvoering rekent met de voorkeursmeetgrens");
  const variant = Data.circuitVariant(cmp, base);
  assert.equal(variant.name, "Fictief Testaccu · 1 unit · 5 kWh · eigen groep 2,5 kW (afgeleid)");
  assert.deepEqual([variant.kind, variant.circuit, variant.battery.discharge_power_kw, variant.battery.charge_power_kw], ["fixed", true, 2.5, 2.5]);
  assert.match(variant.notes.join(" "), /claim #3, Andere bron\) ontladen en 2,5 kW \(claim #4/);
  assert.equal(Data.isAssumed("discharge_power_kw", variant.notes.join(" ")), true);
  // Met een eigen-groepuitvoering in de catalogus, of zonder meer dan 800 W: geen afgeleide uitvoering.
  assert.equal(Data.circuitVariant({ ...cmp, configurations: [stekker, { ...config, id: 2, name: "1 unit · 5 kWh · eigen groep 2,5 kW" }] }, base), null);
  const small = { ...cmp, numbers: cmp.numbers.filter(c => c.value <= 800 || c.metric_key === "usable_energy_wh") };
  assert.equal(Data.circuitVariant(small, Data.describe(small, stekker)), null);
});

test("de 800 W-begrenzing voor een stekkeraccu wordt herkend", () => {
  // Keuzehulp en Zelf doorrekenen begrenzen met Data.plugLimit; de aannamezin moet herkend worden.
  const plug = { kind: "plug", name: "FICTIEF stekker", dischargeKw: 2.4, chargeKw: 3, notes: [],
    battery: { discharge_power_kw: 2.4, charge_power_kw: 3 } };
  const limited = Data.plugLimit(plug);
  assert.equal(limited.battery.discharge_power_kw, 0.8);
  assert.equal(limited.battery.charge_power_kw, 0.8);
  assert.equal(Data.isAssumed("discharge_power_kw", limited.notes.join(" ")), true);
  assert.equal(Data.isAssumed("charge_power_kw", limited.notes.join(" ")), true);
  // Al 800 W ontladen maar 2,5 kW laden: alleen het laden wordt begrensd, de naam blijft.
  const charging = Data.plugLimit({ ...plug, dischargeKw: 0.8, chargeKw: 2.5, battery: { discharge_power_kw: 0.8, charge_power_kw: 2.5 } });
  assert.equal(charging.battery.charge_power_kw, 0.8);
  assert.equal(charging.name, plug.name);
  assert.equal(Data.isAssumed("discharge_power_kw", charging.notes.join(" ")), false);
  const fixed = { ...plug, kind: "fixed" };
  assert.equal(Data.plugLimit(fixed), fixed);
  assert.equal(Data.isAssumed("discharge_power_kw", "Aanname: ontladen ingesteld op 800 W voor een gewoon stopcontact."), true);
  assert.equal(Data.fromKeuzehulp({ assumptions: `${Data.KEUZEHULP_PREFIX} Aanname: …` }), true);
  assert.equal(Data.fromKeuzehulp({ assumptions: "Offerte van de installateur" }), false);
});

// Regels van describe(): welke bronclaim wordt een rekengegeven. Eén synthetische claimset per regel.
const offer = (id, extra = {}) => ({
  id, configuration_id: 1, review_status: "unreviewed", currency: "EUR", minor_unit_exponent: 2, tax_basis: "included",
  amount_minor: 100000 * id, observed_at_unix_s: 1_700_000_000 + id, valid_until_unix_s: null, ...extra
});
const RULES = [
  ["vermogen telt alleen aan de AC-kant", [claim(1, "continuous_discharge_power_w", 3000, "battery_dc"),
    claim(2, "continuous_discharge_power_w", 2500, "ac_ac")], d => assert.equal(d.dischargeKw, 2.5)],
  ["alleen een DC-vermogen: ontlaadvermogen ontbreekt en de accu is niet door te rekenen",
    [claim(1, "usable_energy_wh", 5000), claim(2, "continuous_discharge_power_w", 3000, "dc_dc")], d => {
      assert.equal(d.dischargeKw, null);
      assert.equal(d.battery, null);
      assert.ok(d.missing.includes("ontlaadvermogen aan de AC-kant (de bron noemt alleen DC)"));
    }],
  ["kVA wordt nooit kW", [claim(1, "usable_energy_wh", 5000), claim(2, "apparent_power_va", 3000)], d => {
    assert.equal(d.dischargeKw, null);
    assert.ok(d.missing.includes("werkelijk ontlaadvermogen in kW (kVA telt niet)"));
  }],
  ["zonder laadvermogen geldt het ontlaadvermogen, als aanname", [claim(1, "continuous_discharge_power_w", 2000),
    claim(2, "continuous_charge_power_w", 4000, "battery_dc")], d => {
      assert.equal(d.chargeKw, 2);
      assert.match(d.notes.join(" "), /Aanname: laadvermogen gelijk.*alleen 4,0 kW laadvermogen aan de DC-kant/);
    }],
  ["een bovengrens voor het rendement telt niet", [claim(1, "round_trip_efficiency_pct", 95, "ac_ac", { qualifier: "at_most" })],
    d => { assert.equal(d.efficiency, Data.FALLBACK.efficiency); assert.match(d.notes.join(" "), /bovengrens/); }],
  ["een rendement inclusief sluimerverbruik telt niet dubbel",
    [claim(1, "round_trip_efficiency_pct", 85, "ac_ac", { conditions: "Inclusief eigen verbruik in rust" })],
    d => assert.equal(d.efficiency, Data.FALLBACK.efficiency)],
  ["een DC-rendement is geen AC-rendement", [claim(1, "round_trip_efficiency_pct", 95, "battery_dc")], d => {
    assert.equal(d.efficiency, Data.FALLBACK.efficiency);
    assert.match(d.notes.join(" "), /alleen 95,0% rendement aan de DC-kant/);
  }],
  ["een bereik rekent met de ondergrens", [claim(1, "round_trip_efficiency_pct", 85, "ac_ac", { qualifier: "range", upper_value: 92 })],
    d => assert.equal(d.efficiency, 85)],
  ["de beste meetgrens wint, daarbinnen de voorzichtigste waarde", [claim(1, "round_trip_efficiency_pct", 80, "unspecified"),
    claim(2, "round_trip_efficiency_pct", 90, "ac_ac"), claim(3, "round_trip_efficiency_pct", 86, "ac_ac")], d => {
      assert.equal(d.efficiency, 86);
      assert.match(d.notes.join(" "), /gerekend met claim #3/);
    }],
  ["sluimerverbruik: de hoogste waarde aan de AC-kant of zonder meetgrens, niet DC uit een andere bron",
    [claim(1, "standby_power_w", 5, "ac_ac"), claim(2, "standby_power_w", 12, "unspecified"),
      claim(3, "standby_power_w", 20, "battery_dc", { source_title: "Andere bron" })],
    d => assert.equal(d.standby, 12)],
  ["sluimerverbruik: 0 W aan het net en minder dan 5 W uit de accu volgens dezelfde bron is 5 W",
    [claim(1, "standby_power_w", 0, "system_ac"), claim(2, "standby_power_w", 5, "battery_dc", { qualifier: "less_than" })],
    d => {
      assert.equal(d.standby, 5);
      assert.ok(d.notes.some(note => /uit de accu \(claim #2\) in plaats van 0 W aan de netkant/.test(note)), d.notes.join(" | "));
    }],
  // De volgorde van de claims maakt niet uit: per bron telt de hogere waarde uit de accu, daarna de hoogste.
  ...[[0, 1, 2], [2, 1, 0], [1, 2, 0]].map(order => [`sluimerverbruik: per bron de accukant, los van de volgorde (${order})`,
    order.map(i => [claim(1, "standby_power_w", 0, "system_ac", { source_title: "Bron A" }),
      claim(2, "standby_power_w", 6, "battery_dc", { source_title: "Bron A" }),
      claim(3, "standby_power_w", 0, "system_ac", { source_title: "Bron B" })][i]), d => assert.equal(d.standby, 6)]),
  ["sluimerverbruik: de accukant van bron A wint van een lagere netkant van bron B",
    [claim(1, "standby_power_w", 0, "system_ac", { source_title: "Bron A" }), claim(2, "standby_power_w", 6, "battery_dc", { source_title: "Bron A" }),
      claim(3, "standby_power_w", 4, "system_ac", { source_title: "Bron B" })], d => {
      assert.equal(d.standby, 6);
      assert.ok(d.notes.some(note => /6 W uit de accu \(claim #2\) in plaats van 0 W aan de netkant \(claim #1\)/.test(note)), d.notes.join(" | "));
    }],
  ["bruikbaar is nominaal × ontlaaddiepte als de bron geen bruikbare capaciteit noemt",
    [claim(1, "nominal_energy_wh", 10000), claim(2, "depth_of_discharge_pct", 90)], d => assert.equal(d.capacity, 9)],
  ["zonder ontlaaddiepte geldt de aanname voor het bruikbare deel", [claim(1, "nominal_energy_wh", 10000)],
    d => assert.equal(d.capacity, 10 * Data.FALLBACK.usableShare / 100)],
  ["bruikbare capaciteit gaat voor nominaal", [claim(1, "nominal_energy_wh", 10000), claim(2, "usable_energy_wh", 9500)],
    d => assert.equal(d.capacity, 9.5)],
  ["betwiste en vervangen claims tellen niet", [claim(1, "usable_energy_wh", 5000, "ac_ac", { review_status: "disputed" }),
    claim(2, "usable_energy_wh", 6000, "ac_ac", { review_status: "superseded" }), claim(3, "usable_energy_wh", 4000)],
    d => assert.equal(d.capacity, 4)],
  ["claims van een andere uitvoering tellen niet", [claim(1, "usable_energy_wh", 5000, "ac_ac", { configuration_id: 2 })], d => {
    assert.equal(d.capacity, null);
    assert.ok(d.missing.includes("bruikbare capaciteit"));
  }]
];
for (const [name, numbers, check] of RULES) {
  test(`describe(): ${name}`, () => check(Data.describe(catalog(numbers), config)));
}

test("describe(): de nieuwste geldige prijs inclusief btw; zonder btw of verlopen telt niet als aanschafprijs", () => {
  const withOffers = offers => Data.describe({ ...catalog([]), offers }, config);
  assert.equal(withOffers([offer(1), offer(2), offer(3, { review_status: "disputed" })]).offer.id, 2);
  assert.equal(withOffers([offer(1), offer(2, { valid_until_unix_s: 1 })]).offer.id, 1);
  const excluded = withOffers([offer(1, { tax_basis: "excluded" })]);
  assert.equal(excluded.offer, null);
  assert.equal(excluded.otherOffer.id, 1);
});

test("describe(): bij prijzen van hetzelfde moment de hoogste, de lagere genoemd", () => {
  const same = { observed_at_unix_s: 1_700_000_000 };
  const d = Data.describe({ ...catalog([]), offers: [
    offer(1, { ...same, upfront_amount_minor: 50933, seller: "Winkel A" }),
    offer(2, { ...same, upfront_amount_minor: 74900, seller: "Winkel B" })] }, config);
  assert.equal(d.offer.id, 2);
  assert.match(d.notes.join(" "), /hoogste gepubliceerde prijs van dat moment; ook gezien: €\s509,33 bij Winkel A/);
});

test("describe(): de garantiestresstest volgt de productgarantie, hoogstens de aangenomen levensduur", () => {
  const warranty = months => Data.describe({ ...catalog([]), warranties: [{ configuration_id: 1, product_months: months }] }, config).warrantyStress;
  assert.deepEqual({ ...warranty(120), basis: undefined },
    { operating_life_years: 10, annual_capacity_loss_pct: Data.WARRANTY_LOSS, basis: undefined });
  assert.match(warranty(120).basis, /productgarantie van 10 jaar volgens de bron; 3,5% capaciteitsverlies per jaar is een aanname/);
  assert.equal(warranty(300).operating_life_years, Data.FALLBACK.life);
  assert.equal(warranty(24).operating_life_years, 2);
  assert.equal(warranty(30).operating_life_years, 2);
  // De kortste geldige claim telt; betwiste en vervangen claims niet.
  const claims = list => Data.describe({ ...catalog([]), warranties: list.map(([months, review_status]) =>
    ({ configuration_id: 1, product_months: months, review_status })) }, config).warrantyStress.operating_life_years;
  assert.equal(claims([[60, "reviewed"], [120, "disputed"]]), 5);
  assert.equal(claims([[60, "unreviewed"], [120, "superseded"]]), 5);
  assert.equal(claims([[120, "unreviewed"], [96, "unreviewed"]]), 8);
  // Onbekende garantie: geen stresstest, geen verzonnen getal.
  assert.equal(Data.describe(catalog([]), config).warrantyStress, null);
});

test("UI.parse leest Nederlandse notatie en weigert dubbelzinnige punten", () => {
  // ‘3,500’ is bij een bedrag of jaartotaal Engelse notatie voor 3500 of een tikfout; niet stil 3,5.
  assert.equal(context.UI.parse("3,500", { money: true }), null);
  assert.equal(context.UI.parse("3,500", { whole: true }), null);
  assert.match(context.UI.parseProblem("3,500", { money: true }), /^Bedoel je 3500 of 3,5\?/);
  assert.equal(context.UI.parse("3,500"), 3.5);
  assert.equal(context.UI.parse("0,250", { money: true }), 0.25);
  const { UI } = context;
  const cases = [["3,5", 3.5], ["6.500,00", 6500], ["1.250.000", 1250000], ["0.250", 0.25], ["0.2552", 0.2552],
    ["12.5", 12.5], ["-0,5", -0.5], ["3 500", 3500], ["", null], ["abc", null], ["1,250.50", null],
    // Eén punt met precies drie cijfers kan 3500 of 3,5 zijn: geen getal, het formulier vraagt het na.
    ["3.500", null], ["2.688", null], ["€ 3.500", null],
    // Wat wel een getal lijkt voor Number(), maar niet in een Nederlands invoerveld hoort.
    ["0x10", null], ["1e3", null], ["Infinity", null], ["6500,-", 6500], ["€ 6.500,00", 6500]];
  for (const [raw, expected] of cases) assert.equal(UI.parse(raw), expected, raw);
  // Bij een bedrag in euro zijn drie cijfers na de punt een duizendtal: centen hebben er twee.
  for (const [raw, expected] of [["6.500", 6500], ["€ 6.500", 6500], ["6.500,-", 6500], ["0.25", 0.25], ["12.345.678", 12345678]]) {
    assert.equal(UI.parse(raw, { money: true }), expected, raw);
  }
  // Een jaartotaal in hele kWh leest ‘3.200’ ook als 3200; een kleiner getal blijft gewoon decimaal.
  for (const [raw, expected] of [["3.200", 3200], ["3.200,5", 3200.5], ["12.5", 12.5], ["0.250", 0.25]]) {
    assert.equal(UI.parse(raw, { whole: true }), expected, raw);
  }
  assert.equal(UI.parseProblem("3.200", { whole: true }), "");
  assert.match(UI.parseProblem("€ 3.500"), /Bedoel je 3500 of 3,500\?/);
  assert.equal(UI.parseProblem("€ 3.500", { money: true }), "");
  assert.match(UI.parseProblem("0x10"), /Vul een getal in/);
  // Beginwaarden in een veld lezen terug als hetzelfde getal.
  for (const value of [2.688, 0.25, 1250, 3.5]) assert.equal(UI.parse(UI.plain(value)), value);
});

test("costLinesFor(): een aanbieding inclusief installatie telt de installatie niet nog eens", () => {
  // Keuzehulp en Zelf doorrekenen bouwen hun kosten met deze functie; een eigen offerte met installatie
  // mag in geen van beide het installatiepakket en de reserve erbij krijgen.
  const costs = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "crates", "server", "resources", "cost-catalog.json"), "utf8"));
  const described = included => ({ kind: "fixed", circuit: false, phases: null, inverterIncluded: true, config,
    offer: { seller: "Fictief", source_url: "https://example.test/offerte", upfront_amount_minor: 500000, includes_installation: included } });
  const status = lines => Object.fromEntries(lines.map(l => [l.category, l.status]));
  const withInstallation = status(Data.costLinesFor(costs, described(true)));
  const without = status(Data.costLinesFor(costs, described(false)));
  assert.equal(without.installation, "priced");
  assert.notEqual(withInstallation.installation, "priced");
  const battery = Data.costLinesFor(costs, described(true)).find(l => l.category === "battery");
  assert.equal(battery.amount_minor, 500000);
  assert.match(battery.notes, /inclusief installatie/);
});

test("exportCheck(): waarschuwt boven 4,4 cent netto per kWh, niet bij de indicatie", () => {
  assert.match(Data.exportCheck(0.10, 0), /10,0 cent per kWh, meer dan de 4,4 cent/);
  assert.equal(Data.exportCheck(0.0615, 0.0515), null);
  assert.equal(Data.exportCheck(0.05, 0.006), null, "precies 4,4 cent is nog gangbaar");
  assert.equal(Data.exportCheck(null, 0), null);
  // In Zelf doorrekenen staan de staffels op hetzelfde scherm en het contractenoverzicht niet.
  const own = Data.exportCheck(0.06, 0, { own: true });
  assert.match(own, /dat we vonden/);
  assert.match(own, /staffels hieronder/);
  assert.doesNotMatch(own, /hierboven|in Zelf doorrekenen/);
});

test("upfrontCosts(): betaalde startposten, teruggaven negatief en nooit onder nul, zoals project()", () => {
  const line = (category, amount_minor, status = "priced", timing = "upfront") => ({ category, amount_minor, status, timing });
  const lines = [line("battery", 300000), line("installation", 50000), line("contingency", 0, "unknown"),
    line("vat_refund", 40000), line("subscription", 1200, "priced", "annual")];
  // 3.000 + 500 − 400; het abonnement en de onbekende post tellen niet mee.
  assert.equal(Data.upfrontCosts(lines), 3100);
  assert.equal(Data.upfrontCosts(lines, { credits: false }), 3500);
  // Een subsidie boven de kosten geeft geen negatieve startinvestering (analysis.rs: `.max(0.0)`).
  assert.equal(Data.upfrontCosts([line("battery", 10000), line("grant", 25000)]), 0);
});

test("described(): de uitvoering achter een optie, op naam en soort aansluiting", async () => {
  // Een eigen context met een nep-API, zodat Data.catalog() deze synthetische catalogus teruggeeft.
  const stekker = { ...config, name: "1 unit · 5 kWh · stekker" };
  const cmp = { ...catalog([claim(1, "usable_energy_wh", 5000), claim(2, "continuous_discharge_power_w", 2500, "system_ac")]),
    texts: [{ id: 3, configuration_id: 1, review_status: "unreviewed", metric_key: "coupling", value: "AC-gekoppeld (stekker)" }],
    configurations: [stekker] };
  const own = { console, Intl, Map, Set };
  own.window = own;
  vm.createContext(own);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", "web", "ui.js"), "utf8"), own, { filename: "ui.js" });
  own.UI.api = async url => url === "/api/v1/comparison" ? cmp : {};
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", "web", "data.js"), "utf8"), own, { filename: "data.js" });
  const base = own.Data.describe(cmp, stekker), plug = own.Data.plugLimit(base), variant = own.Data.circuitVariant(cmp, base);
  const found = await own.Data.described([
    { key: "c1", name: plug.name, configuration_id: 1, connection: "plug" },
    { key: "g1", name: variant.name, configuration_id: 1, connection: "circuit" },
    { key: "renamed", name: "Testaccu via installateur", configuration_id: 1, connection: "circuit" },
    { key: "old", name: "Fictief Testaccu · oude naam", configuration_id: 1 },
    { key: "other", name: "Een andere accu", configuration_id: 1, connection: "plug" },
    { key: "missing", name: plug.name, configuration_id: 2 }]);
  const kinds = Object.fromEntries([...found].map(([key, p]) => [key, own.Data.connectionOf(p)]));
  assert.deepEqual(kinds, { c1: "plug", g1: "circuit", renamed: "circuit", old: "plug" });
  assert.equal(found.get("c1").battery.discharge_power_kw, 0.8, "de stekkeruitvoering is begrensd op 800 W");
  assert.equal(found.get("g1").battery.discharge_power_kw, 2.5);
});

test("shortLabels(): korte namen alleen uit de catalogus, uniek, anders met meer detail of de volle naam", () => {
  const battery = (kwh, kw) => ({ usable_capacity_kwh: kwh, discharge_power_kw: kw });
  const candidates = [
    { key: "a", configuration_id: 1, name: "Fictief Accu · 1-fase · 5 kWh · stekker", battery: battery(5, 0.8) },
    { key: "b", configuration_id: 2, name: "Fictief Accu · 3-fase · 5 kWh · stekker", battery: battery(5, 0.8) },
    { key: "c", configuration_id: 3, name: "Fictief Groot · 10 kWh", battery: battery(9.5, 2.4) },
    { key: "d", configuration_id: 3, name: "Fictief Groot · 10 kWh · eigen groep 3 kW (afgeleid)", battery: battery(9.5, 3) },
    { key: "own", configuration_id: null, name: "Offerte · Installateur A", battery: battery(10, 5) },
    { key: "e", configuration_id: 4, name: "Fictief Twee · 5 kWh", battery: battery(5, 1) },
    { key: "f", configuration_id: 5, name: "Fictief Twee · 5 kWh", battery: battery(5, 1) }];
  const kinds = new Map([["a", "plug"], ["b", "plug"], ["c", "fixed"], ["d", "circuit"], ["own", "plug"], ["e", "fixed"], ["f", "fixed"]]);
  const labels = Data.shortLabels(candidates, kinds);
  assert.equal(labels.get("a"), "Stekker 0,8 kW · Fictief Accu · 1-fase · 5 kWh");
  assert.equal(labels.get("b"), "Stekker 0,8 kW · Fictief Accu · 3-fase · 5 kWh");
  assert.equal(labels.get("c"), "Vast 2,4 kW · Fictief Groot · 9,5 kWh");
  assert.equal(labels.get("d"), "Eigen groep 3 kW (afgeleid) · Fictief Groot · 9,5 kWh");
  assert.equal(labels.get("own"), "Offerte · Installateur A", "een eigen naam blijft staan");
  assert.equal(labels.get("e"), "Fictief Twee · 5 kWh", "zonder onderscheid de volle naam");
});

test("costLinesFor(): een stekkeraccu op een eigen groep krijgt de extra groep als installatie", () => {
  const costs = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "crates", "server", "resources", "cost-catalog.json"), "utf8"));
  const p = { kind: "plug", circuit: false, phases: null, inverterIncluded: true, config };
  const installation = (item, kind) => Data.costLinesFor(costs, item, {}, kind).find(l => l.category === "installation");
  assert.notEqual(installation(p, "plug").status, "priced");
  const group = installation({ ...p, circuit: true }, "fixed");
  assert.equal(group.status, "priced");
  assert.equal(group.amount_minor, Math.round(costs.estimates.amounts.dedicated_circuit.amount_eur * 100));
});

test("CSV: negatieve getallen blijven getallen, formules worden tekst", () => {
  const { UI } = context;
  assert.equal(UI.csvCell(UI.number(-1234.567, 2)), '"-1.234,57"');
  assert.equal(UI.csvCell("-50,00"), '"-50,00"');
  assert.equal(UI.csvCell("-5"), '"-5"');
  assert.equal(UI.csvCell("1.234,5"), '"1.234,5"');
  for (const text of ["=SUM(A1)", "+1+1", "-1+1", "@cmd", "\tx", "\rx", "-", "-1.23.4"]) {
    assert.equal(UI.csvCell(text), `"'${text}"`, text);
  }
  assert.equal(UI.csvCell('zeg "hoi"'), '"zeg ""hoi"""');
  assert.equal(UI.csvCell(null), '"Onbekend"');
});

test("tweede belastingschijf: alleen vermeden netafname boven 10.000 kWh telt, in het jaar met de meeste", () => {
  const year = (n, without, withBattery) => ({ year: n, calendar_year: 2026 + n, baseline_grid_import_kwh: without,
    energy: { grid_import_kwh: withBattery } });
  const p = { start_year: 2027, tariff: { annual_price_change_pct: 0 } };
  // Zonder accu 9.000 kWh: alles valt in de eerste schijf.
  assert.equal(Data.energyTaxBandExcess({ years: [year(1, 9000, 7000)] }, { grid_import_kwh: 9000 }, p), null);
  // 11.000 → 9.500: alleen de 1.000 kWh boven de grens; 12.500 → 10.500: 2.000 kWh, dat jaar wint.
  const found = Data.energyTaxBandExcess({ years: [year(1, 11000, 9500), year(2, 12500, 10500)] }, { grid_import_kwh: 11000 }, p);
  assert.equal(found.y.year, 2);
  assert.equal(found.kwh, 2000);
  // (8,80 − 6,78) cent × 1,21 = 2,4442 cent per kWh.
  assert.ok(Math.abs(found.eur - 2000 * 0.024442) < 1e-9, found.eur);
  // Met 2% prijsverandering in jaar 2 een factor 1,02; vóór 2027 geen melding (saldering).
  assert.ok(Math.abs(Data.energyTaxBandExcess({ years: [year(2, 12500, 10500)] }, {}, { ...p, tariff: { annual_price_change_pct: 2 } }).eur
    - 2000 * 0.024442 * 1.02) < 1e-9);
  assert.equal(Data.energyTaxBandExcess({ years: [year(1, 12000, 9000)] }, {}, { ...p, start_year: 2026 }), null);
  // Een run zonder netafname per jaar valt voor jaar 1 terug op het eerste jaar zonder accu.
  assert.equal(Data.energyTaxBandExcess({ years: [{ year: 1, energy: { grid_import_kwh: 9000 } }] }, { grid_import_kwh: 10600 }, p).kwh, 600);
});

test("grafieknamen worden in het midden ingekort: aansluiting en capaciteit blijven staan", () => {
  const { UI } = context;
  assert.equal(UI.clip("Stekker 0,8 kW · Kort · 5 kWh", 56), "Stekker 0,8 kW · Kort · 5 kWh");
  const long = "Eigen groep 2,4 kW (afgeleid) · Fictief Merk Een Heel Lang Productnaam Met Veel Woorden · 1-fase · 9,5 kWh";
  const short = UI.clip(long, 56);
  assert.ok(short.length <= 56 && short.length >= 50, short);
  assert.ok(short.startsWith("Eigen groep 2,4 kW (afgeleid) · Fictief"), short);
  assert.ok(short.endsWith("… · 9,5 kWh"), short);
  // Zonder genoeg ruimte voor het midden gewoon aan het eind afgekort.
  assert.equal(UI.clip("abcdefghij", 5), "abcd…");
});

test("importcontrole: een niet door te rekenen profiel krijgt uitleg in gewone taal", () => {
  const { Data, Results } = context;
  const full = { consumption_kwh: 3500, gaps: 0, coverage_hours: 8760 };
  assert.equal(Data.unusableText(full), null);
  assert.equal(Data.unusableText({ ...full, coverage_hours: 8784 }), null);
  assert.match(Data.unusableText({ ...full, consumption_kwh: null }), /alleen opwek, geen verbruik.+meterbestand/);
  assert.match(Data.unusableText({ ...full, gaps: 3 }), /Er ontbreken 3 meetperioden/);
  assert.match(Data.unusableText({ ...full, coverage_hours: 4 }), /dekt 4 uur\..+bewaren om te bekijken, maar niet doorrekenen/);
  assert.match(Data.unusableText({ ...full, coverage_hours: 24 * 200 }), /dekt 200 dagen/);
  // Meterstanden als waarden per periode gelezen: ver boven een huishouden, ook bij een kort bestand.
  const counted = { ...full, production_kwh: 3000, consumption_kwh: 273062961 };
  assert.match(Data.unusableText(counted), /273\.062\.961 kWh.+Cumulatieve meterstanden/);
  assert.equal(Data.suitability({ summary: counted, options: {} }).ok, false);
  assert.ok(Data.implausible({ ...full, production_kwh: 150000, coverage_hours: 72 }));
  // Twee jaar van 90.000 kWh is per jaar nog binnen de grens.
  assert.ok(!Data.implausible({ ...full, production_kwh: 0, consumption_kwh: 180000, coverage_hours: 2 * 8760 }));
});

// Een synthetische run met één accu; `stress` is de uitkomst als de accu direct na de garantie stopt.
const quoteRun = (option, { stress = null, price = null } = {}) => ({
  input: { request: {
    parameters: { objective: "net_present_value", horizon_years: 15 },
    quote_basis: { price },
    candidates: [{ key: "a", battery: { operating_life_years: 15, annual_capacity_loss_pct: 2 },
      warranty_stress: stress ? { operating_life_years: 10, annual_capacity_loss_pct: 3, source: "test" } : null }]
  } },
  result: { candidates: [{ key: "a", name: "FICTIEF A", ...option, warranty_stress: stress }] }
});
const euros = text => [...text.matchAll(/€\s?([\d.]+)/g)].map(m => Number(m[1].replace(/\./g, "")));

test("de garantiezin telt op: verschil plus afgeronde grens is de startinvestering", () => {
  const c = { key: "a", name: "FICTIEF A", npv_eur: 300, initial_investment_eur: 4000 };
  assert.equal(Results.warrantyFlip(quoteRun(c), c), null);
  const lucky = { npv_eur: 50, break_even_investment_eur: 4050 };
  const luckyRun = quoteRun(c, { stress: lucky });
  assert.equal(Results.warrantyFlip(luckyRun, luckyRun.result.candidates[0]), null);
  const stress = { npv_eur: -620.4, break_even_investment_eur: 3376.9 };
  const run = quoteRun(c, { stress });
  const text = Results.warrantyFlip(run, run.result.candidates[0]);
  assert.match(text, /garantie van 10 jaar/);
  const [cost, limit, diff, start] = euros(text);
  assert.equal(cost, 620);
  assert.equal(limit, 3370);
  assert.equal(diff + limit, start);
  assert.equal(start, 4000);
});

test("de offertezin telt op met de onafgeronde grens en zegt ‘rond de grens’ binnen een euro", () => {
  const under = { key: "a", npv_eur: 120, initial_investment_eur: 3500, break_even_investment_eur: 3989 };
  const [start, gap, limit] = euros(Results.quoteLead(quoteRun(under), under));
  assert.equal(start + gap, limit);
  const over = { key: "a", npv_eur: -80, initial_investment_eur: 4213, break_even_investment_eur: 4005 };
  const text = Results.quoteLead(quoteRun(over), over);
  assert.match(text, /^Niet lonend/);
  const [start2, gap2, limit2] = euros(text);
  assert.equal(start2 - gap2, limit2);
  // Het verschil sluit aan bij het netto voordeel (grens min startkosten), ook vlak onder de grens.
  const close = { key: "a", npv_eur: 5, initial_investment_eur: 3984, break_even_investment_eur: 3989 };
  assert.match(Results.quoteLead(quoteRun(close), close), /liggen €\s5 onder de grens van €\s3\.989\./);
  const edge = { key: "a", npv_eur: 0.4, initial_investment_eur: 3988.6, break_even_investment_eur: 3989 };
  assert.match(Results.quoteLead(quoteRun(edge), edge), /liggen rond de grens van €\s3\.989\./);
  const free = { key: "a", npv_eur: -900, initial_investment_eur: 3000, break_even_investment_eur: -10 };
  assert.match(Results.quoteLead(quoteRun(free), free), /^Zelfs gratis niet lonend/);
});

test("het advies zegt of de accu binnen het capaciteitsbereik van de keuzehulp valt", () => {
  const run = capacity => ({ input: { request: {
    parameters: { objective: "net_present_value" },
    sizing_range: { label: "het zinvolle bereik", low_kwh: 3, high_kwh: 3.5 },
    candidates: [{ key: "a", battery: { usable_capacity_kwh: capacity } }] } } });
  assert.match(Results.sizeNote(run(3.2), { key: "a" }), /3,2 kWh bruikbaar\) valt binnen het zinvolle bereik van 3 tot 3,5 kWh\.$/);
  assert.match(Results.sizeNote(run(5.2), { key: "a" }), /is groter dan .+ per kWh goedkoop/);
  assert.match(Results.sizeNote(run(2), { key: "a" }), /is kleiner dan .+ kosten meer dan ze extra opleveren\.$/);
  const payback = run(2);
  payback.input.request.parameters.objective = "payback";
  assert.match(Results.sizeNote(payback, { key: "a" }), /toch het beste uit\.$/);
  const old = run(3.2);
  delete old.input.request.sizing_range;
  assert.equal(Results.sizeNote(old, { key: "a" }), null);
});

test("rank() volgt de regels van de rekenkern: verlies telt niet mee, bij gelijke score wint de hoogste NPV", () => {
  const option = (key, npv_eur, extra = {}) => ({ key, name: `FICTIEF ${key}`, npv_eur, roi_pct: null, payback_years: null,
    within_budget: true, first_year: { self_consumption_pct: 50 }, ...extra });
  const run = (objective, candidates, recommended_key) => ({
    input: { request: { parameters: { objective }, candidates: candidates.map(c => ({ key: c.key })) } },
    result: { recommended_key, candidates } });
  const keys = r => Array.from(Results.rank(r), c => c.key);
  // Terugverdientijd: de snelle optie met verlies in geld van nu komt na de lonende; gelijke jaren op NPV.
  const payback = [option("verlies", -50, { payback_years: 3 }), option("klein", 100, { payback_years: 7 }),
    option("groot", 300, { payback_years: 7 }), option("nooit", 20)];
  assert.deepEqual(keys(run("payback", payback, "groot")), ["groot", "klein", "nooit", "verlies"]);
  // ROI: zonder startinvestering (geen ROI) maar met winst is het best denkbaar; met verlies het slechtst.
  const roi = [option("roi", 400, { roi_pct: 30 }), option("gratis", 10), option("min", -5, { roi_pct: 80 })];
  assert.deepEqual(keys(run("roi", roi, "gratis")), ["gratis", "roi", "min"]);
  // Buiten het budget achteraan, ook met een hogere NPV.
  const budget = [option("duur", 900, { within_budget: false }), option("past", 100)];
  assert.deepEqual(keys(run("net_present_value", budget, "past")), ["past", "duur"]);
  // Zonder aanbevolen accu bespreken oordeel, lijst en vergelijking dezelfde accu als de eerste kaart: binnen het budget.
  const none = run("net_present_value", [option("duur", 900, { within_budget: false }), option("past", -100)], "no_battery");
  assert.equal(Results.judged(none).key, "past");
  assert.equal(Results.judged(none).key, Results.rank(none)[0].key);
});

test("De berekeningenlijst bespreekt met de samenvatting dezelfde accu als de uitkomst, bij elk doel", () => {
  const option = (key, npv_eur, extra = {}) => ({ key, name: `FICTIEF ${key}`, npv_eur, roi_pct: null, payback_years: null,
    within_budget: true, first_year: { self_consumption_pct: 50, grid_import_kwh: 1 }, years: [{}], ...extra });
  const candidates = [option("klein", -237, { roi_pct: -10, payback_years: 14, first_year: { self_consumption_pct: 60 } }),
    option("groot", 5284, { within_budget: false, roi_pct: 40, payback_years: 6, first_year: { self_consumption_pct: 80 } }),
    option("middel", -50, { roi_pct: -2, first_year: { self_consumption_pct: 70 } })];
  // Dezelfde velden als `SummaryCandidate` in crates/storage/src/analysis.rs.
  const summary = c => ({ key: c.key, name: c.name, npv_eur: c.npv_eur, within_budget: c.within_budget, roi_pct: c.roi_pct,
    payback_years: c.payback_years, first_year: { self_consumption_pct: c.first_year.self_consumption_pct } });
  for (const objective of ["net_present_value", "roi", "payback", "self_consumption"]) {
    const run = { input: { request: { parameters: { objective } } }, result: { recommended_key: "no_battery", candidates } };
    const listed = { ...run, result: { ...run.result, candidates: candidates.map(summary) } };
    assert.equal(Results.judged(listed).key, Results.judged(run).key, objective);
    assert.notEqual(Results.judged(run).key, "groot", objective);
  }
});

test("whatIf(): eerst de grensprijs van de besproken accu, dan de beste accu boven het budget", () => {
  const run = (candidates, budget_eur = 1600) => ({ input: { request: { parameters: { objective: "net_present_value", budget_eur },
    candidates: candidates.map(c => ({ key: c.key, costs: [] })) } }, result: { recommended_key: "no_battery", candidates } });
  const klein = { key: "klein", name: "FICTIEF klein", npv_eur: -237, within_budget: true, initial_investment_eur: 1500,
    break_even_investment_eur: 1263 };
  const groot = { key: "groot", name: "FICTIEF groot", npv_eur: 5284, within_budget: false, initial_investment_eur: 2000,
    break_even_investment_eur: 7284 };
  const lines = Array.from(Results.whatIf(run([klein, groot]), klein));
  assert.equal(lines.length, 2);
  // 1.263 naar beneden op € 10: 1.260.
  assert.match(lines[0], /^FICTIEF klein minder kost dan ongeveer €\s1\.260 \(nu €\s1\.500\)\.$/);
  assert.match(lines[1], /^je budget ruimer is: FICTIEF groot kost €\s2\.000, meer dan je budget van €\s1\.600, en levert netto €\s5\.284 op/);
  // Is de besproken accu zelf de lonende boven het budget, dan alleen de budgetregel.
  const own = Array.from(Results.whatIf(run([groot]), groot));
  assert.deepEqual(own.length, 1);
  assert.match(own[0], /^je budget ruimer is: FICTIEF groot/);
  // Zelfs gratis niet lonend: geen prijs om naar te streven.
  const free = Array.from(Results.whatIf(run([{ ...klein, break_even_investment_eur: -40 }]), { ...klein, break_even_investment_eur: -40 }));
  assert.match(free[0], /zelfs gratis niet lonend/);
});

test("perCent(): 1 cent meer netto terugleverwaarde, met de hand na te rekenen; zonder teruglevering niets", () => {
  const run = { input: { request: { parameters: { start_year: 2027, discount_pct: 0,
    tariff: { annual_price_change_pct: 0, export_fee_bands: [] } } } } };
  const option = exports => ({ years: [{ year: 1, baseline_grid_export_kwh: exports[0], energy: { grid_export_kwh: exports[1] } }] });
  // Zonder accu 1.000 kWh teruggeleverd, met accu 400: de rekening is € 10 lager, de accu € 6 minder waard.
  const cent = Results.perCent(run, option([1000, 400]));
  assert.ok(Math.abs(cent.bill - 10) < 1e-9 && Math.abs(cent.npv + 6) < 1e-9, JSON.stringify(cent));
  assert.equal(Results.perCent(run, option([0, 0])), null);
  // Met een staffel is de waarde per kWh niet één getal.
  const banded = { input: { request: { parameters: { ...run.input.request.parameters,
    tariff: { annual_price_change_pct: 0, export_fee_bands: [{}] } } } } };
  assert.equal(Results.perCent(banded, option([1000, 400])), null);
});

test("salderenGap(): het kleinste van netafname en teruglevering maal het prijsverschil; vóór 2027 en zonder teruglevering niets", () => {
  const run = (start, imp, exp) => ({ input: { request: { parameters: { start_year: start,
    tariff: { import_eur_per_kwh: 0.25, export_eur_per_kwh: 0.05 } } } },
    result: { baseline_first_year: { grid_import_kwh: imp, grid_export_kwh: exp } } });
  // 3.000 kWh afname, 2.000 kWh teruglevering: met salderen 1.000 × 0,25 = € 250, zonder 750 − 100 = € 650.
  const gap = Results.salderenGap(run(2027, 3000, 2000));
  assert.ok(Math.abs(gap.eur - 400) < 1e-9 && gap.kwh === 2000, JSON.stringify(gap));
  // Meer teruglevering dan afname: met salderen −1.000 × 0,05 = −€ 50, zonder 500 − 150 = € 350.
  assert.ok(Math.abs(Results.salderenGap(run(2027, 2000, 3000)).eur - 400) < 1e-9);
  assert.equal(Results.salderenGap(run(2026, 3000, 2000)), null);
  assert.equal(Results.salderenGap(run(2027, 3000, 0)), null);
});

test("quoted(): in Zelf doorrekenen is de enige optie met een totaalprijs uit een offerte je offerte", () => {
  const line = source => ({ category: "battery", status: "priced", amount_minor: 695000, source });
  const run = sources => ({ input: { request: { candidates: sources.map((source, i) => ({ key: `o${i}`, costs: [line(source)] })) } },
    result: { candidates: sources.map((_, i) => ({ key: `o${i}` })) } });
  assert.equal(Results.quoted(run([Data.QUOTE_TOTAL, "Aanname"])).key, "o0");
  // Twee opties met een offerteprijs: niet één ‘je offerte’.
  assert.equal(Results.quoted(run([Data.QUOTE_TOTAL, Data.QUOTE_TOTAL])), null);
  assert.equal(Results.quoted(run(["Aanname"])), null);
});

test("trimmed(): een kopie van een grote berekening houdt de beste vijf en de beste vaste accu", () => {
  context.Scenario = { MAX_OPTIONS: 12 };
  const candidates = Array.from({ length: 14 }, (_, i) => ({ key: `p${i}`, name: `FICTIEF ${i}`, npv_eur: 1000 - i,
    within_budget: true }));
  const request = { parameters: { objective: "net_present_value" },
    candidates: candidates.map((c, i) => ({ key: c.key, connection: i === 13 ? "fixed" : "plug" })) };
  const run = { input: { request }, result: { recommended_key: "p0", candidates } };
  assert.deepEqual(Array.from(Results.trimmed(run, request).candidates, c => c.key), ["p0", "p1", "p2", "p3", "p4", "p13"]);
  // Een stekker op een eigen groep is de beste ‘met een installateur’ die het oordeel bij een stekkeraccu noemt; die
  // blijft ook, naast de beste vaste.
  const mixed = { ...request, candidates: request.candidates.map((c, i) => ({ ...c, connection: i === 12 ? "circuit" : c.connection })) };
  const both = { input: { request: mixed }, result: run.result };
  assert.deepEqual(Array.from(Results.trimmed(both, mixed).candidates, c => c.key), ["p0", "p1", "p2", "p3", "p4", "p12", "p13"]);
});

test("shareable(): de link houdt de installateursopties en de auto uit het geschatte profiel, niet de importinstellingen", () => {
  const candidates = Array.from({ length: 9 }, (_, i) => ({ key: `p${i}`, name: `FICTIEF ${i}`, npv_eur: 900 - i, within_budget: true }));
  const run = { title: "FICTIEF", created_at_unix_s: 0,
    input: { profile: { filename: "Geschat profiel", options: { generator: "typical", data_kind: "modelled",
      inputs: { ev: { annual_kwh: 2000, charging: "night" }, annual_consumption_kwh: 5000 } } },
      request: { parameters: { objective: "net_present_value" }, site: { address: "Synthetisch 1" },
        candidates: candidates.map((c, i) => ({ key: c.key, connection: i === 7 ? "circuit" : i === 8 ? "fixed" : "plug" })) } },
    result: { recommended_key: "p0", candidates } };
  const shared = Results.shareable(run);
  assert.deepEqual(Array.from(shared.result.candidates, c => c.key), ["p0", "p1", "p2", "p3", "p4", "p7", "p8"]);
  assert.equal(JSON.stringify(shared.input.profile.options.inputs), JSON.stringify({ ev: { annual_kwh: 2000, charging: "night" } }));
  assert.equal(shared.input.request.site.address, "Adres niet gedeeld");
});

test("shareable() en trimmed(): je offerte blijft, ook als hij laag eindigt", () => {
  context.Scenario = { MAX_OPTIONS: 12 };
  const candidates = Array.from({ length: 14 }, (_, i) => ({ key: `p${i}`, name: `FICTIEF ${i}`, npv_eur: 900 - i, within_budget: true }));
  const line = { category: "battery", status: "priced", amount_minor: 500000, source: Data.QUOTE_TOTAL };
  const request = { parameters: { objective: "net_present_value" }, site: { address: "Synthetisch 1" },
    candidates: candidates.map((c, i) => ({ key: c.key, connection: "plug", costs: i === 13 ? [line] : [] })) };
  const run = { title: "FICTIEF", created_at_unix_s: 0, input: { profile: null, request }, result: { recommended_key: "p0", candidates } };
  assert.equal(Results.quoted(run).key, "p13");
  const shared = Results.shareable(run);
  assert.equal(Results.quoted(shared).key, "p13");
  assert.ok(Results.trimmed(run, request).candidates.some(c => c.key === "p13"));
  // Ook de herkomst uit de offertecheck.
  const recalculated = { ...run, input: { ...run.input, request: { ...request, quote_basis: { candidate_key: "p12" } } } };
  assert.equal(Results.quoted(Results.shareable(recalculated)).key, "p12");
});

test("quotesCompared(): twee offertes naast elkaar, met hoeveel de ongunstige moet zakken", () => {
  const line = amount => ({ category: "battery", status: "priced", amount_minor: amount, source: Data.QUOTE_TOTAL });
  const input = (key, costs, kw = 2.5) => ({ key, battery: { discharge_power_kw: kw }, costs });
  const option = (key, npv_eur, initial_investment_eur, break_even_investment_eur) =>
    ({ key, name: `FICTIEF ${key}`, npv_eur, initial_investment_eur, break_even_investment_eur });
  const run = (candidates, extra = {}) => ({ input: { request: { candidates, ...extra } }, result: { candidates: [
    option("a", -400, 6000, 5600), option("b", 300, 5000, 5300), option("c", 900, 3000, 3900), option("d", -100, 2000, -50)] } });
  const quotes = Results.quotesCompared(run([input("a", [line(600000)], 5), input("b", [line(500000)]),
    input("c", [{ ...line(300000), source: "Richtprijs" }]), input("d", [line(200000)])]));
  // Van gunstig naar ongunstig; de richtprijs telt niet als offerte.
  assert.deepEqual(quotes.map(q => q.option.key), ["b", "d", "a"]);
  assert.deepEqual(quotes.map(q => q.total), [5000, 2000, 6000]);
  assert.equal(quotes[2].kw, 5);
  // Lonend: niets te zakken; zelfs gratis niet lonend: geen bedrag; anders startkosten min grens.
  assert.deepEqual(quotes.map(q => q.cut), [null, null, 400]);
  // Eén offerte, of een herberekening uit de offertecheck: niets naast elkaar.
  assert.equal(Results.quotesCompared(run([input("a", [line(600000)]), input("b", [])])), null);
  assert.equal(Results.quotesCompared(run([input("a", [line(600000)]), input("b", [line(500000)])],
    { quote_basis: { candidate_key: "a" } })), null);
});

test("billGap(): de teruglevering van het geschatte profiel naast die op de jaarafrekening", () => {
  const run = (bill, base) => ({ input: { request: { bill_totals: bill } }, result: { baseline_first_year: base } });
  const base = { production_kwh: 4000, grid_export_kwh: 2000 };
  // 10% van de opwek is 400 kWh: daaronder niets, vanaf daar wel, in beide richtingen.
  assert.equal(Results.billGap(run({ grid_import_kwh: 3000, grid_export_kwh: 2399 }, base)), null);
  assert.deepEqual({ ...Results.billGap(run({ grid_import_kwh: 3000, grid_export_kwh: 2400 }, base)) }, { bill: 2400, model: 2000, more: true });
  assert.equal(Results.billGap(run({ grid_import_kwh: 3000, grid_export_kwh: 1500 }, base)).more, false);
  // Oudere runs en profielen zonder opwek.
  assert.equal(Results.billGap(run(undefined, base)), null);
  assert.equal(Results.billGap(run({ grid_import_kwh: 3000, grid_export_kwh: 0 }, { production_kwh: 0, grid_export_kwh: 0 })), null);
});

test("modelwijziging v7 raakt alleen een run met een gelijke terugverdientijd die nu anders uitvalt", () => {
  const option = (key, npv_eur, payback_years, extra = {}) => ({ key, npv_eur, payback_years, within_budget: true, ...extra });
  const affects = (candidates, recommended_key, extra = {}) => Data.modelChanges("nl-self-consumption-v6", {
    input: { request: { parameters: { objective: "payback" }, candidates: [] } },
    result: { recommended_key, candidates, ...extra } }).find(c => /gelijk aantal jaren/.test(c.text)).affects;
  assert.equal(affects([option("a", 100, 7), option("b", 300, 7)], "a"), true);
  assert.equal(affects([option("a", 300, 7), option("b", 100, 7)], "a"), false);
  assert.equal(affects([option("a", 100, 6), option("b", 300, 7)], "a"), false);
  // Buiten het budget of met verlies telt niet mee.
  assert.equal(affects([option("a", 100, 7), option("b", 300, 7, { within_budget: false })], "a"), false);
  // In de terugleveringsvariant.
  const variant = (npv_eur, payback_years) => ({ export_variant: { npv_eur, payback_years } });
  assert.equal(affects([option("a", 100, 6, variant(50, 8)), option("b", 90, 7, variant(80, 8))], "a",
    { export_variant_recommended_key: "a" }), true);
});
