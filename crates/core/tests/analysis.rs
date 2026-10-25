use thuisaccu_core::{
    analysis::{self, Candidate, Objective, Parameters},
    finance::{self, CostLine, CostStatus, CostTiming, ExportFeeBand, Financing, Tariff},
    sizing::{self, Battery, EnergyInterval, LoadVariation},
};

fn battery(capacity: f64) -> Battery {
    Battery {
        usable_capacity_kwh: capacity,
        charge_power_kw: 10.0,
        discharge_power_kw: 10.0,
        ac_round_trip_efficiency_pct: 100.0,
        standby_w: 0.0,
        annual_capacity_loss_pct: 0.0,
        operating_life_years: 15,
    }
}

fn profile() -> Vec<EnergyInterval> {
    (0..8760)
        .map(|i| EnergyInterval {
            duration_hours: 1.0,
            production_kwh: if i % 2 == 0 { 2.0 } else { 0.0 },
            consumption_kwh: if i % 2 == 1 { 2.0 } else { 0.0 },
            steady_consumption_kwh: None,
        })
        .collect()
}

fn parameters() -> Parameters {
    Parameters {
        start_year: 2027,
        horizon_years: 1,
        discount_pct: 0.0,
        annual_cost_escalation_pct: 0.0,
        annual_pv_loss_pct: 0.0,
        annual_load_growth_pct: 0.0,
        objective: Objective::NetPresentValue,
        budget_eur: None,
        price_uncertainty_pct: 20.0,
        cost_uncertainty_pct: 15.0,
        tariff: Tariff {
            import_eur_per_kwh: 0.30,
            export_eur_per_kwh: 0.08,
            export_fee_eur_per_kwh: 0.0,
            export_fee_bands: vec![],
            fixed_annual_eur: 0.0,
            annual_price_change_pct: 0.0,
        },
        export_variant: None,
        load_variation: LoadVariation::Uniform,
    }
}

fn candidate(key: &str, capacity: f64, price_minor: i64) -> Candidate {
    let mut costs: Vec<_> = finance::COST_CATEGORIES
        .iter()
        .map(|key| CostLine {
            category: key.to_string(),
            status: CostStatus::NotApplicable,
            amount_minor: 0,
            timing: CostTiming::Upfront,
            year: None,
            source: "Explicit test fixture assumption".into(),
            notes: String::new(),
        })
        .collect();
    let first = &mut costs[0];
    first.status = CostStatus::Priced;
    first.amount_minor = price_minor;
    Candidate {
        key: key.into(),
        name: key.into(),
        configuration_id: None,
        battery: battery(capacity),
        costs,
        financing: Financing::default(),
        assumptions: "Fictitious reference model for numerical verification".into(),
    }
}

fn close(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-6, "{a} != {b}");
}

#[test]
fn energy_balance_conserves_energy_with_conversion_losses_and_capacity_limits() {
    let p = vec![
        EnergyInterval {
            duration_hours: 1.0,
            production_kwh: 6.0,
            consumption_kwh: 0.0,
            steady_consumption_kwh: None,
        },
        EnergyInterval {
            duration_hours: 1.0,
            production_kwh: 0.0,
            consumption_kwh: 10.0,
            steady_consumption_kwh: None,
        },
    ];
    let mut b = battery(5.0);
    b.ac_round_trip_efficiency_pct = 81.0;
    let result = sizing::simulate_year(&p, Some(&b), 0, 1.0, 1.0, 0.0, LoadVariation::Uniform);
    close(result.battery_to_load_kwh, 4.5);
    close(result.battery_charge_kwh, 5.0 / 0.9);
    close(
        result.production_kwh + result.grid_import_kwh + result.start_storage_kwh,
        result.consumption_kwh
            + result.standby_kwh
            + result.grid_export_kwh
            + result.conversion_and_fade_loss_kwh
            + result.end_storage_kwh,
    );
    b.charge_power_kw = 1.0;
    let limited = sizing::simulate_year(&p, Some(&b), 0, 1.0, 1.0, 0.0, LoadVariation::Uniform);
    close(limited.battery_to_load_kwh, 0.81);
}

#[test]
fn standby_and_capacity_fade_do_not_create_solar_energy_or_free_end_storage() {
    let p = vec![EnergyInterval {
        duration_hours: 1.0,
        production_kwh: 0.0,
        consumption_kwh: 1.0,
        steady_consumption_kwh: None,
    }];
    let mut b = battery(5.0);
    b.standby_w = 100.0;
    b.annual_capacity_loss_pct = 20.0;
    let r = sizing::simulate_year(&p, Some(&b), 1, 1.0, 1.0, 5.0, LoadVariation::Uniform);
    close(r.conversion_and_fade_loss_kwh, 1.0);
    close(r.grid_import_kwh, 0.1);
    close(r.end_storage_kwh, 3.0);
    close(
        r.production_kwh + r.grid_import_kwh + r.start_storage_kwh,
        r.consumption_kwh
            + r.standby_kwh
            + r.grid_export_kwh
            + r.conversion_and_fade_loss_kwh
            + r.end_storage_kwh,
    );
    let inactive = sizing::simulate_year(&p, Some(&b), 15, 1.0, 1.0, 0.0, LoadVariation::Uniform);
    close(inactive.standby_kwh, 0.0);
    close(inactive.grid_import_kwh, 1.0);
}

#[test]
fn dutch_billing_switches_from_annual_netting_to_separate_prices_and_keeps_export_fees() {
    let mut tariff = parameters().tariff;
    tariff.export_fee_eur_per_kwh = 0.05;
    close(finance::energy_bill(10.0, 8.0, &tariff, 2026, 1.0), 1.0);
    close(finance::energy_bill(10.0, 8.0, &tariff, 2027, 1.0), 2.76);
    tariff.export_fee_bands = vec![
        ExportFeeBand {
            up_to_kwh: Some(5.0),
            annual_eur: 10.0,
        },
        ExportFeeBand {
            up_to_kwh: None,
            annual_eur: 20.0,
        },
    ];
    close(finance::energy_bill(0.0, 5.0, &tariff, 2027, 1.0), 9.85);
    close(finance::energy_bill(0.0, 6.0, &tariff, 2027, 1.0), 19.82);
}

#[test]
fn independently_calculable_fixture_matches_cashflows_npv_and_roi() {
    let r = analysis::analyze(
        &profile(),
        &parameters(),
        &[candidate("battery", 2.0, 50_000)],
    )
    .unwrap();
    let c = &r.candidates[0];
    close(c.lifetime_energy_saving_eur, 8760.0 * (0.30 - 0.08));
    close(c.initial_investment_eur, 500.0);
    close(c.net_profit_eur, 1427.2);
    close(c.npv_eur, 1427.2);
    close(c.roi_pct.unwrap(), 285.44);
    close(c.first_year.self_sufficiency_pct, 100.0);
    assert_eq!(c.payback_years, Some(1));
    assert!(c.pessimistic.npv_eur < c.npv_eur && c.optimistic.npv_eur > c.npv_eur);
}

#[test]
fn choice_of_objective_and_budget_changes_recommendation_and_no_battery_remains_available() {
    let options = vec![
        candidate("small", 1.0, 10_000),
        candidate("large", 2.0, 50_000),
    ];
    let mut p = parameters();
    assert_eq!(
        analysis::analyze(&profile(), &p, &options)
            .unwrap()
            .recommended_key,
        "large"
    );
    p.objective = Objective::Roi;
    assert_eq!(
        analysis::analyze(&profile(), &p, &options)
            .unwrap()
            .recommended_key,
        "small"
    );
    p.objective = Objective::NetPresentValue;
    p.budget_eur = Some(150.0);
    assert_eq!(
        analysis::analyze(&profile(), &p, &options)
            .unwrap()
            .recommended_key,
        "small"
    );
    p.budget_eur = None;
    assert_eq!(
        analysis::analyze(&profile(), &p, &[candidate("expensive", 2.0, 99_999_999)])
            .unwrap()
            .recommended_key,
        "no_battery"
    );
    p.objective = Objective::SelfConsumption;
    let result =
        analysis::analyze(&profile(), &p, &[candidate("expensive", 2.0, 99_999_999)]).unwrap();
    assert_eq!(result.recommended_key, "expensive");
    assert!(
        result
            .warnings
            .iter()
            .any(|w| w.contains("financieel onrendabel"))
    );
}

#[test]
fn financing_counts_interest_once_and_payback_must_survive_replacement_costs() {
    let tiny_rate = Financing {
        loan_amount_eur: 100.0,
        annual_interest_pct: 1e-16,
        years: 10,
    };
    assert!(finance::annual_interest(&tiny_rate, 5).is_finite());
    close(
        finance::annual_interest(
            &Financing {
                loan_amount_eur: 100.0,
                annual_interest_pct: 5.0,
                years: 1,
            },
            1,
        ),
        5.0,
    );
    assert_eq!(
        finance::stable_payback(&[-100.0, 150.0, -200.0, 200.0], 0.0),
        Some(3)
    );
    let mut c = candidate("loan", 2.0, 50_000);
    c.financing = Financing {
        loan_amount_eur: 100.0,
        annual_interest_pct: 5.0,
        years: 1,
    };
    let r = analysis::analyze(&profile(), &parameters(), &[c]).unwrap();
    close(r.candidates[0].lifetime_extra_costs_eur, 505.0);
    close(r.candidates[0].net_profit_eur, 1422.2);
}

#[test]
fn replacement_cost_restores_capacity_only_after_the_replacement_year() {
    let mut c = candidate("replace", 2.0, 50_000);
    c.battery.operating_life_years = 1;
    let replacement = c
        .costs
        .iter_mut()
        .find(|l| l.category == "battery_replacement")
        .unwrap();
    replacement.status = CostStatus::Priced;
    replacement.timing = CostTiming::Event;
    replacement.year = Some(2);
    replacement.amount_minor = 50_000;
    let mut p = parameters();
    p.horizon_years = 3;
    let r = analysis::analyze(&profile(), &p, &[c]).unwrap();
    close(r.candidates[0].years[1].energy_saving_eur, 0.0);
    close(r.candidates[0].years[1].extra_costs_eur, 500.0);
    close(r.candidates[0].years[2].energy_saving_eur, 1927.2);
}

#[test]
fn short_profiles_unknown_costs_and_invalid_physical_assumptions_are_rejected() {
    let profile = profile();
    let c = candidate("battery", 2.0, 50_000);
    let p = parameters();
    assert!(analysis::analyze(&profile[..24], &p, std::slice::from_ref(&c)).is_err());
    let mut c = c;
    c.costs[0].status = CostStatus::Unknown;
    assert!(
        analysis::analyze(&profile, &p, std::slice::from_ref(&c))
            .unwrap_err()
            .to_string()
            .contains("onbekend")
    );
    c.costs[0].status = CostStatus::Priced;
    c.battery.ac_round_trip_efficiency_pct = 101.0;
    assert!(analysis::analyze(&profile, &p, &[c]).is_err());
}

fn hour(production_kwh: f64, consumption_kwh: f64) -> Vec<EnergyInterval> {
    vec![EnergyInterval {
        duration_hours: 1.0,
        production_kwh,
        consumption_kwh,
        steady_consumption_kwh: None,
    }]
}

#[test]
fn measured_spread_clips_peaks_above_800_w_discharge_within_an_hour() {
    // 1,1154 kW gemiddeld is precies een klasse van de uurtabel (HTW Berlin): de tien delen van
    // het uur verbruiken 0,3147 … 2,6692 × het gemiddelde. De vijf laagste delen blijven onder
    // 0,8 kW, de vijf hoogste worden afgekapt: (1,1154 × 2,5314 + 5 × 0,8) / 10 = 0,68235 kWh.
    // Gelijkmatig verdeeld zou de accu het volle uur 0,8 kW leveren.
    let mut b = battery(10.0);
    b.discharge_power_kw = 0.8;
    let p = hour(0.0, 1.1154);
    let spread = sizing::simulate_year(&p, Some(&b), 0, 1.0, 1.0, 10.0, LoadVariation::Households);
    close(spread.battery_to_load_kwh, (1.1154 * 2.5314 + 4.0) / 10.0);
    close(
        spread.grid_import_kwh,
        1.1154 - (1.1154 * 2.5314 + 4.0) / 10.0,
    );
    let uniform = sizing::simulate_year(&p, Some(&b), 0, 1.0, 1.0, 10.0, LoadVariation::Uniform);
    close(uniform.battery_to_load_kwh, 0.8);
    // Zonder vermogensgrens maakt de verdeling voor een uur zonder opwek niets uit.
    let free = sizing::simulate_year(
        &p,
        Some(&battery(10.0)),
        0,
        1.0,
        1.0,
        10.0,
        LoadVariation::Households,
    );
    close(free.battery_to_load_kwh, 1.1154);
}

#[test]
fn steady_consumption_such_as_ev_charging_is_not_spread() {
    // 3,7 kW laden plus 1,1154 kW huishouden: alle tien delen liggen boven 3,7 kW, dus een accu
    // van 2,4 kW levert het hele uur 2,4 kWh, net als zonder verdeling.
    let mut b = battery(10.0);
    b.discharge_power_kw = 2.4;
    let p = vec![EnergyInterval {
        duration_hours: 1.0,
        production_kwh: 0.0,
        consumption_kwh: 3.7 + 1.1154,
        steady_consumption_kwh: Some(3.7),
    }];
    let r = sizing::simulate_year(&p, Some(&b), 0, 1.0, 1.0, 10.0, LoadVariation::Households);
    close(r.battery_to_load_kwh, 2.4);
    // Zonder dat gelijkmatige deel zou de verdeling van een uur van 4,8 kW ook delen onder 2,4 kW geven.
    let mut all = p.clone();
    all[0].steady_consumption_kwh = None;
    let spread =
        sizing::simulate_year(&all, Some(&b), 0, 1.0, 1.0, 10.0, LoadVariation::Households);
    assert!(spread.battery_to_load_kwh < 2.4 - 0.05);
    let mut invalid = p;
    invalid[0].steady_consumption_kwh = Some(5.0);
    assert!(analysis::analyze(&invalid, &parameters(), &[candidate("a", 5.0, 100_000)]).is_err());
}

#[test]
fn measured_spread_gives_surplus_and_deficit_in_one_hour_with_equal_totals() {
    // Opwek gelijk aan het uurgemiddelde: de drie hoogste delen (1,2515; 1,7758; 2,6692 ×)
    // vragen meer dan de opwek, de rest minder. Direct gebruik = 1,1154 × (4,3035 + 3) / 10.
    let p = hour(1.1154, 1.1154);
    let none = sizing::simulate_year(&p, None, 0, 1.0, 1.0, 0.0, LoadVariation::Households);
    let direct = 1.1154 * (4.3035 + 3.0) / 10.0;
    close(none.direct_solar_kwh, direct);
    close(none.grid_export_kwh, 1.1154 - direct);
    close(none.grid_import_kwh, 1.1154 - direct);
    // Een accu laadt het overschot binnen hetzelfde uur en levert het weer terug.
    let with = sizing::simulate_year(
        &p,
        Some(&battery(5.0)),
        0,
        1.0,
        1.0,
        0.0,
        LoadVariation::Households,
    );
    close(with.battery_to_load_kwh, 1.1154 - direct);
    close(with.grid_import_kwh, 0.0);
    let uniform = sizing::simulate_year(&p, None, 0, 1.0, 1.0, 0.0, LoadVariation::Uniform);
    close(uniform.direct_solar_kwh, 1.1154);
}

#[test]
fn measured_spread_conserves_energy_and_leaves_other_periods_uniform() {
    let mut b = battery(3.0);
    b.ac_round_trip_efficiency_pct = 90.0;
    b.charge_power_kw = 1.2;
    b.discharge_power_kw = 0.8;
    b.standby_w = 5.0;
    let day: Vec<EnergyInterval> = (0..96)
        .map(|i| EnergyInterval {
            duration_hours: 0.25,
            production_kwh: if (32..64).contains(&i) { 0.2 } else { 0.0 },
            consumption_kwh: 0.05 + (i % 7) as f64 * 0.04,
            steady_consumption_kwh: None,
        })
        .collect();
    let r = sizing::simulate_year(&day, Some(&b), 0, 1.0, 1.0, 0.0, LoadVariation::Households);
    close(
        r.production_kwh + r.grid_import_kwh + r.start_storage_kwh,
        r.consumption_kwh
            + r.standby_kwh
            + r.grid_export_kwh
            + r.conversion_and_fade_loss_kwh
            + r.end_storage_kwh,
    );
    let uniform = sizing::simulate_year(&day, Some(&b), 0, 1.0, 1.0, 0.0, LoadVariation::Uniform);
    assert!(r.direct_solar_kwh < uniform.direct_solar_kwh);
    // Minuutwaarden staan niet in de tabel en blijven gelijkmatig.
    let minutes: Vec<EnergyInterval> = day
        .iter()
        .map(|i| EnergyInterval {
            duration_hours: 1.0 / 60.0,
            ..i.clone()
        })
        .collect();
    let a = sizing::simulate_year(
        &minutes,
        Some(&b),
        0,
        1.0,
        1.0,
        0.0,
        LoadVariation::Households,
    );
    let u = sizing::simulate_year(&minutes, Some(&b), 0, 1.0, 1.0, 0.0, LoadVariation::Uniform);
    close(a.grid_import_kwh, u.grid_import_kwh);
    close(a.battery_to_load_kwh, u.battery_to_load_kwh);
}

#[test]
fn capacity_curve_is_bounded_by_the_daily_surplus_and_evening_deficit() {
    // Per dag één uur met 3 kWh overschot en één uur met 2 kWh tekort: een verliesvrije accu
    // levert per dag hoogstens min(capaciteit, 2 kWh). Handmatig narekenbaar over 10 dagen.
    let days: Vec<EnergyInterval> = (0..10)
        .flat_map(|_| {
            [
                EnergyInterval {
                    duration_hours: 1.0,
                    production_kwh: 3.0,
                    consumption_kwh: 0.0,
                    steady_consumption_kwh: None,
                },
                EnergyInterval {
                    duration_hours: 1.0,
                    production_kwh: 0.0,
                    consumption_kwh: 2.0,
                    steady_consumption_kwh: None,
                },
            ]
        })
        .collect();
    let points = sizing::capacity_curve(&days, &[0.0, 1.0, 2.0, 5.0], LoadVariation::Uniform);
    let delivered: Vec<f64> = points.iter().map(|p| p.battery_to_load_kwh).collect();
    for (actual, expected) in delivered.iter().zip([0.0, 10.0, 20.0, 20.0]) {
        close(*actual, expected);
    }
    close(points[0].self_consumption_pct, 0.0);
    close(points[3].self_consumption_pct, 20.0 / 30.0 * 100.0);
    close(points[3].self_sufficiency_pct, 100.0);
}

#[test]
fn export_variant_changes_only_the_years_from_its_start_and_can_flip_the_recommendation() {
    // Referentie: 8760 kWh per jaar verschuift volledig via de accu.
    // Basis: besparing per kWh 0,30 − 0,08 = 0,22. Variant vanaf 2028: 0,30 − (0 − 0,05) = 0,35.
    let mut p = parameters();
    p.horizon_years = 2;
    p.export_variant = Some(analysis::ExportVariant {
        label: "Geen vergoeding na 2027".into(),
        from_calendar_year: 2028,
        export_eur_per_kwh: 0.0,
        export_fee_eur_per_kwh: 0.05,
    });
    let r = analysis::analyze(&profile(), &p, &[candidate("battery", 2.0, 50_000)]).unwrap();
    let c = &r.candidates[0];
    close(c.net_profit_eur, 8760.0 * 0.22 * 2.0 - 500.0);
    let v = c.export_variant.as_ref().unwrap();
    close(v.net_profit_eur, 8760.0 * 0.22 + 8760.0 * 0.35 - 500.0);
    close(v.npv_eur, v.net_profit_eur);
    close(v.roi_pct.unwrap(), v.net_profit_eur / 500.0 * 100.0);
    assert_eq!(v.payback_years, Some(1));
    assert!(
        r.warnings
            .iter()
            .any(|w| w.contains("Terugleveringsvariant"))
    );

    // € 4000: basis 3854,40 besparing (verlies), variant 4993,20 (winst).
    let r = analysis::analyze(&profile(), &p, &[candidate("battery", 2.0, 400_000)]).unwrap();
    assert_eq!(r.recommended_key, "no_battery");
    assert_eq!(r.export_variant_recommended_key.as_deref(), Some("battery"));

    p.export_variant = None;
    let r = analysis::analyze(&profile(), &p, &[candidate("battery", 2.0, 400_000)]).unwrap();
    assert!(r.export_variant_recommended_key.is_none());
    assert!(r.candidates[0].export_variant.is_none());
}

#[test]
fn export_variant_before_the_start_year_is_rejected() {
    let mut p = parameters();
    p.export_variant = Some(analysis::ExportVariant {
        label: "Te vroeg".into(),
        from_calendar_year: 2026,
        export_eur_per_kwh: 0.0,
        export_fee_eur_per_kwh: 0.0,
    });
    assert!(analysis::analyze(&profile(), &p, &[candidate("battery", 2.0, 50_000)]).is_err());
}

#[test]
fn up_to_fifty_battery_options_are_compared_at_once() {
    // De keuzehulp rekent alle passende accu's met een prijs door; de grens ligt op vijftig.
    let p = parameters();
    let options = |count: usize| -> Vec<_> {
        (0..count)
            .map(|i| candidate(&format!("battery-{i}"), 2.0, 50_000))
            .collect()
    };
    let r = analysis::analyze(&profile(), &p, &options(50)).unwrap();
    assert_eq!(r.candidates.len(), 50);
    assert!(
        analysis::analyze(&profile(), &p, &options(51))
            .unwrap_err()
            .to_string()
            .contains("1 tot 50")
    );
}

#[test]
fn entered_vat_refunds_grants_and_horizons_past_2028_get_policy_warnings() {
    let mut p = parameters();
    let plain = analysis::analyze(&profile(), &p, &[candidate("battery", 2.0, 50_000)]).unwrap();
    // Eén jaar vanaf 2027: geen nettariefwaarschuwing, geen teruggave of subsidie ingevoerd.
    assert!(!plain.warnings.iter().any(|w| w.contains("Nettarieven")));
    assert!(!plain.warnings.iter().any(|w| w.contains("Btw-teruggave")));
    let mut refunded = candidate("met-teruggave", 2.0, 50_000);
    for line in refunded.costs.iter_mut() {
        if ["vat_refund", "grant"].contains(&line.category.as_str()) {
            line.status = CostStatus::Priced;
            line.amount_minor = 10_000;
        }
    }
    p.horizon_years = 3;
    let r = analysis::analyze(&profile(), &p, &[refunded]).unwrap();
    assert!(
        r.warnings
            .iter()
            .any(|w| w.contains("Nettarieven") && w.contains("2029"))
    );
    assert!(
        r.warnings
            .iter()
            .any(|w| w.contains("Btw-teruggave ingevoerd bij met-teruggave")
                && w.contains("privégebruik"))
    );
    assert!(
        r.warnings
            .iter()
            .any(|w| w.contains("Subsidie ingevoerd bij met-teruggave"))
    );
}
