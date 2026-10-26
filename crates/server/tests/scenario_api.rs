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

/// Synthetisch volledig jaar; `is_demo` bootst een demoprofiel uit een oudere database na.
async fn legacy_demo_year(catalog: &Catalog) -> i64 {
    let intervals: Vec<_> = (0..8760)
        .map(|hour| SolarInterval {
            start_unix_s: 1_735_689_600 + hour * 3600,
            end_unix_s: 1_735_689_600 + (hour + 1) * 3600,
            production_wh: if (10..16).contains(&(hour % 24)) {
                1500.0
            } else {
                0.0
            },
            consumption_wh: Some(if (18..23).contains(&(hour % 24)) {
                900.0
            } else {
                250.0
            }),
            steady_consumption_wh: None,
            measured_import_wh: None,
            measured_export_wh: None,
        })
        .collect();
    catalog
        .save_solar(
            "FICTIEF DEMOJAAR 2025",
            &format!("{:064x}", 7),
            r#"{"is_demo":true,"timezone":"UTC","data_kind":"synthetic","generator":"demo-v1"}"#,
            "{}",
            &intervals,
            1,
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn legacy_demo_year_stays_fictitious_and_analysis_is_saved_with_input_and_model_version() {
    let catalog = Catalog::in_memory().await.unwrap();
    let app = thuisaccu_server::app(catalog.clone());
    let id = legacy_demo_year(&catalog).await;
    let response = app
        .clone()
        .oneshot(post("/api/v1/analysis/runs", input(id)))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let result = body(response).await;
    assert_eq!(result["result"]["model_version"], "nl-self-consumption-v5");
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
async fn export_variant_is_optional_saved_with_the_run_and_strictly_validated() {
    let catalog = Catalog::in_memory().await.unwrap();
    let app = thuisaccu_server::app(catalog.clone());
    let id = legacy_demo_year(&catalog).await;
    // Zonder variant (zoals oudere runs) bevat het resultaat geen variantvelden.
    let plain = body(
        app.clone()
            .oneshot(post("/api/v1/analysis/runs", input(id)))
            .await
            .unwrap(),
    )
    .await;
    assert!(
        plain["result"]
            .get("export_variant_recommended_key")
            .is_none()
    );
    assert!(
        plain["result"]["candidates"][0]
            .get("export_variant")
            .is_none()
    );

    let mut request = input(id);
    request["parameters"]["export_variant"] = json!({"label":"Geen vergoeding vanaf 2030","from_calendar_year":2030,"export_eur_per_kwh":0,"export_fee_eur_per_kwh":0.05});
    let response = app
        .clone()
        .oneshot(post("/api/v1/analysis/runs", request.clone()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let varied = body(response).await;
    let base = varied["result"]["candidates"][0]["npv_eur"]
        .as_f64()
        .unwrap();
    let low = varied["result"]["candidates"][0]["export_variant"]["npv_eur"]
        .as_f64()
        .unwrap();
    // Minder vergoeding en meer kosten per teruggeleverde kWh maken opslaan waardevoller.
    assert!(low > base);
    assert!(varied["result"]["export_variant_recommended_key"].is_string());
    let saved = catalog.list_analyses().await.unwrap();
    assert_eq!(
        saved[0].input["request"]["parameters"]["export_variant"]["from_calendar_year"],
        2030
    );

    request["parameters"]["export_variant"]["surprise"] = json!(1);
    assert_eq!(
        app.oneshot(post("/api/v1/analysis/runs", request))
            .await
            .unwrap()
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
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
    // Iedere indicatie heeft een positief bedrag en een controleerbare HTTPS-bron.
    let estimates = &data["estimates"];
    assert_eq!(estimates["researched_on"], "2026-10-24");
    let amounts = estimates["amounts"].as_object().unwrap();
    let meters = estimates["meters"].as_array().unwrap();
    assert!(!amounts.is_empty() && !meters.is_empty());
    for value in amounts.values().chain(meters.iter()) {
        let amount = value["amount_eur"]
            .as_f64()
            .or(value["amount_pct"].as_f64())
            .unwrap();
        assert!(amount > 0.0, "{value}");
        assert!(value["url"].as_str().unwrap().starts_with("https://"));
        assert!(!value["label"].as_str().unwrap().is_empty());
    }
    for fact in estimates["facts"].as_object().unwrap().values() {
        for item in fact
            .as_array()
            .cloned()
            .unwrap_or_else(|| vec![fact.clone()])
        {
            assert!(item["url"].as_str().unwrap().starts_with("https://"));
        }
    }
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
        steady_consumption_wh: None,
        measured_import_wh: None,
        measured_export_wh: None,
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

#[tokio::test]
async fn capacity_curve_uses_measured_simultaneity_instead_of_the_estimated_spread() {
    // Synthetisch jaar met ieder uur 0,5 kWh opwek en 0,5 kWh verbruik. Volgens de geschatte
    // verdeling is er binnen het uur overschot en tekort; volgens de meter (0 afname,
    // 0 teruglevering) viel alles samen en heeft een accu niets te verschuiven.
    let catalog = Catalog::in_memory().await.unwrap();
    let app = thuisaccu_server::app(catalog.clone());
    let year = |measured: Option<f64>| -> Vec<SolarInterval> {
        (0..8760)
            .map(|hour| SolarInterval {
                start_unix_s: 1_735_689_600 + hour * 3600,
                end_unix_s: 1_735_689_600 + (hour + 1) * 3600,
                production_wh: 500.0,
                consumption_wh: Some(500.0),
                steady_consumption_wh: None,
                measured_import_wh: measured,
                measured_export_wh: measured,
            })
            .collect()
    };
    let mut delivered = vec![];
    for (n, measured) in [None, Some(0.0)].into_iter().enumerate() {
        let id = catalog
            .save_solar(
                "Synthetic",
                &format!("{n:064x}"),
                "{}",
                "{}",
                &year(measured),
                1,
            )
            .await
            .unwrap();
        let response = app
            .clone()
            .oneshot(
                Request::get(format!("/api/v1/solar/imports/{id}/capacity"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let curve = body(response).await;
        assert_eq!(curve["periods"], 8760);
        assert_eq!(
            curve["measured_periods"],
            if measured.is_some() { 8760 } else { 0 }
        );
        delivered.push(curve["points"][4]["battery_to_load_kwh"].as_f64().unwrap());
    }
    assert!(delivered[0] > 100.0, "{delivered:?}");
    assert!(delivered[1].abs() < 1e-6, "{delivered:?}");
}

#[tokio::test]
async fn deleting_a_run_keeps_the_profile_and_deleting_a_profile_removes_its_runs() {
    let catalog = Catalog::in_memory().await.unwrap();
    let app = thuisaccu_server::app(catalog.clone());
    let id = legacy_demo_year(&catalog).await;
    let mut runs = vec![];
    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(post("/api/v1/analysis/runs", input(id)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        runs.push(body(response).await["id"].as_i64().unwrap());
    }
    let delete = |path: String| {
        let app = app.clone();
        async move {
            let response = app
                .oneshot(Request::delete(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            (response.status(), body(response).await)
        }
    };
    let list = || async {
        let response = app
            .clone()
            .oneshot(
                Request::get("/api/v1/solar/imports")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        body(response).await["imports"].clone()
    };
    assert_eq!(list().await[0]["analysis_runs"], 2);
    let (status, _) = delete(format!("/api/v1/analysis/runs/{}", runs[0])).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(catalog.list_analyses().await.unwrap().len(), 1);
    assert_eq!(list().await[0]["analysis_runs"], 1);
    let (status, error) = delete(format!("/api/v1/analysis/runs/{}", runs[0])).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error["error"], "not_found");
    let (status, deleted) = delete(format!("/api/v1/solar/imports/{id}")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(deleted["deleted_analysis_runs"], 1);
    assert!(catalog.list_analyses().await.unwrap().is_empty());
    assert!(catalog.solar_intervals(id).await.unwrap().is_empty());
    assert_eq!(list().await, json!([]));
    let (status, _) = delete(format!("/api/v1/solar/imports/{id}")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn heat_pump_and_ev_from_a_later_year_are_added_only_from_that_year() {
    let catalog = Catalog::in_memory().await.unwrap();
    let app = thuisaccu_server::app(catalog.clone());
    let id = legacy_demo_year(&catalog).await;
    let mut request = input(id);
    request["load_changes"] = json!([
        {"kind": "heat_pump", "from_calendar_year": 2028, "annual_kwh": 2500},
        {"kind": "ev", "from_calendar_year": 2030, "annual_kwh": 2000, "charging": "evening"}
    ]);
    let response = app
        .clone()
        .oneshot(post("/api/v1/analysis/runs", request))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let result = body(response).await;
    let years = result["result"]["candidates"][0]["years"]
        .as_array()
        .unwrap();
    let consumption = |i: usize| years[i]["energy"]["consumption_kwh"].as_f64().unwrap();
    // Synthetisch jaar: 5 uur × 0,9 kWh + 19 uur × 0,25 kWh = 9,25 kWh per dag.
    let base = 9.25 * 365.0;
    for (year, expected) in [
        (0, base),
        (1, base + 2500.0),
        (2, base + 2500.0),
        (3, base + 4500.0),
    ] {
        assert!(
            (consumption(year) - expected).abs() < 1e-6,
            "{year}: {}",
            consumption(year)
        );
    }
    let warnings = result["result"]["warnings"].to_string();
    assert!(warnings.contains(
        "Extra verbruik ‘Warmtepomp’: vanaf 1 januari 2028 komt er 2.500 kWh per jaar bij"
    ));
    assert!(warnings.contains("Elektrische auto, ’s avonds laden"));
    let saved = catalog.list_analyses().await.unwrap();
    assert_eq!(
        saved[0].input["request"]["load_changes"][0]["kind"],
        "heat_pump"
    );
    // Onbekende soort, beginjaar vóór de start of een auto zonder laadmoment: geen run.
    for change in [
        json!({"kind": "sauna", "from_calendar_year": 2028, "annual_kwh": 2500}),
        json!({"kind": "heat_pump", "from_calendar_year": 2026, "annual_kwh": 2500}),
        json!({"kind": "ev", "from_calendar_year": 2028, "annual_kwh": 2000}),
    ] {
        let mut wrong = input(id);
        wrong["load_changes"] = json!([change]);
        let response = app
            .clone()
            .oneshot(post("/api/v1/analysis/runs", wrong))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
    assert_eq!(catalog.list_analyses().await.unwrap().len(), 1);
}

#[tokio::test]
async fn quote_basis_is_saved_as_provenance_and_strictly_validated() {
    let catalog = Catalog::in_memory().await.unwrap();
    let app = thuisaccu_server::app(catalog.clone());
    let id = legacy_demo_year(&catalog).await;
    let plain = body(
        app.clone()
            .oneshot(post("/api/v1/analysis/runs", input(id)))
            .await
            .unwrap(),
    )
    .await;
    // De offerte noemt 4,5 kWh bruikbaar in plaats van 5; de herkomst rekent zelf niet mee.
    let mut request = input(id);
    request["candidates"][0]["battery"]["usable_capacity_kwh"] = json!(4.5);
    request["quote_basis"] = json!({"run_id": 1, "title": "Test projection", "candidate_key": "test",
        "break_even_investment_eur": 1234.5,
        "changes": [{"field": "usable_capacity_kwh", "before": 5, "after": 4.5}]});
    let response = app
        .clone()
        .oneshot(post("/api/v1/analysis/runs", request.clone()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let quoted = body(response).await;
    assert!(
        quoted["result"]["candidates"][0]["npv_eur"]
            .as_f64()
            .unwrap()
            < plain["result"]["candidates"][0]["npv_eur"]
                .as_f64()
                .unwrap()
    );
    let saved = catalog.list_analyses().await.unwrap();
    let newest = saved
        .iter()
        .find(|r| r.input["request"].get("quote_basis").is_some())
        .unwrap();
    assert_eq!(
        newest.input["request"]["quote_basis"]["changes"][0]["after"],
        4.5
    );
    assert!(
        saved
            .iter()
            .any(|r| r.input["request"].get("quote_basis").is_none())
    );

    for (path, value) in [
        ("candidate_key", json!("elders")),
        ("changes", json!([])),
        (
            "changes",
            json!([{"field": "price", "before": 1, "after": 2}]),
        ),
        ("title", json!(" ")),
    ] {
        let mut wrong = request.clone();
        wrong["quote_basis"][path] = value;
        let response = app
            .clone()
            .oneshot(post("/api/v1/analysis/runs", wrong))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{path}");
    }
    assert_eq!(catalog.list_analyses().await.unwrap().len(), 2);

    // Ook de totaalprijs en het abonnement uit de offerte zijn herkomst.
    let mut priced = request.clone();
    priced["quote_basis"]["changes"] = json!([
        {"field": "upfront_eur", "before": 4000, "after": 3500},
        {"field": "subscription_eur", "before": 0, "after": 60}
    ]);
    priced["quote_basis"]["price"] =
        json!({"total_eur": 3365, "terms": "subject_to_survey", "separate": ["installation"]});
    let response = app
        .clone()
        .oneshot(post("/api/v1/analysis/runs", priced.clone()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    // Een prijs hoort bij een gewijzigde totaalprijs en noemt alleen bestaande kostenposten.
    // Een onbekende soort prijs is al geen geldige JSON voor het verzoek (422).
    for (path, value, status) in [
        ("terms", json!("vast"), StatusCode::UNPROCESSABLE_ENTITY),
        ("separate", json!(["meterkast"]), StatusCode::BAD_REQUEST),
    ] {
        let mut wrong = priced.clone();
        wrong["quote_basis"]["price"][path] = value;
        let response = app
            .clone()
            .oneshot(post("/api/v1/analysis/runs", wrong))
            .await
            .unwrap();
        assert_eq!(response.status(), status, "{path}");
    }
    let mut unpriced = priced.clone();
    unpriced["quote_basis"]["changes"] =
        json!([{"field": "subscription_eur", "before": 0, "after": 60}]);
    let response = app
        .oneshot(post("/api/v1/analysis/runs", unpriced))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn an_old_run_is_recalculated_with_the_same_input_and_links_back_to_the_original() {
    let catalog = Catalog::in_memory().await.unwrap();
    let app = thuisaccu_server::app(catalog.clone());
    let id = legacy_demo_year(&catalog).await;
    let response = app
        .clone()
        .oneshot(post("/api/v1/analysis/runs", input(id)))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let current = body(response).await["id"].as_i64().unwrap();
    let saved = catalog.analysis(current).await.unwrap().unwrap();
    // Een run van een ouder rekenmodel nabootsen, met een andere grensprijs als herkenningsteken.
    let store = |input: Value, sha: &str| {
        let catalog = catalog.clone();
        let mut result = saved.result.clone();
        result["model_version"] = json!("nl-self-consumption-v4");
        result["candidates"][0]["break_even_investment_eur"] = json!(1234.0);
        let sha = sha.to_owned();
        async move {
            catalog
                .save_analysis(&thuisaccu_storage::analysis::NewAnalysis {
                    import_id: id,
                    title: "Oude berekening",
                    model_version: "nl-self-consumption-v4",
                    profile_sha256: &sha,
                    input_json: &input.to_string(),
                    result_json: &result.to_string(),
                    now: 0,
                })
                .await
                .unwrap()
        }
    };
    let sha = saved.input["profile_sha256"].as_str().unwrap();
    let old = store(saved.input.clone(), sha).await;
    let recalculate = |id: i64| {
        let app = app.clone();
        async move {
            let response = app
                .oneshot(post(
                    &format!("/api/v1/analysis/runs/{id}/recalculate"),
                    json!(null),
                ))
                .await
                .unwrap();
            (response.status(), body(response).await)
        }
    };
    let (status, created) = recalculate(old).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let new = catalog
        .analysis(created["id"].as_i64().unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(new.title, "Test projection · huidig model");
    assert_eq!(
        new.result["model_version"],
        thuisaccu_core::analysis::MODEL_VERSION
    );
    let mut same = new.input["request"].clone();
    same["title"] = saved.input["request"]["title"].clone();
    assert_eq!(same, saved.input["request"], "invoer ongewijzigd");
    let origin = &new.input["recalculated_from"];
    assert_eq!(origin["run_id"], old);
    assert_eq!(origin["title"], "Oude berekening");
    assert_eq!(origin["model_version"], "nl-self-consumption-v4");
    assert_eq!(origin["break_even_investment_eur"]["test"], 1234.0);
    assert!(
        catalog.analysis(old).await.unwrap().is_some(),
        "de oude blijft"
    );
    // Nog eens herrekenen stapelt de toevoeging in de titel niet.
    let (_, again) = recalculate(new.id).await;
    let again = catalog
        .analysis(again["id"].as_i64().unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(again.title, "Test projection · huidig model");

    // Een veranderd profiel of een invoer die niet meer past: een melding, geen stille aanvulling.
    let mut tampered = saved.input.clone();
    tampered["profile_sha256"] = json!(format!("{:064x}", 1));
    let changed_input = store(tampered, sha).await;
    let (status, error) = recalculate(changed_input).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        error["message"].as_str().unwrap().contains("veranderd"),
        "{error}"
    );
    let mut broken = saved.input.clone();
    broken["request"]["parameters"]["objective"] = json!("winst");
    let broken = store(broken, sha).await;
    let (status, error) = recalculate(broken).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        error["message"]
            .as_str()
            .unwrap()
            .contains("past niet meer"),
        "{error}"
    );
    let (status, _) = recalculate(broken + 100).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn titles_count_characters_not_bytes_and_the_research_date_comes_from_the_cost_catalog() {
    let catalog = Catalog::in_memory().await.unwrap();
    let app = thuisaccu_server::app(catalog.clone());
    let id = legacy_demo_year(&catalog).await;
    let mut request = input(id);
    // 200 tekens van twee bytes: past, net als in de interface.
    request["title"] = json!("é".repeat(200));
    let response = app
        .clone()
        .oneshot(post("/api/v1/analysis/runs", request.clone()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let saved = catalog.list_analyses().await.unwrap();
    let catalog_json: Value =
        serde_json::from_str(include_str!("../resources/cost-catalog.json")).unwrap();
    assert_eq!(
        saved[0].input["cost_sources_researched_on"],
        catalog_json["researched_on"]
    );
    request["title"] = json!("é".repeat(201));
    let response = app
        .oneshot(post("/api/v1/analysis/runs", request))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
