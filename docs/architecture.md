# Architectuur

## Uitgangspunten

Een webapp voor onderzoek, productvergelijking en Nederlandse economische scenario's. SQLite bewaart bronclaims, geïmporteerde zonne-opwek met verbruik en analyses met hun invoer. De browser ondersteunt vergelijken, offertes, import en de keuze van een rekencriterium. De rekenkern simuleert eigen zonnestroom; marktregels en grenzen staan in het [ROI-model](roi-model.md).

## Onderdelen

- `thuisaccu-core`: onafhankelijke domeintypen voor productonderzoek. `sizing` simuleert energiestromen, `finance` berekent rekeningen en kasstromen, `analysis` valideert en vergelijkt kandidaten, doelen en gevoeligheidsvarianten.
- `thuisaccu-storage`: rusqlite met één verbinding achter een mutex (native met meegebouwde SQLite, in WebAssembly via `sqlite-wasm-rs`), ingebouwde SQLite-migraties, typed opslagmethoden, vergelijkingsleesmodel, atomische dossier-/opwekimports en bewaarde analyse-invoer/resultaten. Foreign keys en validatie staan ook in het schema.
- `thuisaccu-server`: Axum-router met catalogus-state; native op Tokio met HTTP. CSV/Excel/JSON-import, Nederlandse PDOK-adreszoekfunctie en scenario-API zijn adapters. Bestandsparsing en simulatie draaien native via `spawn_blocking`. Configuratie en proceslevenscyclus staan in de binary.
- `thuisaccu-browser`: dezelfde router als WebAssembly-module, zonder netwerkpoort. Exporteert `open(bytes?)`, `request(method, path, contentType, body)` en `snapshot()`.
- `web/`: ingebouwde HTML, CSS en gewone JavaScript. De browser gebruikt de JSON API en geeft invoer weer met DOM-tekstmethoden. Er zijn geen frameworks of build-stappen.

### Twee manieren van draaien

| | Lokale server | Browserversie |
| --- | --- | --- |
| Start | `cargo run -p thuisaccu-server` | statische site uit `tools/build-site.sh`, bijv. GitHub Pages |
| API | HTTP op 127.0.0.1 | `local.js` → module-webworker `worker.js` → `thuisaccu_browser.wasm` |
| Database | `data/research.sqlite3` (WAL) | SQLite in het geheugen van de worker; na elke geslaagde wijziging volledig bewaard in IndexedDB (`thuisaccu` / `bestanden` / `research.sqlite3`) |
| Back-up | bestand kopiëren na stoppen | Instellingen → Download back-up / terugzetten |
| PDOK | via de server (`reqwest`) | rechtstreeks vanuit de worker (`fetch`, geen credentials of referrer, timeout, geen redirects, antwoordlimiet) |

`index.html` geeft met `data-backend` aan welke van de twee; `tools/build-site.sh` zet die op `browser`. Het script zet ook een versie (`?v=`, een hash van de gebouwde bestanden) in alle verwijzingen tussen pagina, scripts, worker en WebAssembly-module. GitHub Pages laat de browser bestanden tien minuten uit de cache halen; zonder versie kon een nieuwe pagina met een oude module praten, met een 404 op nieuwe routes als gevolg. De worker antwoordt op een wijziging pas nadat de nieuwe database in IndexedDB staat, en bewaart kopieën na elkaar. Een back-up is een gewoon SQLite-bestand: de lokale server kan hem openen, en de browserversie kan het databasebestand van de lokale server inlezen (een WAL-kop wordt bij het inlezen omgezet). Gegevens in de browserversie gelden per browser en apparaat; de browser kan ze opruimen tenzij blijvende opslag is toegestaan (`navigator.storage.persist()`). Staan er minstens drie berekeningen en is er in deze browser veertien dagen geen back-up gedownload (het tijdstip staat in `localStorage`), dan herinnert Mijn berekeningen daaraan met een knop voor de back-up.
### Webinterface

`index.html` is alleen een shell: zijbalk met navigatie, paginakop en een leeg `#view`. Elk scherm wordt door een eigen script opgebouwd en registreert zich met `UI.page(sleutel, { title, subtitle, nav, render })`; `app.js` routeert. De navigatie toont, in deze volgorde, Keuzehulp, Mijn berekeningen, Accu’s vergelijken, Energiegegevens, Zelf doorrekenen en Instellingen. Routes: `#/keuzehulp` (ook een lege hash), `#/berekeningen`, `#/berekeningen/:id`, `#/accus`, `#/accus/vergelijk`, `#/energie`, `#/energie/import`, `#/energie/:id`, `#/zelf`, `#/instellingen` en `#/gedeeld/:data`. Adressen uit eerdere versies (`#/dashboard`, `#/scenarios…`, `#/opwek…`) worden doorgestuurd. Na een schermwissel krijgt de schermtitel focus; op smalle schermen opent een menuknop de navigatie.

‘Deel als link’ op een uitkomst (`Results` in `results.js`) zet een kopie van de bewaarde berekening in de link zelf: JSON met `v: 1`, ingepakt met `CompressionStream("deflate-raw")` en base64url-gecodeerd achter `#/gedeeld/`. Het deel na `#` gaat niet naar een server. Adres, coördinaten, BAG-id, bestandsnaam en importinstellingen gaan niet mee (een geschat of fictief profiel houdt zijn beschrijvende naam); meetgegevens per interval staan nooit in een berekening. Om de link kort te houden bevat hij alleen de aanbevolen accu, de beste vijf op het gekozen doel en de beste op netto contante waarde en in de terugleveringsvariant, met `shared_of` als het oorspronkelijke aantal. Bij het openen wordt de link begrensd uitgepakt (1,5 miljoen tekens, 8 MB JSON) en op vorm gecontroleerd; de uitkomst wordt getoond, niet opnieuw berekend of bewaard, met een melding dat het een gedeelde kopie is.

| Script | Verantwoordelijkheid |
| --- | --- |
| `local.js` | Kiest de backend; in de browserversie `Local.fetch` (zelfde vorm als `fetch`) naar de worker, back-up, terugzetten en blijvende opslag |
| `worker.js` | Alleen browserversie: laadt de WebAssembly-module, IndexedDB-opslag na elke wijziging. Na een paniek in de module (melding in de console) stopt de worker; `local.js` start bij het volgende verzoek een nieuwe met de laatst bewaarde database |
| `ui.js` | `h()`-elementbouwer (alleen tekstknopen, geen HTML-tekenreeksen), nl-NL-opmaak, API, browseropslag met `try/catch`, meldingen (één tegelijk; bij een ander scherm verdwijnen ze, behalve een bevestiging van zojuist), externe links (alleen http(s) wordt klikbaar), formuliervelden, tabbladen, wizard, dialoog, CSV-export en SVG-grafieken met tabel als alternatief |
| `data.js` | API-cache, vaste labels, geschiktheid van profielen, `describe()` (bronclaims → rekengegevens met benoemde aannames), `estimateCosts()` (alle 26 kostenposten met bron of aanname) en standaardaannames |
| `keuzehulp.js` | Begeleide keuzehulp; zie [keuzehulp](keuzehulp.md) |
| `catalog.js` | Catalogus, vergelijking met alle bronclaims en context, CSV, eigen dossier of offerte |
| `energy.js` | Energieprofielen, detail met capaciteitscurve en de importwizard (inclusief P1) |
| `scenario.js` | Zelf doorrekenen: alle parameters, tot twaalf opties met techniek, 26 kostenposten en financiering; PDOK-adreszoeken; overnemen van een bewaarde run |
| `results.js` | Uitkomst: kort antwoord met vier getallen (en bij het doel netto voordeel de nummer twee als het verschil kleiner is dan wat de aanbevolen accu in de ongunstige variant verliest), samenvatting in gewone taal met ingeklapte uitleg, acht tabbladen (waaronder offertecheck en kostenopbouw per kostenpost; lange lijsten tonen geen accu en de beste vijf, de rest ingeklapt), CSV en afdrukken. Afdrukken geeft het korte antwoord, de uitleg, het overzicht en de waarschuwingen; ‘Alles afdrukken’ alle tabbladen |
| `compare.js` | Twee tot vier bewaarde berekeningen naast elkaar (`#/vergelijk/3-5`): uitkomst, besproken accu, startinvestering, besparing in jaar 1, grensprijs, NPV, terugverdientijd en wat er aan de invoer anders is, met een melding bij een ouder rekenmodel en de begrippen uit `Data.GLOSSARY` |
| `app.js` | Router, navigatie, Mijn berekeningen (met de keuze om te vergelijken) en Instellingen |

Formulieren in de keuzehulp en Zelf doorrekenen houden hun toestand in één object en bouwen het scherm daaruit op; ze lezen geen waarden terug uit de DOM. Concepten (`thuisaccu-keuzehulp`, `thuisaccu-scenario`), de ingevulde offertecheck per berekening (`thuisaccu-offertecheck-<id>`), de vergelijkingskeuze, standaardaannames (`thuisaccu-standaard`), thema en dichtheid staan alleen in `localStorage`. Zonder browseropslag werkt alles met de oorspronkelijke waarden. Bevestigingen worden nooit uit een concept of een overgenomen run gehaald. Fictieve gegevens uit een oudere database (`is_demo`) blijven overal herkenbaar als FICTIEF.

Alle scripts en het stijlblad staan in de tabel `ASSETS` in `crates/server/src/lib.rs` en worden met `include_str!` uit de binary geserveerd; `crates/server/tests/http.rs` controleert voor elk script de route, het content-type, het laden door de shell en de afwezigheid van `innerHTML`. Ze gaan met `Cache-Control: no-cache` de deur uit, zodat de browser na een nieuwe build geen oude scripts gebruikt. Na een wijziging in `web/` moet de server opnieuw worden gebouwd. Er zijn geen externe fonts, scripts of grafiekdiensten.

De vergelijking houdt maximaal vier uitvoeringen vast; filters veranderen alleen de presentatie en de CSV-export, claims worden niet samengevoegd. Resultaten gebruiken uitsluitend de bewaarde invoer en uitkomst, zodat oudere runs ongewijzigd te tonen blijven. Het netdeel van het verbruik wordt afgeleid als bruto vraag min direct gebruikte zonnestroom en acculevering; een resterend deel van de productiebalans heet ‘Overig (o.a. sluimerverbruik)’. Gevoeligheidsbanden zijn modelvarianten, geen betrouwbaarheidsintervallen.

CSS-custom-properties ondersteunen licht, donker, systeemvoorkeur en een compacte dichtheid. Tabbladen gebruiken roving tabindex en pijl-, Home- en End-toetsen. Meldingen zijn sluitbare toasts; fouten blijven staan tot je naar een ander scherm gaat. Een knop die wacht op de API krijgt `aria-busy`. Ongeldige velden krijgen `aria-invalid` en een zichtbare melding onder het veld (of onder de groep keuzes), gekoppeld met `aria-describedby`; de focus gaat naar het eerste ongeldige veld. Een fout die meer velden betreft (`UI.reject`) staat bij het veld waar je hem oplost, niet in een melding. In een wizard gaat de focus na Volgende of Vorige naar de kop van de nieuwe stap, en zet een stap zijn hoofdknop met `action()` in de vaste balk onderaan; op een smal scherm vervangt ‘Stap 2 van 5 · …’ met een voortgangsbalk de rij stapknoppen. Kleur is nooit de enige betekenisdrager.

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

De server weigert verzoeken van andere websites: `Host` moet een IP-adres of `localhost` zijn (tegen DNS-rebinding) en een wijziging met `Origin` moet van dezelfde host komen (`same_site` in `crates/server/src/lib.rs`, zie [API](api.md)). De healthcheck bevestigt alleen dat de HTTP-service reageert. De database moet bij startup beschikbaar zijn; fouten na startup geven HTTP 500 zonder interne foutdetails. Er is nog geen afzonderlijke readinesscheck. Productiehosting, TLS, authenticatie en SIGTERM-afhandeling volgen bij concrete deployment-eisen.

## Technische referenties

De [Cargo-workspace](https://doc.rust-lang.org/cargo/reference/workspaces.html) deelt het lockbestand en dependencybeheer. De workspace gebruikt [resolver 3 voor Rust 2024](https://doc.rust-lang.org/edition-guide/rust-2024/cargo-resolver.html). De HTTP-laag volgt de [Axum Router](https://docs.rs/axum/latest/axum/struct.Router.html) en [serve](https://docs.rs/axum/latest/axum/fn.serve.html) API's.

