# Architectuur

## Uitgangspunten

Een webapp voor onderzoek, productvergelijking en Nederlandse economische scenario's. SQLite bewaart bronclaims, geïmporteerde zonne-opwek met verbruik en analyses met hun invoer. De browser ondersteunt vergelijken, offertes, import en de keuze van een rekencriterium. De rekenkern simuleert eigen zonnestroom; marktregels en grenzen staan in het [ROI-model](roi-model.md).

## Onderdelen

- `thuisaccu-core`: onafhankelijke domeintypen voor productonderzoek. `sizing` simuleert energiestromen, `finance` berekent rekeningen en kasstromen, `analysis` valideert en vergelijkt kandidaten, doelen en gevoeligheidsvarianten.
- `thuisaccu-storage`: SQLx, ingebouwde SQLite-migraties, typed opslagmethoden, vergelijkingsleesmodel, atomische dossier-/opwekimports en bewaarde analyse-invoer/resultaten. Foreign keys en validatie staan ook in het schema.
- `thuisaccu-server`: Axum op Tokio, router met catalogus-state. CSV/Excel/JSON-import, Nederlandse PDOK-adreszoekfunctie en scenario-API zijn adapters. Bestandsparsing en simulatie draaien via `spawn_blocking`. Configuratie en proceslevenscyclus staan in de binary.
- `web/`: ingebouwde HTML, CSS en gewone JavaScript. De browser gebruikt de JSON API en geeft invoer weer met DOM-tekstmethoden. Er zijn geen frameworks of build-stappen.

### Webinterface

De vaste app-shell heeft Keuzehulp, Dashboard en Scenario’s bovenaan; een lege hash opent de keuzehulp. Accu’s, Opwek & verbruik en Instellingen staan als groep onderaan voor de (semi)statische gegevens, met de servicestatus daaronder. De toetsenbordvolgorde volgt deze indeling. De hashrouter gebruikt `#/dashboard`, `#/accus`, `#/accus/vergelijk`, `#/opwek`, `#/opwek/import`, `#/opwek/:id`, `#/scenarios`, `#/scenarios/nieuw`, `#/scenarios/:id` en `#/instellingen`. Onbekende hashes openen het dashboard; browsergeschiedenis blijft werken. Na een schermwissel krijgt de schermtitel focus. Op smalle schermen opent een menuknop dezelfde navigatie.

- `ui.js`: DOM-helpers, Nederlandse formatters (geld met vaste precisie en een echt minteken), toasts, hashrouter, toegankelijke tabbladen en steppers, en SVG-grafieken met onderliggende tabellen.
- `app.js`: bronclaims, catalogus, selectie/vergelijking, CSV-export, kandidaat-invoer en bestandsinspectie/preview/opslag.
- `analysis.js`: scenario-invoer en API-payloads, expliciete technische en kostenvalidatie, onveranderlijke historie, dupliceren en conceptsnapshots.
- `workspace.js`: dashboard en lijsten, vergelijkingsfilters, drie- en vierstapswizards, kostenvoortgang, contextuele hulp en browserinstellingen.
- `keuzehulp.js`: begeleide keuzehulp in gewone taal; maakt zo nodig een geschat profiel, toont de capaciteitscurve, leidt rekengegevens met zichtbare aannames af uit bronclaims en verstuurt een gewone analyse. Zie [keuzehulp](keuzehulp.md).
- `results.js`: resultaatdashboard met zes tabbladen, kasstromen, energie, gevoeligheid, oorspronkelijke invoer, alle waarschuwingen, CSV en afdrukweergave.

De interface biedt uitsluitend acties voor onderzoek, eigen imports en scenario’s. Demo-acties en downloadlinks voor fictieve importvoorbeelden staan niet in de interface. Bestaande fictieve imports en resultaten blijven herkenbaar als FICTIEF. De bestaande demo- en sample-API-routes blijven beschikbaar voor synthetische testgegevens.

Alle zes scripts en het stijlblad worden via `include_str!` uit de binary geserveerd. Elke assetroute heeft een HTTP-test. Nieuwe webwijzigingen vereisen opnieuw bouwen en starten. Er zijn geen externe fonts, scripts of grafiekdiensten. API- en gebruikersgegevens worden uitsluitend via tekst-/DOM-methoden ingevoegd.

De vergelijking houdt maximaal vier uitvoeringen vast. Filters veranderen alleen de presentatie en CSV-export; claims worden niet samengevoegd. Het aantal herkenbare bronnen is gebaseerd op unieke brontitel/URL-combinaties: de bestaande vergelijking-API levert geen bron-ID’s. De ROI-badge gebruikt uitsluitend importmetadata. Voor cumulatieve standen is de maximale intervalduur niet eenduidig beschikbaar; daarom blijft geschiktheid daar onbekend. De server blijft de volledige meetreeks valideren vóór elke analyse.

De scenariowizard bewaart onvolledige concepten, standaardaannames, thema en dichtheid in `localStorage`, steeds met `try/catch`. Zonder browseropslag werken de formulieren met de oorspronkelijke defaults. Concepten kunnen adresgegevens bevatten en zijn expliciet te verwijderen. Bevestigingen worden nooit uit een concept of gedupliceerde run overgenomen. Een geslaagde run verwijdert het concept en opent het opgeslagen resultaat; defaults veranderen nooit een bestaande run.

Resultaten gebruiken uitsluitend de bewaarde invoer en API-uitvoer. De grafiek van huishoudelijke dekking leidt het netdeel af uit bruto vraag minus direct gebruikte zonnestroom en acculevering. Totale netafname bevat daarnaast standby. De productiebalans benoemt een resterend deel als ‘Overig (o.a. standby)’; dit wordt niet als extra accuwinst voorgesteld. Gevoeligheidsbanden zijn modelvarianten, geen betrouwbaarheidsintervallen. Alle modelwaarschuwingen blijven bereikbaar, en FICTIEF staat ook boven het resultaat.

CSS-custom-properties ondersteunen licht, donker, systeemvoorkeur en dichtheid. Tabbladen gebruiken roving tabindex en pijl-/Home-/End-toetsen. Statusmeldingen zijn sluitbare toasts; succes verdwijnt automatisch, fouten blijven staan. Veldfouten gebruiken `aria-invalid` en gekoppelde hulptekst. Grafieken hebben focusbare waardemarkeringen en tabellen; kleur is nooit de enige informatiedrager.

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

