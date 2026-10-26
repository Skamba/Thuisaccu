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
