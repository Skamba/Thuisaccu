# HTTP-contract

De volgende routes bestaan:

| Route | Succesresponse | Doel |
| --- | --- | --- |
| `/` | `200`, `text/html; charset=utf-8` | App-shell; taakschermen via de URL-hash |
| `/styles.css` | `200`, `text/css; charset=utf-8` | Stijlblad |
| `/api/v1/health` | `200`, `application/json` | Servicestatus |
| `GET /api/v1/backup` | `200`, `application/vnd.sqlite3`, als bijlage `thuisaccu-JJJJ-MM-DD.sqlite3` | Volledige, samenhangende kopie van de database terwijl de app draait (via de verbinding, dus inclusief wat nog in het WAL-bestand staat). Te openen door de lokale app en in te lezen door de browserversie |
| `/ui.js`, `/data.js`, `/results.js`, `/keuzehulp.js`, `/catalog.js`, `/energy.js`, `/scenario.js`, `/compare.js`, `/app.js` | `200`, `text/javascript; charset=utf-8` | Browserscripts uit de tabel `ASSETS` |
| `/api/v1/products` | `200`, JSON | Productidentiteiten in een `products`-array |
| `/api/v1/comparison` | `200`, JSON | `configurations`, `numbers`, `features`, `texts`, `warranties`, `offers`; elke configuratie heeft `researched` (staat in een ingebouwde onderzochte set) |
| `POST /api/v1/candidates` | `201`, JSON | Onderzoeksdossier atomisch opslaan; geeft `configuration_id` |
| `GET /api/v1/references` | `200`, JSON met `sets` en `pending` | Aantal ingebouwde sets bronmomentopnamen en hoeveel daarvan nog niet in deze database staan; laadt zelf niets |
| `POST /api/v1/references` | `200`, JSON | Invoer van de ingebouwde sets bronmomentopnamen, elk idempotent per sleutel (al geladen sets worden niet opnieuw ingelezen); `imported: true` als minstens één set nieuw was. De interface roept dit één keer per bezoek aan |
| `POST /api/v1/solar/inspect` | `200`, JSON | Kolommen, eerste acht rijen, werkbladen, aantal rijen, eventuele metadata |
| `POST /api/v1/solar/preview` | `200`, JSON | Opwekoverzicht zonder opslag |
| `POST /api/v1/solar/imports` | `201`, JSON; `200` als het profiel al bestond | Atomische opslag; geeft `id`, `existing`, `filename` (de bewaarde naam) en `summary` |
| `GET /api/v1/solar/imports` | `200`, JSON | Bewaarde overzichten in een `imports`-array, elk met `analysis_runs` (aantal berekeningen op dat profiel) |
| `DELETE /api/v1/solar/imports/{id}` | `200`, JSON met `deleted_analysis_runs`; `404` als het profiel niet bestaat | Profiel met intervallen en alle berekeningen erop verwijderen, in één transactie |
| `GET /api/v1/solar/imports/{id}/capacity` | `200`, JSON met `points`, `periods`, `measured_periods` en `assumptions` | Bovengrens van via de accu zelf gebruikte zonnestroom per capaciteit (0–20 kWh), verliesvrij en zonder vermogensgrens, met de verdeling `households` |
| `POST /api/v1/solar/typical` | `201` (nieuw) of `200` (bestaand), JSON met `id`, `existing`, `filename`, `summary` | Geschat uurjaar uit jaartotalen opslaan als gemodelleerde import |
| `GET /api/v1/solar/typical` | `200`, JSON | Bronnen van de ingebakken profielvormen en PV-opbrengst per kWp per ligging |
| `GET /api/v1/analysis/costs` | `200`, JSON | 26 kostencategorieën, toelichtingen, gedateerde bronlinks en `estimates` (bronnen en bedragen voor kostenindicaties) |
| `POST /api/v1/analysis/runs` | `201`, JSON met `id` en `result` | Valideren, simuleren, vergelijken en met invoer opslaan |
| `GET /api/v1/analysis/runs` | `200`, JSON met `runs` | Laatste 100 analyses als samenvatting, nieuwste eerst: dezelfde vorm als een volledige run, maar alleen `input.request.parameters` met `objective`, `horizon_years`, `budget_eur` en `tariff.import_eur_per_kwh` (ontbrekend als de run ze niet heeft), `input.request.quote_basis.candidate_key` bij een herberekening uit een offerte, in `input.request.candidates` alleen de opties met een geprijsde accupost met bron `Offerte (totaalprijs inclusief btw)`, met `key` en alleen die post in `costs` (om je offerte uit Zelf doorrekenen te herkennen; ontbrekend als geen optie er een heeft), `input.profile`, `input.recalculated_from.run_id`, en in `result` `model_version`, `recommended_key`, alleen de `warnings` over een fictief of geschat profiel (met `FICTIEF` of `GESCHAT PROFIEL`) en per optie `key`, `name`, `npv_eur`, `within_budget`, `roi_pct`, `payback_years` en `first_year.self_consumption_pct` (zodat de lijst dezelfde accu bespreekt als de uitkomst; ontbrekend als de run ze niet heeft). Geen jaartabellen |
| `GET /api/v1/analysis/runs/{id}` | `200`, JSON; `404` als de berekening niet bestaat | Eén analyse met de volledige oorspronkelijke `input` en `result`, ook als ze niet bij de laatste 100 hoort |
| `DELETE /api/v1/analysis/runs/{id}` | `200`, JSON; `404` als de berekening niet bestaat | Eén berekening verwijderen; het profiel blijft staan |
| `POST /api/v1/analysis/runs/{id}/recalculate` | `201`, JSON met `id` en `result`; `404` als de berekening niet bestaat; `400` als de invoer niet meer past, het profiel weg is of het profiel een andere SHA-256 heeft | Dezelfde invoer opnieuw met het huidige rekenmodel als nieuwe berekening (titel met ‘ · huidig model’); de oude blijft staan. De nieuwe invoer krijgt `recalculated_from`: `run_id`, `title`, `model_version` en per optie de oude `break_even_investment_eur` |
| `POST /api/v1/locations/search` | `200`, JSON met `results` en `source` | Expliciet een Nederlands adres opzoeken bij PDOK |

De healthresponse is:

```json
{"status":"ok"}
```

Onbekende routes geven `404` met JSON:

```json
{"error":"not_found"}
```

Axum ondersteunt ook HEAD voor GET-routes. Niet-ondersteunde methoden op bestaande routes geven `405` met een `Allow`-header en `{ "error": "method_not_allowed", "message": … }`.

## Dossierinvoer

`POST /api/v1/candidates` accepteert JSON volgens `CandidateDraft` in `crates/storage/src/comparison.rs`. Identiteit bestaat uit fabrikant, product, modelcode, producttype en configuratienaam. De bronvelden bevatten titel, link (leeg voor interne handmatige bron), vindplaats, markt, optionele documentrevisie en publicatiedatum. `numbers`, `features` en `texts` zijn arrays van gecontroleerde codes. Een optionele productsamenvattingsgarantie en prijs kunnen worden toegevoegd.

Nieuwe bronclaims zijn `unreviewed`. Herhaalde invoer voor dezelfde identiteit maakt een nieuwe bron en entry; bestaande specificaties worden niet overschreven. Bij één ongeldige claim wordt het hele dossier teruggerold. De volledige Rust-domeinmodellen en opslagmethoden ondersteunen meer detail dan dit snelle invoercontract.

## Opwekbestanden

De drie uploadroutes accepteren `multipart/form-data` met één `file` en één optioneel `options`-veld dat JSON bevat. Gebruik voor `options` de velden van `ImportOptions` in `crates/server/src/solar_import.rs`. Alle velden hebben defaults; de browser toont de instellingen expliciet en vereist een gecontroleerde preview voor de bewaaractie. De API parseert en valideert bij bewaren opnieuw.

Belangrijkste opties: profiel, werkblad, kopregelindex (nul betekent eerste regel), kolomindexen vanaf nul, optionele aparte tijdkolom, eenheid, interval/cumulatief, periode, IANA-tijdzone, tijdstempelpositie, decimaalteken, datumvolgorde en beleid voor ontbrekende meetwaarden. Profielen zijn `generic`, `solaredge`, `enphase`, `sma`, `fronius` en `pvgis`. Met `consumption_source: "net_meter"` en `export_column` is de verbruikskolom netafname en de terugleverkolom netteruglevering; bruto verbruik wordt per interval `opwek + afname − teruglevering`. Standaard is `consumption_source: "gross"`. `production_extra_columns`, `consumption_extra_columns` en `export_extra_columns` (lijsten van hoogstens drie kolomindexen, standaard leeg) tellen per rij op bij de opwek-, verbruiks- of terugleverkolom, bijvoorbeeld afname in tarief 1 en tarief 2; elke kolom mag één keer meetellen. Met meterdata bevat `summary` ook `grid_import_kwh` en `grid_export_kwh` (gemeten netafname en teruglevering over het hele profiel).

`preview` en `imports` accepteren daarnaast samen een `meter_file` en `meter_options` (velden van `MeterOptions`: `import_column` en `export_column` in plaats van opwek en verbruik, met optioneel `import_extra_columns` en `export_extra_columns` voor kolommen per tarief die erbij optellen; verder dezelfde lees- en tijdinstellingen). Dan wordt het omvormerbestand gecombineerd met het meterbestand, zie [importafspraken](solar-import.md#omvormer--en-meterbestand-combineren). Het omvormerbestand mag dan geen verbruikskolom hebben. Een meterbestand inspecteren doe je met `inspect` en het meterbestand als `file`. `imports` accepteert ook een tekstveld `name` (1 tot 240 tekens, zonder spaties eromheen): de naam van het profiel in plaats van de bestandsnaam (of ‘omvormer + meter’). De bestandsnaam blijft dan bepalen hoe het bestand gelezen wordt (de extensie). De naam telt niet mee bij het herkennen van een eerder bewaard profiel: dezelfde bestanden met dezelfde instellingen geven `200` met `existing: true`, het bestaande ID en de naam waaronder het al stond, ook als je een andere naam opgeeft.

Dezelfde bestandsbytes met identieke geserialiseerde instellingen geven hetzelfde import-ID terug. De requestlimiet is 21 MiB inclusief multipart-overhead, genoeg voor een omvormer- en een meterbestand van elk maximaal 10 MiB; een te groot of onleesbaar formulier geeft een Nederlandse melding (400). Per bestand gelden maximaal 250.000 gegevensrijen en 200 kolommen, en bij een werkblad maximaal 5 miljoen cellen van de eerste tot de laatste gevulde cel. Lees [de importafspraken](solar-import.md) voor de betekenis van waarden en beperkingen.

## Geschat profiel en capaciteitscurve

`POST /api/v1/solar/typical` accepteert `{ "annual_consumption_kwh": 3500, "solar": { "orientation": "south", "annual_production_kwh": 4000, "peak_power_kwp": null } }`. Verbruik is bruto (100–100.000 kWh). `solar` is `null` zonder panelen; geef anders precies één van jaaropwek (1–100.000 kWh) of piekvermogen (0,1–100 kWp). Ligging is `south`, `south_east`, `south_west`, `east`, `west` of `east_west`. Optioneel geven `heat_pump_kwh` (0–30.000) en `ev: { "annual_kwh": 1500, "charging": "evening" }` (0–20.000 kWh; `evening`, `night` of `daytime`) aan welk deel van het jaarverbruik naar een warmtepomp en het thuisladen van een auto gaat; samen moeten ze minstens 100 kWh van het jaarverbruik overlaten. Het resultaat is een volledig uurjaar met `data_kind: modelled` en `generator: typical-nl-v1`; dezelfde invoer geeft hetzelfde import-ID, dan met `200`, `existing: true` en de bewaarde naam. Een analyse op zo’n profiel begint met de waarschuwing GESCHAT PROFIEL. Zie [keuzehulp](keuzehulp.md) voor bronnen en grenzen.

`GET /api/v1/solar/imports/{id}/capacity` vereist dezelfde aaneengesloten jaarreeks met bruto verbruik als een analyse en geeft per capaciteit `usable_capacity_kwh`, `battery_to_load_kwh`, `self_consumption_pct`, `self_sufficiency_pct` en `equivalent_cycles`. `measured_periods` telt de perioden met gemeten netafname en teruglevering, van `periods` in totaal; daar volgt de gelijktijdigheid de meter.

## Scenario-invoer en resultaten

`POST /api/v1/analysis/runs` accepteert `RunRequest` uit `crates/server/src/scenario_api.rs`. De modellen van `thuisaccu_core::analysis`, `finance` en `sizing` zijn de getypeerde veldcontracten. Onbekende JSON-velden worden geweigerd. Alle volgende groepen zijn verplicht:

| Veld | Contract |
| --- | --- |
| `title` | Niet leeg, maximaal 200 tekens |
| `solar_import_id` | Bestaande import met één aaneengesloten volledig jaar en bruto verbruik per interval |
| `site` | `address`, optioneel samen `latitude`/`longitude` binnen Nederland, optioneel `bag_id` |
| `parameters` | Startjaar, horizon, discontovoet, kostenindex, PV-afname, verbruiksgroei, doel, optioneel budget, tarieven en gevoeligheidspercentages |
| `candidates` | 1–50 kandidaten met unieke `key`, `name`, optioneel `configuration_id`, `battery`, `costs`, `financing`, `assumptions`, optioneel `warranty_stress` (`operating_life_years` 1–30, `annual_capacity_loss_pct` 0–20, `basis`; zie de [garantiestresstest](roi-model.md#garantiestresstest)) en optioneel `connection` (`plug`, `fixed` of `circuit`: stekkerbatterij in een stopcontact, vaste installatie of stekkerbatterij op een eigen groep). `connection` is alleen een label voor de weergave en verandert de uitkomst niet; in runs van vóór 26 oktober 2026 ontbreekt het |
| `costs_confirmed`, `technical_assumptions_confirmed`, `consumption_is_gross`, `production_is_ac` | Alle `true` voor een schatting met bevestigde kosten en meetgrenzen |

`objective` is `net_present_value`, `roi`, `payback` of `self_consumption`. `tariff` bevat `import_eur_per_kwh`, `export_eur_per_kwh`, `export_fee_eur_per_kwh`, `export_fee_bands`, `fixed_annual_eur` en `annual_price_change_pct`. Een staffel is `{ "up_to_kwh": 1000, "annual_eur": 120 }`; de laatste bovengrens moet `null` zijn. Optioneel is `export_variant`: `{ "label": "Geen vergoeding vanaf 2030", "from_calendar_year": 2030, "export_eur_per_kwh": 0, "export_fee_eur_per_kwh": 0.05 }`, met een beginjaar binnen de looptijd (op of na `start_year` en vóór `start_year + horizon_years`); later zou de variant gelijk zijn aan de basis. Optioneel is `load_variation`: `uniform` (standaard, zoals modelversie 1) of `households` (verbruik binnen iedere periode van 5 tot 60 minuten verdeeld volgens gemeten huishoudens, zie de [rekenmethode](roi-model.md#verbruik-binnen-een-meetperiode)); de interface stuurt `households`. Bedragen zijn all-in EUR zoals van toepassing op het scenario.

Optioneel staat naast `parameters` de lijst `load_changes` (hoogstens 10): extra verbruik vanaf 1 januari van een later jaar, bijvoorbeeld `{ "kind": "heat_pump", "from_calendar_year": 2028, "annual_kwh": 2500 }` of `{ "kind": "ev", "from_calendar_year": 2029, "annual_kwh": 2000, "charging": "night" }`. `kind` is `heat_pump` (1 tot en met 30.000 kWh) of `ev` (1 tot en met 20.000 kWh, met `charging` `evening`, `night` of `daytime`); het beginjaar ligt binnen de looptijd. De server verdeelt het jaartotaal over de meetperioden van het profiel met dezelfde vormen als het [geschatte profiel](keuzehulp.md); zie de [rekenmethode](roi-model.md#verandering-in-verbruik). Zonder veranderingen ontbreekt het veld in het opgeslagen verzoek.

Optioneel is ook `quote_basis`, de herkomst van een herberekening uit de offertecheck: `{ "run_id": 12, "title": "Keuzehulp: 5.500 kWh verbruik, 3.800 kWh opwek", "candidate_key": "c7", "break_even_investment_eur": 2450.5, "changes": [{ "field": "usable_capacity_kwh", "before": 10, "after": 9.3 }] }`. `candidate_key` moet een van de opties zijn, `changes` bevat 1 tot 9 velden: de technische velden van de accu (`usable_capacity_kwh`, `charge_power_kw`, `discharge_power_kw`, `ac_round_trip_efficiency_pct`, `standby_w`, `annual_capacity_loss_pct`, `operating_life_years`), de totaalprijs inclusief btw `upfront_eur` (som van de betaalde startposten vóór teruggaven) en het abonnement per jaar `subscription_eur` (0 zonder abonnement); en `break_even_investment_eur` mag `null` zijn. Bij een gewijzigde `upfront_eur` mag `price` erbij: `{ "total_eur": 8750, "terms": "fixed" | "subject_to_survey" | "unknown", "separate": ["installation"] }`, de totaalprijs uit de offerte, hoe vast die is en welke bestaande kostencategorieën apart bleven; zonder `upfront_eur` of met een onbekende categorie volgt `400`. Het veld rekent niet mee; het wordt met het verzoek bewaard zodat de uitkomst de oude grensprijs ernaast kan zetten. De waarden zelf staan gewoon in de optie.

Optioneel is ook `sizing_range`, het bereik van bruikbare capaciteit dat de keuzehulp bij het gekozen doel liet zien: `{ "label": "het zinvolle bereik voor ‘veel opbrengst per kWh accu’", "low_kwh": 3, "high_kwh": 3.5 }`. Een lege omschrijving (of langer dan 200 tekens) of grenzen buiten 0 ≤ `low_kwh` ≤ `high_kwh` ≤ 1000 geven `400`. Het veld rekent niet mee; de uitkomst zegt ermee of de aanbevolen accu binnen dat bereik valt.

Optioneel is `bill_totals`, netafname en teruglevering volgens de jaarafrekening als de keuzehulp het profiel daaruit schatte: `{ "grid_import_kwh": 2400, "grid_export_kwh": 1900 }`. Waarden buiten 0 tot 1.000.000 kWh geven `400`, onbekende velden `422`. Het veld rekent niet mee; de uitkomst vergelijkt de teruglevering ermee met die van het geschatte profiel zonder accu.

`battery` bevat `usable_capacity_kwh`, `charge_power_kw`, `discharge_power_kw`, `ac_round_trip_efficiency_pct`, `standby_w`, `annual_capacity_loss_pct` en `operating_life_years`. Capaciteit is intern bruikbaar, vermogens zijn werkelijk AC-vermogen. Technische invoer en herkomst worden per kandidaat vastgelegd; een catalogus-ID is een verwijzing en bewijst geen geschiktheid.

`costs` bevat elke sleutel uit `/api/v1/analysis/costs` precies één keer. Iedere regel bevat `category`, `status` (`priced`, `included`, `not_applicable`; `unknown` blokkeert), `amount_minor` (gehele niet-negatieve eurocenten), `timing` (`upfront`, `annual`, `event`), `year` (`null` behalve geprijsde gebeurtenissen), `source` en `notes`. Een geprijsde gebeurtenis vereist jaar 1 t/m horizon en vindt op het jaareinde plaats. Alleen geprijsde accuvervanging herstart de techniek. `financing` bevat `loan_amount_eur`, `annual_interest_pct`, `years`; geen lening is bedrag nul. De lening mag de netto startinvestering niet overschrijden en moet binnen de horizon lopen.

De rekenkern bepaalt energiestromen per meetperiode en projecteert jaarlijkse rekeningen en extra kasstromen. `result` bevat `model_version`, `recommended_key`, `recommendation`, `baseline_first_year`, `candidates` en `warnings`. Iedere kandidaat bevat onder meer NPV, ROI, nettowinst, blijvende en gedisconteerde terugverdientijd, kosten/besparing, jaarlijkse resultaten en twee gevoeligheidsvarianten. `recommended_key: "no_battery"` betekent dat geen accu onder dit criterium beter scoort. Alleen met `export_variant` bevat het resultaat `export_variant_recommended_key` en iedere kandidaat `export_variant` (`npv_eur`, `net_profit_eur`, `roi_pct`, `payback_years`); oudere runs hebben deze velden niet. Een kandidaat met `warranty_stress` in de invoer krijgt in het resultaat `warranty_stress` met dezelfde velden plus `break_even_investment_eur`; in runs van vóór 26 oktober 2026 ontbreekt het. Ieder jaar in `years` bevat naast `energy` (met accu) ook `baseline_grid_import_kwh` en `baseline_grid_export_kwh` zonder accu; in runs van vóór 26 oktober 2026 zijn die `null`. De [rekenmethode](roi-model.md) definieert formules en beperkingen.

De opgeslagen `input` bevat `request`, `profile` (importmetadata), `profile_sha256` en de kostenonderzoeksdatum. Resultaten worden niet automatisch aangepast als de catalogus of editor verandert. De API bewaart een nieuwe rij per geslaagde analyse; een ongeldige analyse wordt niet opgeslagen. Een fictief profiel uit een oudere database (`is_demo`) wordt in iedere afgeleide analyse als FICTIEF gemarkeerd.

## Adresopzoeken

`POST /api/v1/locations/search` accepteert `{ "query": "Binnenhof 1 Den Haag" }` met 4–200 bytes na trimmen. De server (in de browserversie: de webworker, rechtstreeks en zonder cookies of referrer) stuurt die zoekterm naar de vaste HTTPS-PDOK-host, beperkt tot vijf adresresultaten. Ieder resultaat heeft `address`, `latitude`, `longitude`, `bag_id`. Er worden geen energieprofielen meegestuurd. Timeout: 10 seconden; geen redirects; maximaal 1 MB antwoord. De browser vereist een expliciete zoekactie en resultaatkeuze. Handmatig adresgebruik blijft mogelijk als PDOK niet beschikbaar is. Een adres levert geen automatische aansluiting, tarief of PV-schatting.

## Fouten en grenzen

De lokale server beantwoordt alleen verzoeken met een `Host` die een IP-adres of `localhost` is, en een `POST` of `DELETE` met een `Origin` alleen als die van dezelfde host komt; anders volgt `403` met `error: forbidden`. Zo kan een andere website via DNS-rebinding of een formulier geen gegevens lezen of wijzigen. De browserversie heeft geen netwerkpoort en deze controle niet.

Inhoudelijk ongeldige invoer geeft `400` met `error: invalid_input` (catalogus/import; bij een tijdstip dat in de gekozen tijdzone door de klokwissel niet of dubbel bestaat `clock_change`, of `meter_clock_change` als het om het meterbestand gaat, zodat de interface een andere tijdzone kan voorstellen) of `invalid_analysis` (scenario/adres) en een gebruikersmelding. Databasefouten geven `500` met `error: database_error`, een fout in Thuisaccu zelf tijdens rekenen of inlezen (een paniek) `500` met `error: internal_error` en een algemene melding; interne details blijven in de serverlog. In de browserversie start de rekenmodule na zo’n fout opnieuw met de laatst bewaarde database. Een verzoek dat axum al vóór de handler afwijst, houdt de statuscode van axum maar krijgt ook een JSON-antwoord met `error`, een Nederlandse `message` en de technische `detail`: `invalid_json` (`400` bij kapotte JSON, `422` bij een verkeerd veldtype of ontbrekend veld), `unsupported_media_type` (`415`, geen `application/json` of geen `multipart/form-data`), `too_large` (`413`), `invalid_path` (`400`, bijvoorbeeld een id dat geen getal is) en `invalid_input` (`400`, een onleesbaar uploadformulier). Een niet-ondersteunde methode geeft `405` met `error: method_not_allowed`.

De vergelijkingsroute levert alle catalogusclaims zonder paginering, bronselectie of automatische reviewfiltering; dit past bij de huidige lokale onderzoekscatalogus. De healthcheck is liveness en geen aparte database-readinesscheck. Browser en API gebruiken dezelfde oorsprong, zonder CORS-configuratie. Alle routes zijn voor lokaal gebruik; er is geen authenticatie. In de browserversie beantwoordt dezelfde router de routes in een webworker (`Local.fetch` in `web/local.js`); de webbestanden (`/`, `/*.js`, `/styles.css`) levert daar de statische site. Alleen adreszoeken gebruikt een externe dienst.

