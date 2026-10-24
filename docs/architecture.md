# Architectuur

## Uitgangspunten

Een webapp voor onderzoek, productvergelijking en Nederlandse economische scenario's. SQLite bewaart bronclaims, geïmporteerde zonne-opwek met verbruik en analyses met hun invoer. De browser ondersteunt vergelijken, offertes, import en de keuze van een rekencriterium. De rekenkern simuleert eigen zonnestroom; marktregels en grenzen staan in het [ROI-model](roi-model.md).

## Onderdelen

- `thuisaccu-core`: onafhankelijke domeintypen voor productonderzoek. `sizing` simuleert energiestromen, `finance` berekent rekeningen en kasstromen, `analysis` valideert en vergelijkt kandidaten, doelen en gevoeligheidsvarianten.
- `thuisaccu-storage`: SQLx, ingebouwde SQLite-migraties, typed opslagmethoden, vergelijkingsleesmodel, atomische dossier-/opwekimports en bewaarde analyse-invoer/resultaten. Foreign keys en validatie staan ook in het schema.
- `thuisaccu-server`: Axum op Tokio, router met catalogus-state. CSV/Excel/JSON-import, Nederlandse PDOK-adreszoekfunctie en scenario-API zijn adapters. Bestandsparsing en simulatie draaien via `spawn_blocking`. Configuratie en proceslevenscyclus staan in de binary.
- `web/`: ingebouwde HTML, CSS en gewone JavaScript. De browser gebruikt de JSON API en geeft invoer weer met DOM-tekstmethoden.

HTTP-typen blijven buiten de rekenkern. Het vergelijkingsleesmodel gebruikt serialiseerbare opslag-DTO's. Bronclaims worden niet tot één canonieke waarheid samengevoegd. Nieuwe dossiers en opwekimports worden transactioneel opgeslagen. De scenario-API controleert bevestigde meetgrenzen en aaneengesloten tijdstippen voordat de rekenkern het volledige jaar en de technische/financiële invoer valideert. Alleen een geslaagde berekening wordt met invoer, importmetadata, profielhash en modelversie opgeslagen.

## Gegevens en aannames

Het [datamodel](data-model.md) beschrijft de opslag en [solar-import](solar-import.md) de bestandsadapter. Er is nog geen accountmodel of automatische bronverversing. Houd bij vervolgwerk expliciet:

- Energie (kWh), vermogen (kW), capaciteit, rendement en degradatie.
- Tijdstippen, tijdzone, intervallen en ontbrekende meetgegevens.
- Valuta, prijsbasis, belastingen, tarieven en geldigheidsperiode.
- Marktregels en scenario-aannames inclusief bron en peildatum.
- Productspecificaties, compatibiliteit, prijsbron en vergelijkingscriteria.

Ingevoerde kosten en offertes gebruiken gehele minor units. Simulatie en geprojecteerde geldstromen gebruiken `f64` zonder tussentijdse afronding; de interface rondt voor weergave af. Dit is een schattingsmodel, geen facturatieboekhouding. Onbekende technische gegevens en kosten worden niet naar nul omgezet. API's retourneren uitvoer en waarschuwingen; de browser rendert ook opgeslagen resultaten met hun oorspronkelijke aannames.

## Operationele basis

De server migreert SQLite vóór het openen van de HTTP-poort en luistert standaard op loopback. Logging verloopt via tracing. Ctrl+C laat verzoeken afronden en sluit de databasepool. De interface heeft geen externe fonts of scripts nodig. Alleen een expliciete adreszoekactie gebruikt PDOK via HTTPS, met vaste host, geen redirects, een timeout en antwoordlimiet. Handmatige adresinvoer en alle lokale berekeningen werken zonder deze dienst.

De healthcheck bevestigt alleen dat de HTTP-service reageert. De database moet bij startup beschikbaar zijn; fouten na startup geven HTTP 500 zonder interne foutdetails. Er is nog geen afzonderlijke readinesscheck. Productiehosting, TLS, authenticatie en SIGTERM-afhandeling volgen bij concrete deployment-eisen.

## Technische referenties

De [Cargo-workspace](https://doc.rust-lang.org/cargo/reference/workspaces.html) deelt het lockbestand en dependencybeheer. De workspace gebruikt [resolver 3 voor Rust 2024](https://doc.rust-lang.org/edition-guide/rust-2024/cargo-resolver.html). De HTTP-laag volgt de [Axum Router](https://docs.rs/axum/latest/axum/struct.Router.html) en [serve](https://docs.rs/axum/latest/axum/fn.serve.html) API's.

