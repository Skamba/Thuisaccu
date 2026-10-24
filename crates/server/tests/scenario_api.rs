use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use thuisaccu_core::finance::COST_CATEGORIES;
use thuisaccu_storage::{Catalog, solar::SolarInterval};
use tower::ServiceExt;

fn post(path: &str, value: Value) -> Request<Body> {
    Request::post(path)
        .header("content-type", "application/json")
        .body(Body::from(value.to_string()))
        .unwrap()
}
async fn body(response: axum::response::Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), 2_000_000).await.unwrap()).unwrap()
}
fn input(id: i64) -> Value {
    let costs:Vec<_>=COST_CATEGORIES.iter().map(|key|json!({"category":key,"status":if *key=="battery" {"priced"}else{"not_applicable"},"amount_minor":if *key=="battery" {500_000}else{0},"timing":"upfront","year":null,"source":"Fictitious test assumption","notes":""})).collect();
    json!({"title":"Test projection","solar_import_id":id,"site":{"address":"Fictitious test site, NL","latitude":null,"longitude":null,"bag_id":null},
        "parameters":{"start_year":2027,"horizon_years":15,"discount_pct":4,"annual_cost_escalation_pct":2,"annual_pv_loss_pct":0,"annual_load_growth_pct":0,"objective":"net_present_value","budget_eur":null,
        "price_uncertainty_pct":20,"cost_uncertainty_pct":15,"tariff":{"import_eur_per_kwh":0.3,"export_eur_per_kwh":0.08,"export_fee_eur_per_kwh":0,"export_fee_bands":[],"fixed_annual_eur":0,"annual_price_change_pct":0}},
        "candidates":[{"key":"test","name":"Fictitious battery","configuration_id":null,"battery":{"usable_capacity_kwh":5,"charge_power_kw":2.5,"discharge_power_kw":2.5,"ac_round_trip_efficiency_pct":90,"standby_w":3,"annual_capacity_loss_pct":2,"operating_life_years":15},"costs":costs,"financing":{"loan_amount_eur":0,"annual_interest_pct":0,"years":0},"assumptions":"Explicitly fictitious software reference"}],
        "costs_confirmed":true,"technical_assumptions_confirmed":true,"consumption_is_gross":true,"production_is_ac":true})
}

#[tokio::test]
async fn full_demo_year_is_explicitly_fictitious_and_analysis_is_saved_with_input_and_model_version()
 {
    let catalog = Catalog::in_memory().await.unwrap();
    let app = thuisaccu_server::app(catalog.clone());
    let response = app
        .clone()
        .oneshot(post("/api/v1/analysis/demo", json!({})))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let id = body(response).await["id"].as_i64().unwrap();
    let response = app
        .clone()
        .oneshot(post("/api/v1/analysis/runs", input(id)))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let result = body(response).await;
    assert_eq!(result["result"]["model_version"], "nl-self-consumption-v1");
    assert!(
        result["result"]["warnings"][0]
            .as_str()
            .unwrap()
            .contains("FICTIEF")
    );
    assert_eq!(
        result["result"]["candidates"][0]["years"]
            .as_array()
            .unwrap()
            .len(),
        15
    );
    let saved = catalog.list_analyses().await.unwrap();
    assert_eq!(saved.len(), 1);
    assert_eq!(
        saved[0].input["request"]["site"]["address"],
        "Fictitious test site, NL"
    );
    assert_eq!(saved[0].input["profile_sha256"].as_str().unwrap().len(), 64);
    let mut invalid = input(id);
    invalid["consumption_is_gross"] = json!(false);
    assert_eq!(
        app.oneshot(post("/api/v1/analysis/runs", invalid))
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(catalog.list_analyses().await.unwrap().len(), 1);
}

#[tokio::test]
async fn cost_catalog_covers_every_cost_category() {
    let app = thuisaccu_server::app(Catalog::in_memory().await.unwrap());
    let response = app
        .oneshot(
            Request::get("/api/v1/analysis/costs")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let data = body(response).await;
    let mut keys: Vec<_> = data["categories"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["key"].as_str().unwrap())
        .collect();
    keys.sort_unstable();
    let mut expected = COST_CATEGORIES.to_vec();
    expected.sort_unstable();
    assert_eq!(keys, expected);
}

#[tokio::test]
async fn incomplete_coarse_or_production_only_imports_cannot_produce_saved_roi() {
    let catalog = Catalog::in_memory().await.unwrap();
    let app = thuisaccu_server::app(catalog.clone());
    let interval = |start, end, consumption| SolarInterval {
        start_unix_s: start,
        end_unix_s: end,
        production_wh: 500.0,
        consumption_wh: consumption,
    };
    let cases = [
        (
            vec![
                interval(0, 3600, Some(800.0)),
                interval(7200, 10800, Some(800.0)),
            ],
            "gaten",
        ),
        (vec![interval(0, 3600, None)], "bruto verbruik"),
        (vec![interval(0, 86400, Some(800.0))], "uur-"),
        (vec![interval(0, 3600, Some(800.0))], "volledig jaar"),
    ];
    for (index, (intervals, expected)) in cases.into_iter().enumerate() {
        let id = catalog
            .save_solar(
                "Invalid ROI fixture",
                &format!("{index:064x}"),
                "{}",
                "{}",
                &intervals,
                1,
            )
            .await
            .unwrap();
        let response = app
            .clone()
            .oneshot(post("/api/v1/analysis/runs", input(id)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let error = body(response).await;
        assert!(
            error["message"].as_str().unwrap().contains(expected),
            "{error}"
        );
    }
    assert!(catalog.list_analyses().await.unwrap().is_empty());
}

#[test]
fn pdok_geometry_is_read_as_longitude_latitude_and_malformed_results_are_ignored() {
    let data = json!({"response":{"docs":[{"weergavenaam":"Public test address","centroide_ll":"POINT(4.3 52.1)","nummeraanduiding_id":"test"},{"weergavenaam":"Bad","centroide_ll":"POINT(0 0)"}]}});
    let sites = thuisaccu_server::scenario_api::parse_addresses(&data);
    assert_eq!(sites.len(), 1);
    assert_eq!(sites[0].latitude, Some(52.1));
    assert_eq!(sites[0].longitude, Some(4.3));
}
