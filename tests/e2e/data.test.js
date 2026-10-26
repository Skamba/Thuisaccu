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
const claim = (id, metric_key, value, boundary = "ac_ac", extra = {}) => ({
  id, configuration_id: 1, review_status: "unreviewed", metric_key, value, boundary,
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

test("de 800 W-begrenzing uit de keuzehulp wordt herkend", () => {
  // Dezelfde zin als in keuzehulp.js; die bouwt hem met het opgegeven vermogen.
  const keuzehulp = fs.readFileSync(path.join(__dirname, "..", "..", "web", "keuzehulp.js"), "utf8");
  assert.match(keuzehulp, /`Aanname: ontladen ingesteld op 800 W voor een gewoon stopcontact/);
  assert.equal(Data.isAssumed("discharge_power_kw", "Aanname: ontladen ingesteld op 800 W voor een gewoon stopcontact."), true);
  assert.equal(Data.fromKeuzehulp({ assumptions: `${Data.KEUZEHULP_PREFIX} Aanname: …` }), true);
  assert.equal(Data.fromKeuzehulp({ assumptions: "Offerte van de installateur" }), false);
});
