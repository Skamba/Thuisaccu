use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use thuisaccu_core::finance::COST_CATEGORIES;
use thuisaccu_storage::Catalog;
use tower::ServiceExt;

fn post(path: &str, value: Value) -> Request<Body> {
    Request::post(path)
        .header("content-type", "application/json")
        .body(Body::from(value.to_string()))
        .unwrap()
}

async fn send(app: &axum::Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), 4_000_000).await.unwrap();
    (status, serde_json::from_slice(&body).unwrap())
}

#[tokio::test]
async fn annual_totals_become_a_full_labelled_hourly_year_with_exact_totals() {
    let app = thuisaccu_server::app(Catalog::in_memory().await.unwrap());
    let input = json!({"annual_consumption_kwh": 3500, "solar": {"orientation": "east_west", "annual_production_kwh": 3000, "peak_power_kwp": null}});
    let (status, first) = send(&app, post("/api/v1/solar/typical", input.clone())).await;
    assert_eq!(status, StatusCode::CREATED);
    let summary = &first["summary"];
    assert_eq!(summary["rows"], 8760);
    assert_eq!(summary["gaps"], 0);
    assert!((summary["consumption_kwh"].as_f64().unwrap() - 3500.0).abs() < 1e-6);
    assert!((summary["production_kwh"].as_f64().unwrap() - 3000.0).abs() < 1e-6);
    assert!(
        summary["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w.as_str().unwrap().starts_with("GESCHAT PROFIEL"))
    );
    assert_eq!(first["existing"], false);
    let (status, again) = send(&app, post("/api/v1/solar/typical", input)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(again["id"], first["id"]);
    assert_eq!(again["existing"], true);
    assert_eq!(again["filename"], first["filename"]);

    let (_, imports) = send(
        &app,
        Request::get("/api/v1/solar/imports")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    let options = &imports["imports"][0]["options"];
    assert_eq!(options["data_kind"], "modelled");
    assert_eq!(options["period"], "hour");
    assert!(
        options["sources"]["load"]["url"]
            .as_str()
            .unwrap()
            .starts_with("https://")
    );
}

#[tokio::test]
async fn peak_power_uses_the_embedded_yield_and_invalid_totals_are_rejected() {
    let app = thuisaccu_server::app(Catalog::in_memory().await.unwrap());
    let (_, sources) = send(
        &app,
        Request::get("/api/v1/solar/typical")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    let per_kwp = sources["pv"]["annual_kwh_per_kwp"]["south"]
        .as_f64()
        .unwrap();
    assert!((700.0..1200.0).contains(&per_kwp));
    let (status, body) = send(
        &app,
        post(
            "/api/v1/solar/typical",
            json!({"annual_consumption_kwh": 4000, "solar": {"orientation": "south", "annual_production_kwh": null, "peak_power_kwp": 4}}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!((body["summary"]["production_kwh"].as_f64().unwrap() - 4.0 * per_kwp).abs() < 1e-6);
    for invalid in [
        json!({"annual_consumption_kwh": 50, "solar": null}),
        json!({"annual_consumption_kwh": 3000, "solar": {"orientation": "north", "annual_production_kwh": 3000, "peak_power_kwp": null}}),
        json!({"annual_consumption_kwh": 3000, "solar": {"orientation": "south", "annual_production_kwh": 3000, "peak_power_kwp": 3}}),
        json!({"annual_consumption_kwh": 3000, "solar": {"orientation": "south", "annual_production_kwh": null, "peak_power_kwp": null}}),
    ] {
        let (status, _) = send(&app, post("/api/v1/solar/typical", invalid)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    let (status, body) = send(
        &app,
        post(
            "/api/v1/solar/typical",
            json!({"annual_consumption_kwh": 3000, "solar": null}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["summary"]["production_kwh"], 0.0);
}

#[tokio::test]
async fn capacity_curve_and_analysis_mark_the_estimate() {
    let app = thuisaccu_server::app(Catalog::in_memory().await.unwrap());
    let (_, created) = send(
        &app,
        post(
            "/api/v1/solar/typical",
            json!({"annual_consumption_kwh": 3500, "solar": {"orientation": "south", "annual_production_kwh": 4000, "peak_power_kwp": null}}),
        ),
    )
    .await;
    let id = created["id"].as_i64().unwrap();
    let (_, imports) = send(
        &app,
        Request::get("/api/v1/solar/imports")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    // Getallen in de naam zoals in de interface: een punt per duizendtal.
    let name = imports["imports"][0]["filename"].as_str().unwrap();
    assert!(
        name.starts_with("Geschat profiel · 3.500 kWh verbruik · 4.000 kWh opwek"),
        "{name}"
    );
    let (status, curve) = send(
        &app,
        Request::get(format!("/api/v1/solar/imports/{id}/capacity"))
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let delivered: Vec<f64> = curve["points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["battery_to_load_kwh"].as_f64().unwrap())
        .collect();
    assert_eq!(delivered[0], 0.0);
    assert!(delivered.windows(2).all(|w| w[1] >= w[0] - 1e-9));
    assert!(*delivered.last().unwrap() <= 4000.0);

    let costs: Vec<_> = COST_CATEGORIES.iter().map(|key| json!({"category":key,"status":if *key=="battery" {"priced"} else {"not_applicable"},"amount_minor":if *key=="battery" {150_000} else {0},"timing":"upfront","year":null,"source":"Synthetic test assumption","notes":""})).collect();
    let run = json!({"title":"Estimate","solar_import_id":id,"site":{"address":"Nederland (test)","latitude":null,"longitude":null,"bag_id":null},
        "parameters":{"start_year":2027,"horizon_years":10,"discount_pct":4,"annual_cost_escalation_pct":2,"annual_pv_loss_pct":0,"annual_load_growth_pct":0,"objective":"net_present_value","budget_eur":null,"price_uncertainty_pct":20,"cost_uncertainty_pct":15,
            "tariff":{"import_eur_per_kwh":0.26,"export_eur_per_kwh":0.07,"export_fee_eur_per_kwh":0,"export_fee_bands":[],"fixed_annual_eur":0,"annual_price_change_pct":0}},
        "candidates":[{"key":"plug","name":"Synthetic plug-in","configuration_id":null,"battery":{"usable_capacity_kwh":2.4,"charge_power_kw":0.8,"discharge_power_kw":0.8,"ac_round_trip_efficiency_pct":85,"standby_w":5,"annual_capacity_loss_pct":2,"operating_life_years":15},"costs":costs,"financing":{"loan_amount_eur":0,"annual_interest_pct":0,"years":0},"assumptions":"Synthetic"}],
        "costs_confirmed":true,"technical_assumptions_confirmed":true,"consumption_is_gross":true,"production_is_ac":true});
    let (status, body) = send(&app, post("/api/v1/analysis/runs", run.clone())).await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(
        body["result"]["warnings"][0]
            .as_str()
            .unwrap()
            .starts_with("GESCHAT PROFIEL")
    );
    // Zonder `load_variation` (runs van vóór modelversie 2) blijft het verbruik gelijkmatig.
    let warnings = |body: &Value| body["result"]["warnings"].to_string();
    assert!(warnings(&body).contains("gelijkmatig verondersteld"));
    let mut spread = run;
    spread["parameters"]["load_variation"] = json!("households");
    let (status, varied) = send(&app, post("/api/v1/analysis/runs", spread)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(warnings(&varied).contains("HTW Berlin"));
    let delivered = |body: &Value| {
        body["result"]["candidates"][0]["first_year"]["battery_to_load_kwh"]
            .as_f64()
            .unwrap()
    };
    assert!((delivered(&varied) - delivered(&body)).abs() > 1.0);
}

#[test]
fn heat_pump_and_ev_reshape_the_year_but_keep_the_annual_total() {
    use thuisaccu_server::typical_profile::{TypicalRequest, build};
    let request = |extra: Value| -> TypicalRequest {
        let mut base = json!({"annual_consumption_kwh": 6000, "solar": null});
        base.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        serde_json::from_value(base).unwrap()
    };
    let month = |profile: &thuisaccu_server::typical_profile::TypicalProfile, label: &str| {
        profile
            .summary
            .months
            .iter()
            .find(|m| m.label == label)
            .unwrap()
            .consumption_kwh
            .unwrap()
    };
    let plain = build(&request(json!({}))).unwrap();
    let heated = build(&request(json!({"heat_pump_kwh": 3000}))).unwrap();
    // Zelfde jaartotaal; de warmtepomp verschuift verbruik naar de winter.
    assert!((heated.summary.consumption_kwh.unwrap() - 6000.0).abs() < 1e-6);
    let total: f64 = heated
        .intervals
        .iter()
        .map(|i| i.consumption_wh.unwrap())
        .sum();
    assert!((total / 1000.0 - 6000.0).abs() < 1e-6);
    assert!(month(&heated, "2026-01") > month(&plain, "2026-01"));
    assert!(month(&heated, "2026-07") < month(&plain, "2026-07"));

    let charged = build(&request(
        json!({"ev": {"annual_kwh": 2000, "charging": "evening"}}),
    ))
    .unwrap();
    let total: f64 = charged
        .intervals
        .iter()
        .map(|i| i.consumption_wh.unwrap())
        .sum();
    assert!((total / 1000.0 - 6000.0).abs() < 1e-6);
    // 2000 kWh / 365 dagen = 5,48 kWh per dag: 3,68 kWh om 18.00 uur en de rest om 19.00 uur lokale tijd.
    let june_first_18h = 1_780_329_600; // 2026-06-01T16:00:00Z = 18.00 uur zomertijd
    let at = |p: &thuisaccu_server::typical_profile::TypicalProfile, t: i64| {
        p.intervals
            .iter()
            .find(|i| i.start_unix_s == t)
            .unwrap()
            .consumption_wh
            .unwrap()
    };
    let added = at(&charged, june_first_18h) - at(&plain, june_first_18h) * (4000.0 / 6000.0);
    assert!((added - 3680.0).abs() < 1.0, "{added}");
    // Het laden is het gelijkmatige deel van dat uur; zonder auto of warmtepomp is er geen.
    let steady = charged
        .intervals
        .iter()
        .find(|i| i.start_unix_s == june_first_18h)
        .unwrap()
        .steady_consumption_wh
        .unwrap();
    assert!((steady - 3680.0).abs() < 1.0, "{steady}");
    assert!(
        plain
            .intervals
            .iter()
            .all(|i| i.steady_consumption_wh.is_none())
    );
    assert!(
        charged
            .summary
            .warnings
            .iter()
            .any(|w| w.contains("Elektrische auto") && w.contains("geladen met 3,68 kW"))
    );

    for invalid in [
        json!({"heat_pump_kwh": 6000}),
        json!({"heat_pump_kwh": -1}),
        json!({"ev": {"annual_kwh": 1000, "charging": "sometimes"}}),
    ] {
        assert!(build(&request(invalid)).is_err());
    }
}
