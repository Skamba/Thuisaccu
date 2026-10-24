//! Generieke domeinbibliotheek voor keuzes rond thuisaccu's.
//!
//! `products` bevat de modellen voor brongebonden productonderzoek.
//! `sizing` simuleert eigen zonnestroom met vermogensgrenzen en verliezen.
//! `finance` en `analysis` vergelijken economische scenario's en keuzedoelen.
//! Deze crate is onafhankelijk van HTTP, opslag en de gebruikersinterface.

pub mod analysis;
pub mod finance;
pub mod products;
pub mod sizing;
