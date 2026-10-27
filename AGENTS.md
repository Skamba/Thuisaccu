# AGENTS.md

Instructies voor codeeragents in deze repo. Lees daarnaast [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md) en de relevante documenten in [docs/](docs/). Bij tegenspraak is de code leidend; werk dan ook de documentatie bij.

## Project in het kort

Lokale webapp voor onderzoek naar thuisaccu's: brongebonden productvergelijking, import van zonne-opwek en verbruik, en een Nederlandse scenariotool (eigen verbruik, NPV, ROI, terugverdientijd). Rust-backend met SQLite; de frontend is gewone HTML/CSS/JavaScript die in de binary wordt meegebakken.

| Pad | Inhoud |
| --- | --- |
| `crates/core` | Domeintypen en rekenkern: `products`, `sizing` (energiestromen; verdeling binnen een meetperiode uit het gegenereerde `load_spread.rs`, zie `tools/build_load_spread.py`), `finance` (rekeningen, kasstromen), `analysis` (validatie, vergelijking, doelen, gevoeligheid). Geen HTTP, opslag of UI. |
| `crates/storage` | SQLite via rusqlite (één verbinding achter een mutex), migraties in `migrations/`, opslagmethoden en leesmodellen. Werkt native en als WebAssembly. |
| `crates/server` | Axum-router (`src/lib.rs`), API-handlers (`api.rs`, `scenario_api.rs`; extractors met JSON-fouten in `extract.rs`), importadapters (`solar_import.rs`), PDOK-adreszoeken, ingebouwde resources (`resources/`: referenties, kostencatalogus, voorbeeldbestanden). |
| `crates/browser` | WebAssembly-module voor de browserversie: dezelfde router uit `thuisaccu-server` zonder netwerkpoort, database als bytes in en uit (IndexedDB in `web/worker.js`). Native een lege bibliotheek. |
| `web/` | `index.html` (shell; `data-backend` is `server` of `browser`), `styles.css`, `contract.js` (gegenereerde feiten uit Rust), `local.js` (API via webworker in de browserversie), `ui.js` (bouwstenen), `data.js` (API, labels, bronclaims → rekengegevens, kostenindicaties), schermen `keuzehulp.js`, `catalog.js`, `energy.js`, `scenario.js`, `results.js`, `compare.js` (berekeningen naast elkaar), en `app.js` (router, berekeningen, instellingen). Ingebakken via de tabel `ASSETS` in `crates/server/src/lib.rs`; `worker.js` hoort alleen bij de browserversie. |
| `docs/` | Architectuur, API-contract, datamodel, importafspraken, rekenmodel, onderzoek en roadmap. |

## Commando's

```sh
cargo run --locked -p thuisaccu-server        # http://127.0.0.1:3000, maakt data/research.sqlite3
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo build --workspace --locked
cargo doc --workspace --no-deps --locked
for f in web/*.js; do node --check "$f"; done   # als Node aanwezig is
cargo build --locked -p thuisaccu-server && (cd tests/e2e && npm ci && npm test)   # browsertests
sh tools/build-site.sh && (cd tests/e2e && E2E_MODE=browser npm test)                # browserversie
cargo clippy --locked --target wasm32-unknown-unknown -p thuisaccu-browser -p thuisaccu-server -p thuisaccu-storage --lib -- -D warnings
```

De browserversie bouwen vereist `rustup target add wasm32-unknown-unknown`, clang (SQLite wordt naar WebAssembly gecompileerd; op Windows bijvoorbeeld `scoop install llvm`) en `wasm-bindgen-cli` in precies de versie van `wasm-bindgen` in `Cargo.lock`.

Draai alle vijf de cargo-controles voordat je werk afrondt; CI (`.github/workflows/ci.yml`) draait precies deze op Linux én Windows, en daarnaast op Linux de WebAssembly-build en de browsertests in `tests/e2e/` (Playwright met Chromium, vastgezet in `package-lock.json`) tegen zowel de server als de browserversie. Een push naar `main` publiceert de browserversie los daarvan op GitHub Pages (`.github/workflows/pages.yml`), zonder op de controles te wachten: controleer dus lokaal vóór je pusht. Gebruik altijd `--locked`. Wijzig je iets in `web/`, draai dan ook de browsertests; ze starten de gebouwde server met een tijdelijke database en falen bij elk verzoek buiten 127.0.0.1.

Configuratie via omgevingsvariabelen: `LISTEN_ADDR`, `RUST_LOG`, `DATABASE_PATH`. `.env` wordt niet geladen. Gebruik voor handmatig testen een tijdelijke database (`DATABASE_PATH=<tempdir>/test.sqlite3`) zodat je de onderzoeksdata van de gebruiker niet vervuilt.

## Werkafspraken

- Code en identifiers in het Engels. Interfaceteksten, doc-comments en projectdocumentatie in het Nederlands, zoals de bestaande code.
- Houd de laagindeling aan: rekenlogica alleen in `thuisaccu-core`; adapters, configuratie en HTTP-contracten in `thuisaccu-server`; SQL alleen in `thuisaccu-storage`. HTTP-typen komen niet in de core.
- Regionale regels (Nederlandse tarieven, salderen, belasting) zijn scenario-invoer of afzonderlijke beleidsonderdelen, nooit stilzwijgend ingebouwd in de rekenkern.
- Workspace-lints: `unsafe_code = "forbid"`, Clippy met `-D warnings`. Voeg geen `#[allow(...)]` toe zonder reden in een comment.
- Nieuwe dependencies alleen als het echt nodig is; declareer ze in `[workspace.dependencies]` en commit `Cargo.lock`.
- Blokkerend werk (bestandsparsing, simulatie) draait via `crate::blocking` (native `spawn_blocking`, in de browser direct in de worker), zoals in `api.rs` en `scenario_api.rs`.
- Alles in `thuisaccu-core`, `thuisaccu-storage` en de router van `thuisaccu-server` moet ook naar `wasm32-unknown-unknown` compileren. Platformcode staat achter `#[cfg(target_family = "wasm")]`: geen `std::time::Instant`/`SystemTime`, threads, bestandssysteem of tokio-runtime in gedeelde code; tijd via `chrono::Utc::now()`. Handlers moeten `Send`-futures blijven (zie `pdok` in `scenario_api.rs` voor browser-fetch).
- `.editorconfig`: LF, UTF-8, 4 spaties; 2 spaties voor HTML, CSS en YAML.

## Domeinregels die niet mogen breken

Deze regels zijn de kern van het project. Een wijziging die er één schendt is fout, ook als de tests slagen.

- **Onbekend is geen nul.** Ontbrekende specificaties, kosten of meetwaarden blijven `None`/onbekend en worden zichtbaar als onbekend. Kostenstatus `unknown` blokkeert een berekening.
- **Bronclaims worden niet samengevoegd.** Tegenstrijdige claims blijven naast elkaar staan, elk met bron, vindplaats, markt en meetgrens. Nieuwe claims zijn `unreviewed`; bestaande worden niet overschreven.
- **Eenheden en meetgrenzen zijn expliciet:** Wh/kWh, W/kW, VA, rendement met grens (AC→AC, DC→DC, PV→AC), bruikbaar versus nominaal. kVA is geen kW; DC-rendement is geen AC-systeemrendement.
- **Geld:** ingevoerde bedragen zijn gehele minor units (eurocenten) met valuta en belastingbasis. Simulatie en projecties gebruiken `f64` zonder tussentijdse afronding; alleen de weergave rondt af.
- **Tijd:** tijdzone, intervalpositie (begin/einde), resolutie en ontbrekende perioden blijven expliciet. De scenariotool vereist één volledig, aaneengesloten jaar met bruto verbruik en AC-opwek op uur- of fijnere basis; netafname/teruglevering is daar geen vervanging voor.
- **De productvergelijking kiest geen winnaar.** Een aanbeveling bestaat alleen binnen een doorgerekend scenario met expliciete aannames, en "geen accu" is een volwaardige uitkomst.
- **Analyses zijn onveranderlijk.** Een geslaagde run wordt opgeslagen met volledige invoer, profielmetadata, profiel-hash en `model_version`; ongeldige runs worden niet opgeslagen. Verander je de betekenis van uitkomsten in de rekenkern, verhoog dan `model_version` in `crates/core/src/analysis.rs` en documenteer dat in `docs/roi-model.md`.
- **Demo-gegevens zijn altijd herkenbaar als FICTIEF**, ook in afgeleide analyses en de interface.
- **Privacy:** alleen een expliciete gebruikersactie stuurt een adres naar PDOK (vaste host, HTTPS, timeout, antwoordlimiet, geen redirects). Er worden geen energieprofielen extern verstuurd. Geen persoonlijke energiedata, adressen of offertes in Git of testfixtures; gebruik synthetische data.

## Database en migraties

- Migraties in `crates/storage/migrations/` staan met `include_str!` in `crates/storage/src/migrations.rs` en worden bij het openen toegepast. De boekhouding gebruikt de tabel `_sqlx_migrations` met SHA-384-controlegetallen, compatibel met databases van eerdere versies (SQLx). Een nieuwe migratie krijgt ook een regel in `MIGRATIONS`.
- **Wijzig nooit een bestaande migratie**; bestaande databases hebben de checksum al vastgelegd. Voeg een nieuw bestand toe met het volgende volgnummer (nu `0006_….sql`).
- Het schema bewaakt ook zelf validatie (foreign keys, CHECK-constraints, metricgrenzen). Houd schema- en Rust-validatie in lijn en werk [docs/data-model.md](docs/data-model.md) bij.
- Meervoudige inserts (dossiers, imports, runs) gebeuren transactioneel; bij één ongeldige claim wordt alles teruggerold.

## API

- Het contract staat in [docs/api.md](docs/api.md). Nieuwe of gewijzigde routes: router in `crates/server/src/lib.rs`, handler, test in `crates/server/tests/`, en de tabel in `docs/api.md`.
- Request-structs gebruiken `#[serde(deny_unknown_fields)]`; houd dat zo. Handlers lezen invoer met `ApiJson`, `ApiPath` en `ApiMultipart` (`extract.rs`), niet met de axum-extractors zelf, zodat ook een afgewezen verzoek JSON krijgt. Fouten geven JSON zonder interne details (HTTP 500 lekt geen databasefouten).
- Wijzigingen in `RunRequest` of het resultaat raken ook `web/keuzehulp.js`, `web/scenario.js`, `web/results.js` en bewaarde runs in bestaande databases; de browser moet oude runs blijven kunnen tonen.

## Frontend (`web/`)

- Geen frameworks, build-stap, CDN, externe fonts of scripts: de app moet volledig offline werken. Grafieken met inline SVG. Paden in `index.html` zijn relatief, zodat de site ook in een submap (GitHub Pages) werkt.
- API-verzoeken lopen via `UI.api`; dat kiest tussen `fetch` en `Local.fetch`. Roep `fetch` niet direct aan voor de API. Teksten over waar gegevens staan gebruiken `Local.where`.
- Na elke wijziging in `web/` moet de server opnieuw gebouwd en gestart worden; de bestanden zitten in de binary.
- Een nieuw script in `web/` krijgt een regel in `ASSETS` (`crates/server/src/lib.rs`), een `<script defer>` met relatief pad in `index.html` vóór `app.js`, en een regel in de assettest in `crates/server/tests/http.rs`. Een scherm registreert zich met `UI.page(...)`.
- Bouw de DOM met `UI.h()`; tekst wordt altijd als tekstknoop ingevoegd. Nooit `innerHTML` (de HTTP-test controleert dat). Formulieren houden hun toestand in een object en lezen niet terug uit de DOM.
- Toegankelijkheid: echte `<label>`s, `aria-live` voor statusmeldingen, zichtbare focus, toetsenbordbediening. Kleur is niet de enige betekenisdrager.
- Getallen in `nl-NL`-notatie; houd valuta, eenheid en meetgrens bij elke waarde zichtbaar.
- `crates/server/tests/http.rs` controleert de shell (`#nav`, `#view`, geen externe bronnen) en elk script.
- `web/contract.js` (`window.Contract`: modelversie, offertevelden, grenzen van de invoer, doelen, meldingscodes en meer) wordt gegenereerd met `UPDATE_CONTRACT=1 cargo test -p thuisaccu-server --test contract`; bewerk het nooit met de hand en kopieer geen Rust-constante in een script, maar lees hem uit `Contract`.

## Tests

- Schrijf gedragstests bij nieuwe berekeningen en API-contracten: `crates/core/tests/analysis.rs` (rekenkern), `crates/storage/tests/catalog.rs` (opslag, migraties, transacties), `crates/server/tests/*.rs` (HTTP, import, scenario).
- Referentiegevallen voor de rekenkern controleren energiebehoud, vermogensgrenzen, verliezen, NPV/ROI, financiering en vervanging. Een nieuwe rekenregel krijgt een handmatig narekenbaar referentiegeval met de aanname in de testnaam of een comment.
- `crates/server/tests/contract.rs` faalt als `web/contract.js` niet meer overeenkomt met de constanten in Rust (en als de tabel met meldingscodes in `docs/api.md` afwijkt van `analysis::MESSAGE_CODES`); vernieuw het met `UPDATE_CONTRACT=1 cargo test -p thuisaccu-server --test contract` en bekijk het verschil. Nooit met de hand bewerken.
- `crates/core/tests/golden.rs` legt twee volledige analyses (uur- en kwartierjaar) vast in `crates/core/tests/golden/`. Verandert een getal bewust, draai dan `UPDATE_GOLDEN=1 cargo test -p thuisaccu-core --test golden`, bekijk het verschil en verhoog zo nodig `model_version`. Een refactoring hoort ze ongewijzigd te laten.
- Testdata is synthetisch en klein. Voorbeeldbestanden voor import staan in `crates/server/resources/`.
- `tests/e2e/data.test.js` test `web/data.js` zonder browser (ui.js en data.js in een `vm`-context), bijvoorbeeld dat elke aannamezin herkend wordt; `npm test` draait hem mee.
- `tests/e2e/app.test.js` (node:test + Playwright) dekt de keuzehulp (ook zonder zonnepanelen), import met meterbestand, een Nederlandse export in lokale tijd, Zelf doorrekenen met een eigen offerte, een eigen accu in de catalogus, de prijswaarschuwing, instellingen en het smalle scherm. Gebruik daar ook alleen synthetische, in de test gegenereerde gegevens.

## Ingebouwde onderzoeksdata

- `crates/server/resources/references.json`, `references-nl.json`, `references-nl-2.json` (24 oktober 2026) en `references-nl-3.json`, `references-nl-4.json` tot en met `references-nl-7.json` (25 oktober 2026) en `references-nl-8.json` (26 oktober 2026) zijn gedateerde bronmomentopnamen, elk met een eigen importsleutel in `REFERENCE_SETS` (`api.rs`); alleen de Nederlandse sets bevatten prijzen. Nieuwe producten komen in een nieuwe set met een nieuwe sleutel, zodat bestaande databases ze bijladen zonder dat oude claims veranderen; de interface (`Data.catalog` in `web/data.js`) laadt ontbrekende sets bij elk bezoek automatisch. De interface waarschuwt drie maanden na de peildatum (`RESEARCHED_ISO` in `web/data.js`). `typical-profiles.json` bevat de profielvormen voor de keuzehulp, gebouwd met `tools/build_typical_profiles.py`; `cost-catalog.json` is het kostenonderzoek met `researched_on` en bronlinks.
- De interface toont een onderzochte uitvoering alleen als de keuzehulp hem zonder eigen invoer kan doorrekenen (capaciteit, AC-ontlaadvermogen, prijs inclusief btw, omvormer; `complete` in `web/data.js`). Een nieuwe set vult dus bij voorkeur zulke gaten; zelf toegevoegde uitvoeringen blijven altijd zichtbaar.
- Verzin geen specificaties, prijzen of bronnen. Bij bijwerken: nieuwe peildatum, controleerbare bron-URL en vindplaats, en de documentatie in [docs/battery-research.md](docs/battery-research.md) of [docs/roi-model.md](docs/roi-model.md) bijwerken.

## Wat buiten scope is tenzij gevraagd

Authenticatie, TLS, productiehosting, dynamische tarieven, handels- of onbalansinkomsten en markten buiten Nederland. Zie [docs/roadmap.md](docs/roadmap.md) voor de geplande volgorde.
