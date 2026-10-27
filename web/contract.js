"use strict";

// GEGENEREERD door crates/server/tests/contract.rs uit de constanten in de Rust-code; niet met de hand bewerken.
// Vernieuwen: UPDATE_CONTRACT=1 cargo test -p thuisaccu-server --test contract
// Feiten uit de rekenkern, de opslag en de API die de interface overneemt: de modelversie, het laatste jaar met
// salderen, doelen, soorten aansluiting, kostencategorieën, offertevelden in de volgorde van de interface, de vaste
// meldingscodes en de grenzen van de invoer (per onderdeel van het verzoek, min en max inbegrepen). Alles is bevroren.
window.Contract = (() => {
  const freeze = value => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  return freeze({
    modelVersion: "nl-self-consumption-v8",
    lastNettingYear: 2026,
    objectives: ["net_present_value", "roi", "payback", "self_consumption"],
    connections: ["plug", "fixed", "circuit"],
    costCategories: [
      "battery",
      "inverter",
      "ems_metering",
      "backup",
      "installation",
      "cabling_protection",
      "meter_cabinet",
      "grid_connection",
      "survey_permits",
      "delivery",
      "other_upfront",
      "contingency",
      "subscription",
      "maintenance",
      "insurance",
      "extra_grid_fees",
      "extra_contract_fees",
      "tax_administration",
      "tax_private_use",
      "other_annual",
      "inverter_replacement",
      "battery_replacement",
      "removal_recycling",
      "grant",
      "vat_refund",
      "residual_value"
    ],
    creditCategories: ["grant", "vat_refund", "residual_value"],
    quoteFields: [
      "usable_capacity_kwh",
      "charge_power_kw",
      "discharge_power_kw",
      "ac_round_trip_efficiency_pct",
      "standby_w",
      "operating_life_years",
      "annual_capacity_loss_pct",
      "upfront_eur",
      "subscription_eur"
    ],
    quoteTotalSource: "Offerte (totaalprijs inclusief btw)",
    messageCodes: [
      { code: "profile.demo", kind: "warning" },
      { code: "profile.estimated", kind: "warning" },
      { code: "profile.modelled", kind: "warning" },
      { code: "model.strategy", kind: "note" },
      { code: "model.repeat_year", kind: "note" },
      { code: "model.roi", kind: "note" },
      { code: "model.vat", kind: "note" },
      { code: "model.address", kind: "note" },
      { code: "model.load_variation", kind: "note" },
      { code: "model.measured", kind: "note" },
      { code: "load_change.added", kind: "warning" },
      { code: "load_change.unmetered", kind: "warning" },
      { code: "netting.simplified", kind: "warning" },
      { code: "export_variant", kind: "warning" },
      { code: "grid_tariff.2029", kind: "warning" },
      { code: "credit.vat_refund", kind: "warning" },
      { code: "credit.grant", kind: "warning" },
      { code: "life.inactive", kind: "warning" },
      { code: "life.beyond_horizon", kind: "warning" },
      { code: "warranty_stress", kind: "warning" },
      { code: "objective.self_consumption", kind: "warning" }
    ],
    limits: {
      parameters: {
        start_year: { min: 2026, max: 2100 },
        horizon_years: { min: 1, max: 30 },
        discount_pct: { min: 0, max: 30 },
        annual_cost_escalation_pct: { min: -20, max: 30 },
        annual_pv_loss_pct: { min: 0, max: 10 },
        annual_load_growth_pct: { min: -20, max: 30 },
        price_uncertainty_pct: { min: 0, max: 80 },
        cost_uncertainty_pct: { min: 0, max: 80 },
        budget_eur: { min: 0, max: 1000000000 }
      },
      tariff: {
        import_eur_per_kwh: { min: -10, max: 10 },
        export_eur_per_kwh: { min: -10, max: 10 },
        export_fee_eur_per_kwh: { min: 0, max: 10 },
        fixed_annual_eur: { min: 0, max: 1000000 },
        annual_price_change_pct: { min: -20, max: 30 }
      },
      export_variant: { export_eur_per_kwh: { min: -10, max: 10 }, export_fee_eur_per_kwh: { min: 0, max: 10 } },
      battery: {
        usable_capacity_kwh: { min: 0.01, max: 1000 },
        charge_power_kw: { min: 0.01, max: 1000 },
        discharge_power_kw: { min: 0.01, max: 1000 },
        ac_round_trip_efficiency_pct: { min: 1, max: 100 },
        standby_w: { min: 0, max: 10000 },
        annual_capacity_loss_pct: { min: 0, max: 20 },
        operating_life_years: { min: 1, max: 30 }
      },
      warranty_stress: { operating_life_years: { min: 1, max: 30 }, annual_capacity_loss_pct: { min: 0, max: 20 } },
      financing: { loan_amount_eur: { min: 0, max: 1000000000 }, annual_interest_pct: { min: 0, max: 30 } }
    },
    typicalProfile: {
      heat_pump_kwh: { min: 0, max: 30000 },
      ev_kwh: { min: 0, max: 20000 },
      peak_power_kwp: { min: 0.1, max: 100 }
    },
    loadChanges: { heat_pump: { min: 1, max: 30000 }, ev: { min: 1, max: 20000 } }
  });
})();
