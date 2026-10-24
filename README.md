# Thuisaccu

Generieke webapp met een Rust-backend en SQLite voor onderzoek naar thuisaccu's. De eerste vergelijkingstool toont concrete uitvoeringen, bronclaims, garantiegegevens en eigen prijsaanbiedingen. Zonne-opwek kan via CSV, Excel of JSON worden ingelezen, gecontroleerd en bewaard.

De Nederlandse scenariotool simuleert zonnestroom opslaan voor eigen gebruik en vergelijkt accu-opties met géén accu. Je kiest het doel: netto contante waarde, ROI, terugverdientijd of eigen gebruik binnen een budget. Adres, energieprofiel, technische aannames, tarieven en alle extra kosten blijven bij de uitkomst bewaard. De onderzoeksdatastructuur blijft generiek.

## Lokaal starten

Installeer [Rust via rustup](https://rustup.rs/). De toolchainconfiguratie gebruikt stable met rustfmt en Clippy. Op Windows zijn ook de MSVC C++ Build Tools en Windows SDK nodig; rustup geeft dit aan tijdens installatie.

```sh
cargo run --locked -p thuisaccu-server
```

Open <http://127.0.0.1:3000>. Stop met Ctrl+C. De server maakt `data/research.sqlite3` aan en past de ingebouwde migraties toe. SQLite wordt meegebouwd; een aparte databaseserver is niet nodig. HTML, CSS en JavaScript zitten in de executable. Node.js en een frontend-build zijn niet nodig voor gebruik. Na wijzigingen in `web/` moet je de server opnieuw bouwen/starten.

## Gebruik

1. **Dashboard** is het startpunt: aantallen, de volgende stap en recente imports en analyses. De vaste navigatie brengt je naar een aparte taak; terug en vooruit in de browser werken via URL-hashes.
2. **Accu’s** toont een doorzoekbare catalogus met type- en fabrikantfilter. Laad via de lege toestand of **⋯ Meer** drie onderzochte bronmomentopnamen van 24 oktober 2026, zonder prijzen. **Eigen accu of offerte** opent een dialoog met drie stappen; lege gegevens blijven onbekend.
3. Kies maximaal vier uitvoeringen in de vergelijkingsbalk en open **Vergelijk**. Klap gegevensgroepen in, toon alleen verschillen of verberg rijen zonder bekende waarde. Iedere bronclaim behoudt zijn context. CSV exporteert de zichtbare vergelijking. Er wordt geen automatische winnaar gekozen.
4. **Opwek & verbruik** toont alle bewaarde imports met periode, resolutie en ROI-geschiktheid. **Importeer bestand** begeleidt je door bestand, kolommen en eenheden, controle en bewaren. Voorbeeldrijen, waarschuwingen en een SVG-maandgrafiek helpen bij de controle. Een bewaard profiel heeft een eigen detailscherm.
5. **Scenario’s → Nieuw scenario** begeleidt je door locatie en profiel, tarieven en horizon, accu-opties, en controle en bevestigingen. Gebruik een volledig aaneengesloten jaar met AC-opwek én bruto huishoudelijk verbruik op uur- of fijnere basis. Ongeschikte profielen vermelden de reden; onvoldoende metadata geeft ‘Onbekend’. PDOK-adreszoeken gebeurt uitsluitend met de zoekknop.
6. Iedere accu-optie heeft tabbladen voor techniek en kosten. De 26 kostenposten zijn gegroepeerd, met voortgang, een onbekendfilter en de bestaande bulkacties. Onbekende posten blokkeren het rekenen. De drie verklaringen over meetgrenzen, techniek en kosten blijven verplicht.
7. Na berekenen opent het **resultaatdashboard**: aanbeveling, KPI’s, en de tabbladen Overzicht, Kasstromen, Energie, Gevoeligheid, Invoer & aannames en Waarschuwingen. SVG-grafieken hebben tabellen als tekstalternatief. Bewaarde analyses openen altijd met hun oorspronkelijke invoer. Dupliceer een analyse om een nieuwe variant te maken, of exporteer het resultaat als CSV en druk het af.
8. **Instellingen** bewaart standaardaannames, licht/donker/systeem en informatiedichtheid alleen in deze browser. Nieuwe scenario’s gebruiken deze aannames. Onberekende scenario’s worden als concept in deze browser bewaard; gebruik **Concept verwijderen** om de invoer te wissen. Browseropslag kan ook het ingevoerde adres bevatten. Bij niet-beschikbare browseropslag blijft de app bruikbaar, met de oorspronkelijke standaardwaarden.

De interface is gericht op je eigen energieprofielen, contracttarieven en offertes. Bestaande fictieve gegevens en afgeleide analyses blijven als FICTIEF gemarkeerd; er zijn geen demo- of fictieve voorbeeldacties in de interface.

De berekening toont energiestromen, eigen gebruik, zelfvoorziening, jaarlijkse besparing, levensduurkosten, nettowinst, ROI, netto contante waarde (NPV), blijvende terugverdientijd en gevoeligheidsvarianten. Het eerste model gebruikt vaste tarieven en eigen zonnestroom; dynamische handel en onbalansinkomsten zijn niet opgenomen. Het vergelijkt de ingevoerde uitvoeringen en bepaalt geen wereldwijd optimale accu. Lees de [rekenmethode en het Nederlandse kostenonderzoek](docs/roi-model.md) voor definities, bronnen en grenzen.

Ondersteund: UTF-8 CSV/TSV, `.xlsx`, `.xls`, `.ods` en tabulaire JSON, met kolom- en werkbladkeuze, kopregels, decimaalteken, eenheden, tijdzone en intervalwaarden of cumulatieve standen. Limiet: 10 MB en 250.000 rijen. PDF en afbeeldingen worden niet uitgelezen. Zie [importafspraken](docs/solar-import.md).

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

Met Node.js: voer `node --check` uit op alle vijf bestanden in `web/` (`app.js`, `analysis.js`, `ui.js`, `workspace.js`, `results.js`). De tests controleren opslag, migraties, transacties, bronhistorie, HTTP-contracten, import en de rekenkern. Referentiegevallen controleren energiebehoud, vermogensgrenzen, verliezen, salderen, NPV/ROI, financiering, vervanging en veranderende aanbevelingen.

`Cargo.lock` legt dependencyversies vast. Stable Rust wordt niet op een specifieke compilerpatch vastgezet. De GitHub Actions-workflow draait zodra de repo naar GitHub wordt gepusht.

Zie [architectuur](docs/architecture.md), [API](docs/api.md), [ontwikkelafspraken](CONTRIBUTING.md) en [vervolgstappen](docs/roadmap.md).

