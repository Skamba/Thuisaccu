//! Extractors die afgewezen verzoeken als JSON beantwoorden, net als de rest van de API.
//! Axum geeft bij ongeldige JSON, een verkeerd content-type, een te grote body of een ongeldig
//! id in het pad anders platte tekst; de statuscode blijft die van axum.

use axum::{
    Json,
    extract::{
        FromRequest, FromRequestParts, Multipart, Path, Request,
        multipart::MultipartRejection,
        rejection::{JsonRejection, PathRejection},
    },
    http::{StatusCode, request::Parts},
};
use serde::de::DeserializeOwned;
use serde_json::json;

use crate::api::ApiError;

/// `Json<T>` met een JSON-foutmelding.
pub struct ApiJson<T>(pub T);

/// `Path<T>` met een JSON-foutmelding.
pub struct ApiPath<T>(pub T);

/// `Multipart` met een JSON-foutmelding.
pub struct ApiMultipart(pub Multipart);

fn rejected(status: StatusCode, error: &str, message: &str, detail: String) -> ApiError {
    (
        status,
        Json(json!({"error": error, "message": message, "detail": detail})),
    )
}

/// Te groot en verkeerd content-type krijgen een eigen code; de rest is onleesbare invoer.
fn body_rejection(status: StatusCode, detail: String, invalid: (&str, &str)) -> ApiError {
    match status {
        StatusCode::PAYLOAD_TOO_LARGE => rejected(
            status,
            "too_large",
            "De invoer is te groot voor deze route.",
            detail,
        ),
        StatusCode::UNSUPPORTED_MEDIA_TYPE => {
            rejected(status, "unsupported_media_type", invalid.1, detail)
        }
        _ => rejected(status, invalid.0, invalid.1, detail),
    }
}

impl<T: DeserializeOwned, S: Send + Sync> FromRequest<S> for ApiJson<T> {
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        Json::<T>::from_request(request, state)
            .await
            .map(|Json(value)| Self(value))
            .map_err(|rejection: JsonRejection| {
                body_rejection(
                    rejection.status(),
                    rejection.body_text(),
                    (
                        "invalid_json",
                        "De invoer is geen geldige JSON voor deze route; stuur een JSON-object met \
                         Content-Type: application/json en de velden uit de API-beschrijving.",
                    ),
                )
            })
    }
}

impl<T: DeserializeOwned + Send, S: Send + Sync> FromRequestParts<S> for ApiPath<T> {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        Path::<T>::from_request_parts(parts, state)
            .await
            .map(|Path(value)| Self(value))
            .map_err(|rejection: PathRejection| {
                rejected(
                    rejection.status(),
                    "invalid_path",
                    "Het adres van dit verzoek is ongeldig; een id is een positief geheel getal.",
                    rejection.body_text(),
                )
            })
    }
}

impl<S: Send + Sync> FromRequest<S> for ApiMultipart {
    type Rejection = ApiError;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        Multipart::from_request(request, state)
            .await
            .map(Self)
            .map_err(|rejection: MultipartRejection| {
                body_rejection(
                    rejection.status(),
                    rejection.body_text(),
                    (
                        "invalid_input",
                        "Stuur het bestand als multipart/form-data met het veld `file` en eventueel `options`.",
                    ),
                )
            })
    }
}
