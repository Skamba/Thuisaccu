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

1. Laad via de knop drie onderzochte referentie-uitvoeringen of voeg een eigen accu/offerte toe. Referenties zijn bronmomentopnamen van 24 oktober 2026, zonder prijzen, en worden niet automatisch geladen.
2. Selecteer maximaal vier uitvoeringen en kies de gegevensgroepen. Open een bron voor de context. Tegenstrijdige claims blijven naast elkaar staan; onbekend wordt geen nul.
3. Voeg een prijsaanbieding toe met valuta, valutaprecisie, belastingbasis en installatieomvang. Prijs per opgegeven bruikbare kWh wordt alleen bepaald bij één exacte capaciteitsclaim. Exporteer de zichtbare vergelijking als CSV.
4. Upload een zonne-opwekbestand. Lees de kolommen, kies eenheden en tijdzone en controleer het overzicht voordat je het bewaart. Voorbeelden zijn beschikbaar in CSV, XLSX en JSON.
5. Ga naar **ROI**, vul een Nederlands adres in en selecteer een volledig aaneengesloten jaar met AC-opwek én bruto huishoudelijk verbruik op uur- of fijnere basis. PDOK-adresopzoeken is optioneel. Netafname en netexport zijn geen vervanging voor deze twee meetreeksen.
6. Voeg rekenopties toe, controleer de technische gegevens en beoordeel de 26 kostenposten. Geef contracttarieven en je doel op. Bereken en bewaar de vergelijking; eerdere analyses blijven met hun oorspronkelijke invoer beschikbaar.

Probeer **Fictief demojaar** om de volledige berekening te bekijken zonder eigen gegevens. Dit gebruikt synthetische opwek, verbruik, accu's, kosten en tarieven. De korte importvoorbeelden zijn onvoldoende voor ROI.

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

Optioneel met Node.js: `node --check web/app.js` en `node --check web/analysis.js`. De tests controleren opslag, migraties, transacties, bronhistorie, HTTP-contracten, import en de rekenkern. Referentiegevallen controleren energiebehoud, vermogensgrenzen, verliezen, salderen, NPV/ROI, financiering, vervanging en veranderende aanbevelingen.

`Cargo.lock` legt dependencyversies vast. Stable Rust wordt niet op een specifieke compilerpatch vastgezet. De GitHub Actions-workflow draait zodra de repo naar GitHub wordt gepusht.

Zie [architectuur](docs/architecture.md), [API](docs/api.md), [ontwikkelafspraken](CONTRIBUTING.md) en [vervolgstappen](docs/roadmap.md).

