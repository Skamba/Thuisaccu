# Interfaceverbouwing en verificatie

Uitgevoerd op 24 oktober 2026, op Windows. De rekenkern, opslag, migraties, API-handlers en request-/responsecontracten zijn ongewijzigd. De serverwijzigingen voegen uitsluitend drie ingebouwde JavaScript-assets toe.

## Schermen

| Scherm | Wijziging |
| --- | --- |
| App-shell | Vaste navigatie, hashrouter met terug/vooruit, focus op de schermtitel, mobiele menuknop, service-/modelstatus en één toast-systeem. De marketing-hero is verwijderd. |
| Dashboard | KPI’s, aangepaste volgende stap, recente analyses/imports en lege toestanden met acties. |
| Accu’s | Compacte catalogus met zoek-/type-/fabrikantfilters; maximaal vier keuzes in de vergelijkingsbalk. Een vijfde keuze geeft een blijvende melding. Eigen accu/offerte via een dialoog met drie stappen. |
| Vergelijking | Sticky koppen en eigenschapkolom, inklapbare groepen, verschillen-/bekendfilter en CSV van de zichtbare rijen. Bronclaims blijven afzonderlijk zichtbaar. |
| Opwek & verbruik | Importlijst met metadata en onderbouwde ROI-status; vierstapswizard met voorbeeldrijen, gemarkeerde kolommen, dropzone/file-input, preview, bewaren en een detailscherm met SVG-maandgrafiek. |
| Scenario’s | Analyselijst; dupliceren uit oorspronkelijke invoer; vierstapswizard met gegroepeerde tarieven, optie-/techniek-/kostentabs, gegroepeerde kosten, voortgang en onbekendfilter. De drie bevestigingen blijven verplicht. Concepten staan alleen in browseropslag. |
| Resultaat | Aanbeveling en zes tabbladen: Overzicht, Kasstromen, Energie, Gevoeligheid, Invoer & aannames, Waarschuwingen. SVG-grafieken hebben focusbare waarden en tabellen. CSV en afdrukstijl zijn toegevoegd. FICTIEF en alle modelwaarschuwingen blijven zichtbaar. |
| Instellingen | Browsergebonden standaardaannames, licht/donker/systeem, dichtheid, privacy-/back-upuitleg en modelgrenzen. |

Nieuwe bestanden en assetroutes:

| Bestand | Route | Verantwoordelijkheid |
| --- | --- | --- |
| `web/ui.js` | `/ui.js` | Gedeelde presentatie, formattering, router, tabs, wizards en SVG-helpers |
| `web/workspace.js` | `/workspace.js` | Dashboard, lijsten, werkstromen en instellingen |
| `web/results.js` | `/results.js` | Resultaatdashboard, oorspronkelijke invoer en export |

Alle drie routes hebben een test in `crates/server/tests/http.rs`. De bestaande HTML-/stylesheettest blijft slagen. De hashschermen en overige verantwoordelijkheden staan in [architecture.md](architecture.md); het gebruik staat in de [README](../README.md).

## Controles

Alle volgende opdrachten eindigden met exitcode 0:

```text
PASS cargo fmt --all -- --check
PASS cargo clippy --workspace --all-targets --locked -- -D warnings
PASS cargo test --workspace --locked — 44 geslaagd, 0 mislukt
PASS cargo build --workspace --locked
PASS cargo doc --workspace --no-deps --locked
PASS node --check web/app.js
PASS node --check web/analysis.js
PASS node --check web/ui.js
PASS node --check web/workspace.js
PASS node --check web/results.js
PASS git diff --check
```

Aanvullend zijn vijftien groepen DOM-gedragstests uitgevoerd met jsdom tegen de echte lokale HTTP-server. De testhulpmiddelen en databases staan in een tijdelijke map buiten de repo; er zijn geen projectdependencies toegevoegd. De server is na de webwijzigingen opnieuw gebouwd en gestart.

```text
PASS leeg dashboard, formattering en lokale service
PASS referenties, vergelijking, verschillenfilter en CSV aanmaken
PASS bekendfilter verbergt onbekende prijzen/claims zonder claims te verwijderen
PASS eigen accu in drie stappen en veilige DOM-weergave
PASS CSV-importwizard, controle, bewaren en grafiek
PASS demo, vier scenariostappen, verplichte bevestigingen en zes resultaattabs
PASS dupliceren met oorspronkelijke invoer en nieuwe bevestigingen
PASS standaardaannames, thema en geen impliciete PDOK-aanroep
PASS onbekende route, focus op schermtitel en geen runtimefouten
PASS dupliceren behoudt techniek, centen, notities en financiering
PASS onbekende kosten blokkeren voortgang en krijgen gerichte focus
PASS onvolledig concept herstelt zonder bevestigingen over te nemen
PASS terug/vooruit en skiplink behouden route en focus
PASS vijfde vergelijkingskeuze geeft melding en behoudt vier keuzes
PASS uitgeschakelde browseropslag geeft defaults zonder crash
```

De tests bedienden de app met synthetische gegevens in een aanvankelijk lege tijdelijke SQLite-database. Een HTML-achtige productnaam werd als tekst weergegeven. Opgeslagen analyses werden vóór en na dupliceren/bewerken vergeleken en bleven identiek. Tabpijltjestoetsen en roving tabindex zijn als DOM-gebeurtenissen gecontroleerd. Er zijn geen runtimefouten in die testomgeving gemeld.

## Openstaande handmatige verificatie

De gevraagde echte browserronde is **niet afgetekend**. Computer Use stopte omdat de huidige Windows-browser-URL niet betrouwbaar kon worden vastgesteld voor de beleidscontrole. Die blokkade is niet omzeild.

Daarom blijven visuele controle op 1440, 1024 en 390 px, echte browserconsolecontrole, volledige toetsenbordbediening, hover-/focusweergave van tooltips, native bestandskeuze/downloads, drawerfocus en de afdruklay-out handmatig te controleren. DOM-tests controleren geen werkelijke pixels of horizontale pagina-overloop en vervangen deze ronde niet.

Er zijn geen functionele onderdelen bewust buiten de opdracht geplaatst. Enkele grenzen volgen uit het bestaande API-contract: de historie bevat maximaal de laatste 100 analyses, bron-ID’s zijn niet beschikbaar voor exacte brontelling, de actieve databaseconfiguratie wordt niet gepubliceerd en cumulatieve importmetadata bewijst niet altijd de maximale intervalduur. De interface benoemt deze grenzen en toont onbekend waar passend.
