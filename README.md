# Thuisaccu

Generieke webapp met een Rust-backend en SQLite voor onderzoek naar thuisaccu's. De eerste vergelijkingstool toont concrete uitvoeringen, bronclaims, garantiegegevens en eigen prijsaanbiedingen. Zonne-opwek kan via CSV, Excel of JSON worden ingelezen, gecontroleerd en bewaard.

De Nederlandse scenariotool simuleert zonnestroom opslaan voor eigen gebruik en vergelijkt accu-opties met géén accu. Je kiest het doel: netto contante waarde, ROI, terugverdientijd of eigen gebruik binnen een budget. Adres, energieprofiel, technische aannames, tarieven en alle extra kosten blijven bij de uitkomst bewaard. De onderzoeksdatastructuur blijft generiek.

## Lokaal starten

Installeer [Rust via rustup](https://rustup.rs/). De toolchainconfiguratie gebruikt stable met rustfmt en Clippy. Op Windows zijn ook de MSVC C++ Build Tools en Windows SDK nodig; rustup geeft dit aan tijdens installatie.

```sh
cargo run --locked -p thuisaccu-server
```

Open <http://127.0.0.1:3000>. Stop met Ctrl+C. De server maakt `data/research.sqlite3` aan en past de ingebouwde migraties toe. SQLite wordt meegebouwd; een aparte databaseserver is niet nodig. HTML, CSS en JavaScript zitten in de executable. Node.js en een frontend-build zijn niet nodig voor gebruik. Na wijzigingen in `web/` moet je de server opnieuw bouwen/starten.

## In de browser (GitHub Pages)

Dezelfde app draait ook volledig in de browser, zonder server: de API en SQLite zijn naar WebAssembly gecompileerd (`crates/browser`) en draaien in een webworker. De database staat in IndexedDB van die browser. Er gaat niets naar een server, behalve een adres dat je zelf opzoekt via PDOK (rechtstreeks vanuit de browser). Onder Instellingen download je een back-up (een gewoon SQLite-bestand) of zet je er een terug; ook `data/research.sqlite3` van de lokale app werkt, als je die app eerst stopt.

Bouwen vereist het WebAssembly-target, clang (voor SQLite) en `wasm-bindgen-cli` in de versie uit `Cargo.lock`:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --locked --version 0.2.129
sh tools/build-site.sh            # statische site in site/
```

Serveer `site/` met een willekeurige statische webserver (de wasm moet als `application/wasm` komen). CI bouwt de site, test hem met Playwright en publiceert hem bij een push naar `main` op GitHub Pages; zet daarvoor eenmalig *Settings → Pages → Source* op *GitHub Actions*.

## Gebruik

1. **Keuzehulp** (startscherm) stelt vijf vragen in gewone taal: je energie (jaartotalen of een bestand), je woning, je contract, wat je belangrijk vindt, en dan het advies. Met jaartotalen maakt de server een geschat uurprofiel uit het standaardprofiel E1A 2026 en PVGIS-zonnedata. Het advies toont een zinvol capaciteitsbereik, welke accu’s passen en waarom niet, en rekent automatisch alle passende accu’s met een gepubliceerde prijs door tegenover geen accu, met een kostenindicatie voor alle 26 posten met bron of aanname. Zie [keuzehulp](docs/keuzehulp.md).
2. **Mijn berekeningen** bewaart elke uitkomst met de oorspronkelijke invoer: aanbeveling, samenvatting in gewone taal en tabbladen voor overzicht, kasstromen, energie, gevoeligheid, invoer en waarschuwingen. ‘Pas aan en reken opnieuw’ neemt een uitkomst over in Zelf doorrekenen; CSV-export en afdrukken zijn beschikbaar. Een berekening verwijder je vanuit het overzicht, na bevestiging.
3. **Accu’s vergelijken** toont de onderzochte uitvoeringen (bronmomentopnamen van 24 oktober 2026, waarvan vijf met een Nederlandse prijs) en eigen dossiers. Zet er maximaal vier naast elkaar; iedere bronclaim behoudt bron, vindplaats en meetgrens. Er wordt geen winnaar gekozen.
4. **Energiegegevens** toont bewaarde profielen met hun geschiktheid en een capaciteitscurve. De importwizard leest CSV, Excel of JSON van omvormers en van de slimme meter (P1: opwek, netafname en teruglevering in één bestand). Een profiel verwijderen kan vanuit het overzicht; berekeningen op dat profiel gaan mee, en de vraag vooraf noemt hoeveel.
5. **Zelf doorrekenen** is voor wie offertes heeft: alle aannames, tot twaalf opties met techniek, 26 kostenposten en financiering zelf invullen, met een knop die open posten vult met bronvermelde indicaties. Adres opzoeken via PDOK gebeurt alleen met de zoekknop.
6. **Instellingen** bewaart standaardaannames, thema en dichtheid in deze browser en kan concepten wissen. In de browserversie staan hier ook back-up, terugzetten en blijvende opslag.

Fictieve gegevens uit een oudere database blijven als FICTIEF gemarkeerd; de interface biedt geen demo-acties.

De berekening toont energiestromen, eigen gebruik, zelfvoorziening, jaarlijkse besparing, levensduurkosten, nettowinst, ROI, netto contante waarde (NPV), blijvende terugverdientijd en gevoeligheidsvarianten. Het eerste model gebruikt vaste tarieven en eigen zonnestroom; dynamische handel en onbalansinkomsten zijn niet opgenomen. Het vergelijkt de ingevoerde uitvoeringen en bepaalt geen wereldwijd optimale accu. Lees de [rekenmethode en het Nederlandse kostenonderzoek](docs/roi-model.md) voor definities, bronnen en grenzen.

Een slimme-meterexport (P1) met netafname en teruglevering kan samen met de opwek in één bestand worden ingelezen; bruto verbruik wordt dan afgeleid als opwek + afname − teruglevering. Ondersteund: UTF-8 CSV/TSV, `.xlsx`, `.xls`, `.ods` en tabulaire JSON, met kolom- en werkbladkeuze, kopregels, decimaalteken, eenheden, tijdzone en intervalwaarden of cumulatieve standen. Limiet: 10 MB en 250.000 rijen. PDF en afbeeldingen worden niet uitgelezen. Zie [importafspraken](docs/solar-import.md).

## Configuratie

De server leest procesvariabelen. `.env.example` is alleen een voorbeeld; `.env` wordt niet automatisch geladen.

| Variabele | Standaard | Betekenis |
| --- | --- | --- |
| `LISTEN_ADDR` | `127.0.0.1:3000` | IP-adres en poort; IPv6 bijvoorbeeld `[::1]:3000` |
| `RUST_LOG` | `info` | Logfilter, bijvoorbeeld `debug` |
| `DATABASE_PATH` | `data/research.sqlite3` | Bestandspad, relatief aan de werkmap of absoluut |

PowerShell:

```powershell
$env:LISTEN_ADDR = '127.0.0.1:3001'
$env:RUST_LOG = 'debug'
cargo run --locked -p thuisaccu-server
```

POSIX-shell:

```sh
LISTEN_ADDR=127.0.0.1:3001 RUST_LOG=debug cargo run --locked -p thuisaccu-server
```

Ongeldige configuratie of een bezette poort laat de server met een fout stoppen. Het standaardadres is alleen lokaal bereikbaar. Authenticatie, TLS en productiehosting vallen buiten deze initialisatie.

## Structuur

```text
crates/
  core/             Productonderzoek, energiestroomsimulatie en financiële vergelijking
  storage/          SQLite-schema, onderzoek, energieprofielen en analyses met invoer
  server/           Axum API, importadapters, PDOK, kostenonderzoek en voorbeelden
web/                Ingebouwde HTML, CSS en JavaScript
docs/               Architectuur, API-contract en vervolgwerk
.github/workflows/  CI voor Linux en Windows
```

Het [onderzoeksrapport](docs/battery-research.md) beschrijft welke parameters we vastleggen. Het [datamodel](docs/data-model.md) bevat relaties, eenheden, review-statussen en bronhistorie. Databasebestanden blijven buiten Git. Maak back-ups van eigen onderzoek; stop de app en andere SQLite-clients voor een eenvoudige bestandskopie.

## Controleren

Voer dezelfde controles uit als CI:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo build --workspace --locked
cargo doc --workspace --no-deps --locked
```

Met Node.js: voer `node --check` uit op alle scripts in `web/` en draai de browsertests met `cargo build --locked -p thuisaccu-server && (cd tests/e2e && npm ci && npx playwright install chromium && npm test)`. De tests controleren opslag, migraties, transacties, bronhistorie, HTTP-contracten, import en de rekenkern. Referentiegevallen controleren energiebehoud, vermogensgrenzen, verliezen, salderen, NPV/ROI, financiering, vervanging en veranderende aanbevelingen.

`Cargo.lock` legt dependencyversies vast. Stable Rust wordt niet op een specifieke compilerpatch vastgezet. De GitHub Actions-workflow draait zodra de repo naar GitHub wordt gepusht.

Zie [architectuur](docs/architecture.md), [API](docs/api.md), [ontwikkelafspraken](CONTRIBUTING.md) en [vervolgstappen](docs/roadmap.md).

## Licentie

De code valt naar keuze onder de [MIT-licentie](LICENSE-MIT) of de [Apache-licentie 2.0](LICENSE-APACHE), zoals gebruikelijk in het Rust-ecosysteem. Bijdragen worden onder dezelfde voorwaarden opgenomen, tenzij de bijdrager uitdrukkelijk iets anders aangeeft.

De onderzoekssets in `crates/server/resources/` geven claims van fabrikanten, winkels en testers weer met bron en vindplaats. Merknamen en de oorspronkelijke publicaties blijven van hun eigenaars; controleer prijzen en specificaties altijd bij de bron.
