use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use thuisaccu_storage::Catalog;
use tower::ServiceExt;

async fn response_json(response: axum::response::Response) -> Value {
    serde_json::from_slice(
        &to_bytes(response.into_body(), 4 * 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap()
}

#[tokio::test]
async fn researched_references_are_optional_idempotent_and_keep_important_unknowns() {
    let catalog = Catalog::in_memory().await.unwrap();
    let app = thuisaccu_server::app(catalog.clone());
    assert!(
        catalog
            .comparison()
            .await
            .unwrap()
            .configurations
            .is_empty()
    );
    let status = |app: axum::Router| async move {
        let response = app
            .oneshot(
                Request::get("/api/v1/references")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        response_json(response).await
    };
    // De status laadt zelf niets; ze zegt alleen hoeveel sets er nog niet in staan.
    assert_eq!(status(app.clone()).await, json!({"sets": 9, "pending": 9}));
    assert_eq!(status(app.clone()).await["pending"], 9);
    for expected in [true, false] {
        let response = app
            .clone()
            .oneshot(
                Request::post("/api/v1/references")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response_json(response).await["imported"], expected);
    }
    assert_eq!(status(app.clone()).await["pending"], 0);
    let response = app
        .oneshot(
            Request::get("/api/v1/comparison")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let data = response_json(response).await;
    // Drie internationale momentopnamen, vijf Nederlandse uitvoeringen, vier uit de tweede,
    // twintig uit de derde en zeventig uit de vierde set (catalogus Jay's Desk). De Powerwall-
    // datasheet, de test van de Zendure AC+ en de catalogusgegevens van al opgenomen accu's
    // hangen als extra bron aan een bestaande uitvoering.
    assert_eq!(data["configurations"].as_array().unwrap().len(), 102);
    // Elke uitvoering uit een ingebouwde set is gemarkeerd; de interface verbergt de onvolledige.
    assert!(
        data["configurations"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["researched"] == true)
    );
    let offers = data["offers"].as_array().unwrap();
    // De catalogus noemt geen winkel bij zijn straatprijzen; die zijn geen aanbieding. De zesde
    // set voegt 35 webwinkelprijzen toe aan bestaande uitvoeringen, de zevende twee (AlphaESS) en
    // de achtste zes.
    assert_eq!(offers.len(), 75);
    assert!(offers.iter().all(
        |o| o["currency"] == "EUR" && o["source_url"].as_str().unwrap().starts_with("https://")
    ));
    // Een prijs ‘na teruggave btw’ blijft exclusief btw (Zonneplan en Sigenergy); bij Zonneplan
    // is onbekend of installatie inbegrepen is.
    let excluded: Vec<_> = offers
        .iter()
        .filter(|o| o["tax_basis"] == "excluded")
        .collect();
    assert_eq!(excluded.len(), 4);
    assert_eq!(
        excluded
            .iter()
            .filter(|o| o["includes_installation"].is_null())
            .count(),
        2
    );
    // Geen webwinkelprijs inclusief btw bevat installatie; onbekend blijft onbekend.
    assert!(
        offers
            .iter()
            .filter(|o| o["tax_basis"] == "included")
            .all(|o| o["includes_installation"] != true)
    );
    let tesla = data["configurations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["manufacturer_name"] == "Tesla")
        .unwrap()["id"]
        .clone();
    assert!(!offers.iter().any(|o| o["configuration_id"] == tesla));
    let zinvolt = data["configurations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| {
            c["manufacturer_name"] == "ZinVolt" && c["name"] == "1 unit · 4 kWh · stekker 2 kW"
        })
        .unwrap()["id"]
        .clone();
    assert!(offers.iter().any(|o| o["configuration_id"] == zinvolt
        && o["upfront_amount_minor"] == 189900
        && o["tax_basis"] == "included"));
    let usable: Vec<_> = data["numbers"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|n| n["configuration_id"] == tesla)
        .map(|n| n["metric_key"].as_str().unwrap())
        .collect();
    assert!(usable.contains(&"nominal_energy_wh") && usable.contains(&"usable_energy_wh"));
    let enphase = data["configurations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["manufacturer_name"] == "Enphase")
        .unwrap()["id"]
        .clone();
    assert!(
        !data["numbers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["configuration_id"] == enphase
                && n["metric_key"] == "continuous_discharge_power_w")
    );
    assert!(
        data["numbers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["configuration_id"] == enphase && n["metric_key"] == "apparent_power_va")
    );
    // De vijfde set hangt alleen bronclaims aan bestaande uitvoeringen (het aantal hierboven
    // blijft gelijk): gemeten rendement en sluimerverbruik, en het laadvermogen op een
    // bestaande groep naast de 2400 W uit de specificatielijst.
    let numbers = data["numbers"].as_array().unwrap();
    let fifth: Vec<_> = numbers
        .iter()
        .filter(|n| {
            n["entry_conditions"]
                .as_str()
                .unwrap()
                .starts_with("Onderzocht 2026-10-25.")
                && ["round_trip_efficiency_pct", "standby_power_w"]
                    .contains(&n["metric_key"].as_str().unwrap())
        })
        .collect();
    assert!(fifth.iter().all(|n| n["review_status"] == "unreviewed"));
    assert!(fifth.iter().any(|n| n["configuration_id"] == enphase
        && n["boundary"] == "ac_ac"
        && n["value"] == 90.0));
    let indevolt = data["configurations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "1 powermodule + 2 × PFA4000 · 10 kWh · stekker 800 W")
        .unwrap()["id"]
        .clone();
    let charge: Vec<_> = numbers
        .iter()
        .filter(|n| {
            n["configuration_id"] == indevolt && n["metric_key"] == "continuous_charge_power_w"
        })
        .map(|n| n["value"].as_f64().unwrap())
        .collect();
    assert!(charge.contains(&800.0) && charge.contains(&2400.0));
    assert!(numbers.iter().any(|n| n["configuration_id"] == indevolt
        && n["metric_key"] == "round_trip_efficiency_pct"
        && n["value"] == 80.5));
}

fn candidate() -> Value {
    json!({"manufacturer":"Fixture maker","product":"Fixture battery","model_code":"F1","product_kind":"battery_system","configuration":"1 unit","market":"unspecified","source_url":"","source_title":"Manual test entry","locator":"User declaration","numbers":[{"metric":"usable_energy_wh","qualifier":"exact","value":5000,"boundary":"battery_dc","reported_value":"5 kWh"}],"price":{"seller":"Fixture seller","currency":"EUR","minor_unit_exponent":2,"amount_minor":650099,"tax_basis":"included","includes_installation":true}})
}

#[tokio::test]
async fn candidate_import_is_atomic_and_multiple_source_claims_are_not_overwritten() {
    let catalog = Catalog::in_memory().await.unwrap();
    let app = thuisaccu_server::app(catalog.clone());
    let mut input = candidate();
    input["numbers"][0]["value"] = json!(-1);
    let request = |body: &Value| {
        Request::post("/api/v1/candidates")
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    };
    let response = app.clone().oneshot(request(&input)).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(catalog.list_products().await.unwrap().is_empty());
    for value in [5000, 4800] {
        input["numbers"][0]["value"] = json!(value);
        let response = app.clone().oneshot(request(&input)).await.unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
    }
    let comparison = catalog.comparison().await.unwrap();
    assert_eq!(comparison.configurations.len(), 1);
    assert_eq!(comparison.numbers.len(), 2);
    assert_eq!(comparison.offers[0].upfront_amount_minor, 650099);
    assert!(
        comparison.numbers[0]
            .source_url
            .starts_with("urn:thuisaccu:manual:")
    );
    // Eigen invoer is geen onderzochte uitvoering en blijft dus altijd zichtbaar.
    let response = app
        .oneshot(
            Request::get("/api/v1/comparison")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        response_json(response).await["configurations"][0]["researched"],
        false
    );
}

fn upload(path: &str, content: &[u8], options: Value) -> Request<Body> {
    let mut bytes = format!("--test-boundary\r\nContent-Disposition: form-data; name=\"options\"\r\n\r\n{}\r\n--test-boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"solar.csv\"\r\nContent-Type: text/csv\r\n\r\n", options).into_bytes();
    bytes.extend_from_slice(content);
    bytes.extend_from_slice(b"\r\n--test-boundary--\r\n");
    Request::post(path)
        .header(
            "content-type",
            "multipart/form-data; boundary=test-boundary",
        )
        .body(Body::from(bytes))
        .unwrap()
}

#[tokio::test]
async fn upload_inspection_and_preview_do_not_persist_until_save_and_repeat_save_is_idempotent() {
    let catalog = Catalog::in_memory().await.unwrap();
    let app = thuisaccu_server::app(catalog.clone());
    let csv = b"time,production\n2026-06-01T10:00:00Z,1\n2026-06-01T11:00:00Z,2\n";
    let inspected = app
        .clone()
        .oneshot(upload("/api/v1/solar/inspect", csv, json!({})))
        .await
        .unwrap();
    assert_eq!(inspected.status(), StatusCode::OK);
    assert_eq!(
        response_json(inspected).await["headers"],
        json!(["time", "production"])
    );
    let preview = app
        .clone()
        .oneshot(upload("/api/v1/solar/preview", csv, json!({})))
        .await
        .unwrap();
    assert_eq!(preview.status(), StatusCode::OK);
    assert_eq!(response_json(preview).await["production_kwh"], 3.0);
    assert!(catalog.list_solar().await.unwrap().is_empty());
    let mut ids = Vec::new();
    for _ in 0..2 {
        let response = app
            .clone()
            .oneshot(upload("/api/v1/solar/imports", csv, json!({})))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        ids.push(response_json(response).await["id"].clone());
    }
    assert_eq!(ids[0], ids[1]);
    let saved = catalog.list_solar().await.unwrap();
    assert_eq!(saved.len(), 1);
    // Met de versie van het inlezen erbij: na een reparatie in het inlezen wordt hetzelfde bestand
    // een nieuwe import in plaats van de oude meetperioden terug te geven.
    assert_eq!(
        saved[0].options["normalizer"],
        thuisaccu_server::solar_import::NORMALIZER_VERSION
    );
    let response = app
        .oneshot(upload(
            "/api/v1/solar/imports",
            b"time,value\n2026-01-01,-1",
            json!({}),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(catalog.list_solar().await.unwrap().len(), 1);
}

#[tokio::test]
async fn inverter_and_meter_files_are_saved_as_one_gross_profile() {
    let catalog = Catalog::in_memory().await.unwrap();
    let app = thuisaccu_server::app(catalog.clone());
    let part = |name: &str, filename: Option<&str>, body: &str| match filename {
        Some(f) => format!(
            "--test-boundary\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{f}\"\r\nContent-Type: text/csv\r\n\r\n{body}\r\n"
        ),
        None => format!(
            "--test-boundary\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{body}\r\n"
        ),
    };
    let body = [
        part("options", None, r#"{"timezone":"UTC"}"#),
        part(
            "file",
            Some("omvormer.csv"),
            "time,production\n2026-06-01T10:00:00Z,2\n2026-06-01T11:00:00Z,1\n",
        ),
        part(
            "meter_options",
            None,
            r#"{"timezone":"UTC","period":"hour"}"#,
        ),
        part(
            "meter_file",
            Some("p1.csv"),
            "time,import,export\n2026-06-01T10:00:00Z,0,1.5\n2026-06-01T11:00:00Z,0.5,0\n",
        ),
    ]
    .concat()
        + "--test-boundary--\r\n";
    let response = app
        .oneshot(
            Request::post("/api/v1/solar/imports")
                .header(
                    "content-type",
                    "multipart/form-data; boundary=test-boundary",
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let saved = response_json(response).await;
    // (2 + 0 − 1,5) + (1 + 0,5 − 0) = 2 kWh bruto verbruik.
    assert!((saved["summary"]["consumption_kwh"].as_f64().unwrap() - 2.0).abs() < 1e-9);
    let imports = catalog.list_solar().await.unwrap();
    assert_eq!(imports[0].filename, "omvormer.csv + p1.csv");
    assert_eq!(imports[0].options["combined_period"], "hour");
    assert_eq!(imports[0].options["meter"]["import_column"], 1);
}

#[tokio::test]
async fn an_inverter_and_a_meter_file_of_six_mb_each_fit_and_a_too_large_form_gets_a_dutch_message()
{
    let app = thuisaccu_server::app(Catalog::in_memory().await.unwrap());
    let form = |size: usize| {
        let filler = format!(
            "time,production\n{}",
            "2026-06-01T10:00:00Z,1\n".repeat(size / 23)
        );
        ["file", "meter_file"]
            .iter()
            .map(|name| format!("--test-boundary\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{name}.csv\"\r\nContent-Type: text/csv\r\n\r\n{filler}\r\n"))
            .collect::<String>()
            + "--test-boundary--\r\n"
    };
    let send = |body: String| {
        app.clone().oneshot(
            Request::post("/api/v1/solar/inspect")
                .header(
                    "content-type",
                    "multipart/form-data; boundary=test-boundary",
                )
                .body(Body::from(body))
                .unwrap(),
        )
    };
    let fits = response_json(send(form(6 * 1024 * 1024)).await.unwrap()).await;
    assert!(!fits.to_string().contains("niet worden gelezen"), "{fits}");
    // Samen boven de 21 MiB: de multipart-lezer stopt, met een Nederlandse melding.
    let response = send(form(11 * 1024 * 1024)).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let message = response_json(response).await.to_string();
    assert!(message.contains("niet worden gelezen"), "{message}");
}
