"use strict";

// Eenheidstests voor web/data.js zonder browser: ui.js en data.js draaien in een eigen context.
// Alleen synthetische, hier opgebouwde gegevens.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = { console, Intl, Map, Set };
context.window = context;
vm.createContext(context);
for (const file of ["ui.js", "data.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", "web", file), "utf8"), context, { filename: file });
}
const { Data } = context;

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
  const { Data } = context;
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
