# HTTP-contract

De volgende routes bestaan:

| Route | Succesresponse | Doel |
| --- | --- | --- |
| `/` | `200`, `text/html; charset=utf-8` | App-shell; taakschermen via de URL-hash |
| `/styles.css` | `200`, `text/css; charset=utf-8` | Stijlblad |
| `/api/v1/health` | `200`, `application/json` | Servicestatus |
| `/ui.js`, `/data.js`, `/results.js`, `/keuzehulp.js`, `/catalog.js`, `/energy.js`, `/scenario.js`, `/app.js` | `200`, `text/javascript; charset=utf-8` | Browserscripts uit de tabel `ASSETS` |
| `/api/v1/products` | `200`, JSON | Productidentiteiten in een `products`-array |
| `/api/v1/comparison` | `200`, JSON | `configurations`, `numbers`, `features`, `texts`, `warranties`, `offers` |
| `POST /api/v1/candidates` | `201`, JSON | Onderzoeksdossier atomisch opslaan; geeft `configuration_id` |
| `POST /api/v1/references` | `200`, JSON | Expliciete invoer van twee sets bronmomentopnamen, elk idempotent per sleutel; `imported: true` als minstens één set nieuw was |
| `POST /api/v1/solar/inspect` | `200`, JSON | Kolommen, eerste acht rijen, werkbladen, aantal rijen, eventuele metadata |
| `POST /api/v1/solar/preview` | `200`, JSON | Opwekoverzicht zonder opslag |
| `POST /api/v1/solar/imports` | `201`, JSON | Atomische opslag; geeft `id` en `summary` |
| `GET /api/v1/solar/imports` | `200`, JSON | Bewaarde overzichten in een `imports`-array |
| `GET /api/v1/solar/imports/{id}/capacity` | `200`, JSON met `points` en `assumptions` | Bovengrens van via de accu zelf gebruikte zonnestroom per capaciteit (0–20 kWh), verliesvrij en zonder vermogensgrens |
| `POST /api/v1/solar/typical` | `201`, JSON met `id`, `filename`, `summary` | Geschat uurjaar uit jaartotalen opslaan als gemodelleerde import |
| `GET /api/v1/solar/typical` | `200`, JSON | Bronnen van de ingebakken profielvormen en PV-opbrengst per kWp per ligging |
| `GET /api/v1/analysis/costs` | `200`, JSON | 26 kostencategorieën, toelichtingen, gedateerde bronlinks en `estimates` (bronnen en bedragen voor kostenindicaties) |
| `POST /api/v1/analysis/runs` | `201`, JSON met `id` en `result` | Valideren, simuleren, vergelijken en met invoer opslaan |
| `GET /api/v1/analysis/runs` | `200`, JSON met `runs` | Laatste 100 analyses met oorspronkelijke `input` en `result` |
| `POST /api/v1/locations/search` | `200`, JSON met `results` en `source` | Expliciet een Nederlands adres opzoeken bij PDOK |

De healthresponse is:

```json
{"status":"ok"}
```

Onbekende routes geven `404` met JSON:

```json
{"error":"not_found"}
```

Axum ondersteunt ook HEAD voor GET-routes. Niet-ondersteunde methoden op bestaande routes geven `405`; deze frameworkresponse heeft nog geen eigen JSON-foutcontract.

## Dossierinvoer

`POST /api/v1/candidates` accepteert JSON volgens `CandidateDraft` in `crates/storage/src/comparison.rs`. Identiteit bestaat uit fabrikant, product, modelcode, producttype en configuratienaam. De bronvelden bevatten titel, link (leeg voor interne handmatige bron), vindplaats, markt, optionele documentrevisie en publicatiedatum. `numbers`, `features` en `texts` zijn arrays van gecontroleerde codes. Een optionele productsamenvattingsgarantie en prijs kunnen worden toegevoegd.

Nieuwe bronclaims zijn `unreviewed`. Herhaalde invoer voor dezelfde identiteit maakt een nieuwe bron en entry; bestaande specificaties worden niet overschreven. Bij één ongeldige claim wordt het hele dossier teruggerold. De volledige Rust-domeinmodellen en opslagmethoden ondersteunen meer detail dan dit snelle invoercontract.

## Opwekbestanden

De drie uploadroutes accepteren `multipart/form-data` met één `file` en één optioneel `options`-veld dat JSON bevat. Gebruik voor `options` de velden van `ImportOptions` in `crates/server/src/solar_import.rs`. Alle velden hebben defaults; de browser toont de instellingen expliciet en vereist een gecontroleerde preview voor de bewaaractie. De API parseert en valideert bij bewaren opnieuw.

Belangrijkste opties: profiel, werkblad, kopregelindex (nul betekent eerste regel), kolomindexen vanaf nul, optionele aparte tijdkolom, eenheid, interval/cumulatief, periode, IANA-tijdzone, tijdstempelpositie, decimaalteken, datumvolgorde en beleid voor ontbrekende meetwaarden. Profielen zijn `generic`, `solaredge`, `enphase`, `sma`, `fronius` en `pvgis`. Met `consumption_source: "net_meter"` en `export_column` is de verbruikskolom netafname en de terugleverkolom netteruglevering; bruto verbruik wordt per interval `opwek + afname − teruglevering`. Standaard is `consumption_source: "gross"`.

`preview` en `imports` accepteren daarnaast samen een `meter_file` en `meter_options` (velden van `MeterOptions`: `import_column` en `export_column` in plaats van opwek en verbruik, verder dezelfde lees- en tijdinstellingen). Dan wordt het omvormerbestand gecombineerd met het meterbestand, zie [importafspraken](solar-import.md#omvormer--en-meterbestand-combineren). Het omvormerbestand mag dan geen verbruikskolom hebben. Een meterbestand inspecteren doe je met `inspect` en het meterbestand als `file`.

Dezelfde bestandsbytes met identieke geserialiseerde instellingen geven hetzelfde import-ID terug. De requestlimiet is 11 MiB inclusief multipart-overhead; het bestand zelf is maximaal 10 MiB. Per bestand gelden maximaal 250.000 gegevensrijen en 200 kolommen. Lees [de importafspraken](solar-import.md) voor de betekenis van waarden en beperkingen.

## Geschat profiel en capaciteitscurve

`POST /api/v1/solar/typical` accepteert `{ "annual_consumption_kwh": 3500, "solar": { "orientation": "south", "annual_production_kwh": 4000, "peak_power_kwp": null } }`. Verbruik is bruto (100–100.000 kWh). `solar` is `null` zonder panelen; geef anders precies één van jaaropwek (1–100.000 kWh) of piekvermogen (0,1–100 kWp). Ligging is `south`, `south_east`, `south_west`, `east`, `west` of `east_west`. Optioneel geven `heat_pump_kwh` (0–30.000) en `ev: { "annual_kwh": 1500, "charging": "evening" }` (0–20.000 kWh; `evening`, `night` of `daytime`) aan welk deel van het jaarverbruik naar een warmtepomp en het thuisladen van een auto gaat; samen moeten ze minstens 100 kWh van het jaarverbruik overlaten. Het resultaat is een volledig uurjaar met `data_kind: modelled` en `generator: typical-nl-v1`; dezelfde invoer geeft hetzelfde import-ID. Een analyse op zo’n profiel begint met de waarschuwing GESCHAT PROFIEL. Zie [keuzehulp](keuzehulp.md) voor bronnen en grenzen.

`GET /api/v1/solar/imports/{id}/capacity` vereist dezelfde aaneengesloten jaarreeks met bruto verbruik als een analyse en geeft per capaciteit `usable_capacity_kwh`, `battery_to_load_kwh`, `self_consumption_pct`, `self_sufficiency_pct` en `equivalent_cycles`.

## Scenario-invoer en resultaten

`POST /api/v1/analysis/runs` accepteert `RunRequest` uit `crates/server/src/scenario_api.rs`. De modellen van `thuisaccu_core::analysis`, `finance` en `sizing` zijn de getypeerde veldcontracten. Onbekende JSON-velden worden geweigerd. Alle volgende groepen zijn verplicht:

| Veld | Contract |
| --- | --- |
| `title` | Niet leeg, maximaal 200 bytes |
| `solar_import_id` | Bestaande import met één aaneengesloten volledig jaar en bruto verbruik per interval |
| `site` | `address`, optioneel samen `latitude`/`longitude` binnen Nederland, optioneel `bag_id` |
| `parameters` | Startjaar, horizon, discontovoet, kostenindex, PV-afname, verbruiksgroei, doel, optioneel budget, tarieven en gevoeligheidspercentages |
| `candidates` | 1–12 kandidaten met unieke `key`, `name`, optioneel `configuration_id`, `battery`, `costs`, `financing` en `assumptions` |
| `costs_confirmed`, `technical_assumptions_confirmed`, `consumption_is_gross`, `production_is_ac` | Alle `true` voor een schatting met bevestigde kosten en meetgrenzen |

`objective` is `net_present_value`, `roi`, `payback` of `self_consumption`. `tariff` bevat `import_eur_per_kwh`, `export_eur_per_kwh`, `export_fee_eur_per_kwh`, `export_fee_bands`, `fixed_annual_eur` en `annual_price_change_pct`. Een staffel is `{ "up_to_kwh": 1000, "annual_eur": 120 }`; de laatste bovengrens moet `null` zijn. Optioneel is `export_variant`: `{ "label": "Geen vergoeding vanaf 2030", "from_calendar_year": 2030, "export_eur_per_kwh": 0, "export_fee_eur_per_kwh": 0.05 }`, met een beginjaar op of na `start_year`. Bedragen zijn all-in EUR zoals van toepassing op het scenario.

`battery` bevat `usable_capacity_kwh`, `charge_power_kw`, `discharge_power_kw`, `ac_round_trip_efficiency_pct`, `standby_w`, `annual_capacity_loss_pct` en `operating_life_years`. Capaciteit is intern bruikbaar, vermogens zijn werkelijk AC-vermogen. Technische invoer en herkomst worden per kandidaat vastgelegd; een catalogus-ID is een verwijzing en bewijst geen geschiktheid.

`costs` bevat elke sleutel uit `/api/v1/analysis/costs` precies één keer. Iedere regel bevat `category`, `status` (`priced`, `included`, `not_applicable`; `unknown` blokkeert), `amount_minor` (gehele niet-negatieve eurocenten), `timing` (`upfront`, `annual`, `event`), `year` (`null` behalve geprijsde gebeurtenissen), `source` en `notes`. Een geprijsde gebeurtenis vereist jaar 1 t/m horizon en vindt op het jaareinde plaats. Alleen geprijsde accuvervanging herstart de techniek. `financing` bevat `loan_amount_eur`, `annual_interest_pct`, `years`; geen lening is bedrag nul. De lening mag de netto startinvestering niet overschrijden en moet binnen de horizon lopen.

De rekenkern bepaalt energiestromen per meetperiode en projecteert jaarlijkse rekeningen en extra kasstromen. `result` bevat `model_version`, `recommended_key`, `recommendation`, `baseline_first_year`, `candidates` en `warnings`. Iedere kandidaat bevat onder meer NPV, ROI, nettowinst, blijvende en gedisconteerde terugverdientijd, kosten/besparing, jaarlijkse resultaten en twee gevoeligheidsvarianten. `recommended_key: "no_battery"` betekent dat geen accu onder dit criterium beter scoort. Alleen met `export_variant` bevat het resultaat `export_variant_recommended_key` en iedere kandidaat `export_variant` (`npv_eur`, `net_profit_eur`, `roi_pct`, `payback_years`); oudere runs hebben deze velden niet. De [rekenmethode](roi-model.md) definieert formules en beperkingen.

De opgeslagen `input` bevat `request`, `profile` (importmetadata), `profile_sha256` en de kostenonderzoeksdatum. Resultaten worden niet automatisch aangepast als de catalogus of editor verandert. De API bewaart een nieuwe rij per geslaagde analyse; een ongeldige analyse wordt niet opgeslagen. Een fictief profiel uit een oudere database (`is_demo`) wordt in iedere afgeleide analyse als FICTIEF gemarkeerd.

## Adresopzoeken

`POST /api/v1/locations/search` accepteert `{ "query": "Binnenhof 1 Den Haag" }` met 4–200 bytes na trimmen. De server stuurt die zoekterm naar de vaste HTTPS-PDOK-host, beperkt tot vijf adresresultaten. Ieder resultaat heeft `address`, `latitude`, `longitude`, `bag_id`. Er worden geen energieprofielen meegestuurd. Timeout: 10 seconden; geen redirects; maximaal 1 MB antwoord. De browser vereist een expliciete zoekactie en resultaatkeuze. Handmatig adresgebruik blijft mogelijk als PDOK niet beschikbaar is. Een adres levert geen automatische aansluiting, tarief of PV-schatting.

## Fouten en grenzen

Inhoudelijk ongeldige invoer geeft `400` met `error: invalid_input` (catalogus/import) of `invalid_analysis` (scenario/adres) en een gebruikersmelding. Databasefouten geven `500` met `error: database_error`; interne details blijven in de serverlog. Axum-rejections, bijvoorbeeld verkeerde JSON-typen, een verkeerde content-type of een te grote body, gebruiken vooralsnog de frameworkresponse en kunnen onder meer `413`, `415` of `422` geven.

De vergelijkingsroute levert alle catalogusclaims zonder paginering, bronselectie of automatische reviewfiltering; dit past bij de huidige lokale onderzoekscatalogus. De healthcheck is liveness en geen aparte database-readinesscheck. Browser en API gebruiken dezelfde oorsprong, zonder CORS-configuratie. Alle routes zijn voor lokaal gebruik; er is geen authenticatie. Alleen adreszoeken gebruikt een externe dienst.

