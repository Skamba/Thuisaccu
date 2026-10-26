//! Thuisaccu als WebAssembly-module: dezelfde router en SQLite-opslag als de lokale server, maar
//! zonder netwerkpoort. `web/worker.js` stuurt de API-verzoeken van de webinterface hierheen en
//! bewaart de database na elke wijziging in de browser (IndexedDB).
#![cfg(target_family = "wasm")]

use std::cell::RefCell;

use axum::{
    Router,
    body::Body,
    http::{Request, header},
};
use thuisaccu_storage::Catalog;
use tower::ServiceExt;
use wasm_bindgen::prelude::*;

thread_local! {
    static STATE: RefCell<Option<(Catalog, Router)>> = const { RefCell::new(None) };
}

fn js_error(error: impl std::fmt::Display) -> JsError {
    JsError::new(&error.to_string())
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console, js_name = error)]
    fn console_error(message: &str);
}

/// Een paniek breekt de module af (JavaScript ziet alleen `unreachable`); zet de melding in de
/// console, zodat de oorzaak terug te vinden is. `web/worker.js` start daarna opnieuw.
#[wasm_bindgen(start)]
fn start() {
    std::panic::set_hook(Box::new(|info| {
        console_error(&format!("Thuisaccu: {info}"))
    }));
}

/// Opent een eerder bewaarde database (ook een kopie van `data/research.sqlite3` van de lokale
/// server), of een lege database. Ontbrekende migraties worden toegepast.
#[wasm_bindgen]
pub async fn open(bytes: Option<Vec<u8>>) -> Result<(), JsError> {
    let catalog = match bytes {
        Some(bytes) => Catalog::from_bytes(&bytes).await,
        None => Catalog::in_memory().await,
    }
    .map_err(js_error)?;
    let router = thuisaccu_server::app(catalog.clone());
    STATE.with_borrow_mut(|state| *state = Some((catalog, router)));
    Ok(())
}

/// Antwoord op één API-verzoek.
#[wasm_bindgen]
pub struct Reply {
    status: u16,
    content_type: String,
    body: Vec<u8>,
}

#[wasm_bindgen]
impl Reply {
    #[wasm_bindgen(getter)]
    pub fn status(&self) -> u16 {
        self.status
    }

    #[wasm_bindgen(getter, js_name = contentType)]
    pub fn content_type(&self) -> String {
        self.content_type.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn body(&self) -> Vec<u8> {
        self.body.clone()
    }
}

/// Behandelt een API-verzoek zoals de lokale server dat doet; `path` bevat ook de querystring.
#[wasm_bindgen]
pub async fn request(
    method: String,
    path: String,
    content_type: Option<String>,
    body: Vec<u8>,
) -> Result<Reply, JsError> {
    let router = STATE
        .with_borrow(|state| state.as_ref().map(|(_, router)| router.clone()))
        .ok_or_else(|| js_error("De database is nog niet geopend."))?;
    let mut builder = Request::builder().method(method.as_str()).uri(path);
    if let Some(content_type) = content_type {
        builder = builder.header(header::CONTENT_TYPE, content_type);
    }
    let request = builder.body(Body::from(body)).map_err(js_error)?;
    let response = router.oneshot(request).await.map_err(js_error)?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .map_err(js_error)?;
    Ok(Reply {
        status,
        content_type,
        body: body.to_vec(),
    })
}

/// Volledige kopie van de database, om te bewaren of als back-up te downloaden.
#[wasm_bindgen]
pub fn snapshot() -> Result<Vec<u8>, JsError> {
    STATE
        .with_borrow(|state| state.as_ref().map(|(catalog, _)| catalog.to_bytes()))
        .ok_or_else(|| js_error("De database is nog niet geopend."))?
        .map_err(js_error)
}
