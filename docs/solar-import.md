# Zonne-opwek importeren

De tool ondersteunt een gecontroleerde bestandsimport: upload, kolommen bekijken, interpretatie kiezen, preview controleren en pas daarna bewaren. Het bestand gaat naar de eigen Rust-server. Er worden geen accounts verbonden, API-sleutels gevraagd of bestanden naar een externe dienst doorgestuurd.

## Onderzochte exportopties

Onderzocht op 24 oktober 2026. We kiezen vier omvormerplatforms met gedocumenteerde exportmogelijkheden en daarnaast PVGIS voor gemodelleerde uurdata. Dit is een praktische selectie, geen marktaandeelranglijst.

| Importprofiel | Aanvoer en keuze | Ondersteuning in deze versie |
| --- | --- | --- |
| SolarEdge Monitoring | Installatieproductie uit Monitoring; bewaarde Site Energy JSON uit de Monitoring API | CSV/Excel via kolomkeuze; JSON `energy.values` met `date`/`value`, controle van `unit` en `timeUnit` |
| Enphase Enlighten | Reports, bijvoorbeeld Site Energy Production; Recent Power is een ander soort rapport | Tabulaire CSV/Excel met productie en optioneel verbruik; Wh/kWh of gemiddeld vermogen, instelbare Europese/VS-datumnotatie |
| SMA Sunny Portal | Energiebalans-export of Analysis Pro met geselecteerde PV-productie | CSV/Excel/ODS, lokale notatie, kopregels, 5-minutengemiddelden en geaggregeerde energie met expliciete periode |
| Fronius Solar.web | Productie- of energiebalansrapport | CSV/Excel, werkblad- en kolomkeuze, eventueel aparte datum- en tijdkolommen |
| PVGIS | Gemodelleerde uurproductie | Vlakke CSV/JSON en PVGIS 5 `outputs.hourly`, kolommen `time`/`P`, W, uur en UTC |

De profielen geven brongebonden exportuitleg en helpen kolommen herkennen. Portalen kennen meerdere versies, talen en rapporttypen; er is geen garantie dat ieder historisch exportformaat zonder aanpassing wordt ingelezen. We ondersteunen een tabel met één tijdstip per rij. Brede kruistabellen, losse paneelreeksen die eerst moeten worden opgeteld en aparte productie-/verbruiksbestanden worden nog niet automatisch gecombineerd. Exporteer daarvoor het installatietotaal of maak eerst een vlakke tabel.

SolarEdge documenteert in de [Monitoring API van maart 2026](https://knowledge-center.solaredge.com/sites/kc/files/se_monitoring_api.pdf) energie-eenheden, aggregatieperioden en lokale installatietijden. `null` betekent ontbrekende data, geen nul. De import controleert de opgegeven JSON-eenheid en periode en laat ontbrekende meetwaarden alleen na een expliciete instelling overslaan. Dit is bestandsimport, geen live API-koppeling.

De [Enphase troubleshooting guide](https://enphase.com/sites/default/files/2025-08/Enphase-solar-troubleshooting-guide-ING-00061-2.0-EN-INT-2025-08-14.pdf) beschrijft productierapporten, recente vermogensrapporten en verbruiksrapporten. Houd die grootheden uit elkaar. Verbruik is alleen bruikbaar wanneer dit daadwerkelijk gemeten en voor dezelfde intervallen beschikbaar is.

[SMA Sunny Portal](https://www.sma.de/en/products/energy-management/sunny-portal) beschrijft in de release van september 2026 aparte CSV-exports voor geaggregeerde energie en intraday-vermogen. De [Analysis Pro-exportbeschrijving](https://files.sma.de/downloads/EDMM-GMS-logging-TI-en-11.pdf) toont 5-minutengemiddelden. Selecteer productie; netteruglevering is niet gelijk aan zonne-opwek.

Fronius documenteert [Solar.web-productierapporten](https://www.fronius.com/~/downloads/Solar%20Energy/Whitepaper/SE_WP_Fronius_RGM_Guide_GEN24_Customer_EN.pdf) en [CSV/XLS-export](https://www.fronius.com/de-de/germany/solarenergie/installateure-partner/infocenter/blog/update-fronius-solarweb-neue-funktionen-150618). Toegang tot rapporten kan afhangen van account en abonnement. De import bewaart productie als opwek; import en export van het elektriciteitsnet zijn andere meetreeksen.

[PVGIS 5](https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/api-non-interactive-service_en) levert onder meer CSV en JSON. Het profiel voor de oude uur-JSON gebruikt `time` en `P`. Dit is gemodelleerde opwek. [PVGIS 6](https://photovoltaic-geographic-information-system.ec.europa.eu/api/v6/redoc) heeft andere uitvoerstructuren; willekeurige geneste PVGIS 6 JSON wordt nog niet automatisch afgevlakt.

## Formaten en grenzen

- CSV, TSV of TXT in UTF-8, met optionele BOM. Scheiding: komma, puntkomma of tab. Het aantal regels vóór de kopregel is instelbaar.
- XLSX, XLS en ODS via Calamine. Kies een werkblad en kopregel. Een XLSX-voorbeeld met echte Excel-datumcellen is meegeleverd en getest. Formules worden niet berekend; gebruik een export met opgeslagen waarden.
- JSON: array van objecten, `data`-array, SolarEdge `energy.values` of PVGIS 5 `outputs.hourly`. Ontbrekende velden worden als ontbrekend behandeld, niet als nul.
- Maximaal 10 MB, 250.000 gegevensrijen en 200 kolommen. Dit biedt ruimte voor een jaar met 5-minutenwaarden. PDF, afbeeldingen, ZIP-bundels en niet-tabulaire rapporten worden niet uitgelezen.

De fictieve voorbeeldbestanden [CSV](../crates/server/resources/solar-example.csv), [JSON](../crates/server/resources/solar-example.json) en [XLSX](../crates/server/resources/solar-example.xlsx) staan in de repository als testfixtures. De voorbeeldbestanden zijn geen echte huishoudgegevens. Het XLSX-voorbeeld gebruikt naïeve UTC-datums; de CSV/JSON-voorbeelden bevatten expliciete offsets.

## Interpretatie en controles

1. Kies datum/tijd, productie en optioneel verbruik. Bij gescheiden datum en tijd kies je een tweede tijdkolom. Gebruik bruto zonneproductie; een P1-netexportkolom is daarvoor onvoldoende.
2. Kies energie in Wh/kWh of gemiddeld vermogen in W/kW. Vermogen wordt vermenigvuldigd met de duur van de meetperiode. Piek- en losse momentwaarden zijn daarvoor ongeschikt.
3. Kies intervalopbrengst of cumulatieve meterstanden. Cumulatieve standen worden van elkaar afgetrokken; de eerste is alleen een beginstand. Een reset of daling stopt de import. Intervallen volgen dan de werkelijke tijd tussen standen.
4. Kies periode en begin-/eindpositie van tijdstempels. Ondersteund zijn 5, 10, 15, 30 minuten, uur, dag, week, maand en jaar. Kalenderperioden respecteren de gekozen tijdzone. Grove totalen worden niet tot een uurprofiel omgevormd.
5. Kies IANA-tijdzone en de volgorde van niet-ISO datums. ISO-tijdstippen met offset leggen het absolute tijdstip vast. Ambigue of niet-bestaande lokale zomertijdstippen worden geweigerd; gebruik dan een expliciete offset. Naïeve datums krijgen geen stilzwijgend Nederlands tijdzonemodel.
6. Kies decimale punt of komma. Duizendtalscheiding in tekstvelden wordt niet geraden. Getalwaarden uit Excel/JSON behouden hun numerieke betekenis. Ontbrekende waarden stoppen standaard de import. Bij expliciet overslaan vermeldt de preview het aantal overgeslagen rijen.

Dubbele tijdstippen, overlappende intervallen, negatieve energie, ongeldige getallen en meterresets veroorzaken een fout. Rijen worden op tijd gesorteerd. Gaten worden geteld en niet met nullen aangevuld. Bij cumulatieve standen is uitval binnen twee opeenvolgende standen niet vast te stellen. Maandtotalen worden aan de lokale startmaand van ieder interval toegewezen; grensoverschrijdende intervallen worden niet opgesplitst.

## Opslag en betekenis

Na bevestiging worden de SHA-256 van het bestand, bestandsnaam, importinstellingen, samenvatting en genormaliseerde intervallen transactioneel in SQLite bewaard. De ruwe bestandsinhoud wordt niet bewaard. Dezelfde bytes met dezelfde instellingen worden niet dubbel opgeslagen. De gebruiker kan bestaande samenvattingen opnieuw openen.

Het overzicht toont totale productie, eventuele consumptie, dekking, gaten en maandtotalen. Met verbruik worden ook positieve productie-/verbruiksverschillen per gekozen interval getoond. Dit zijn aggregaten op die resolutie, geen gemeten accubesparing of nauwkeurige momentane gelijktijdigheid.

## Slimme meter (P1)

Bevat één bestand per tijdstip de opwek, de netafname en de teruglevering, kies dan bij ‘Wat staat in die kolom?’ de optie netafname en daarnaast de terugleverkolom. Bruto verbruik is dan per interval opwek + netafname − teruglevering: alles wat het huis in kwam, minus wat eruit ging. Dat klopt alleen zonder bestaande accu en als omvormer- en meterdata dezelfde perioden beschrijven. Een negatief afgeleid verbruik telt alleen als meetafwijking als het klein is: per periode hoogstens gemiddeld 100 W (afgeronde tellerstanden, enkele seconden klokverschil) plus 5% van opwek + netafname in die periode, in hoogstens 1% van de perioden en samen hoogstens 1% van het afgeleide verbruik. Zulke afwijkingen worden op 0 gezet; aantal, totaal en grootste afwijking staan in de waarschuwingen en het totaal in `summary.clipped_consumption_kwh`. Is één van de grenzen overschreden, dan stopt de import met een melding over tijd, eenheid of een bestaande accu. Deze grenzen zijn een controleregel van de app, geen norm. Naast het bruto verbruik bewaart de import per interval de gemeten netafname en teruglevering; de scenariotool bepaalt daarmee hoeveel opwek en verbruik binnen het interval samenvielen ([rekenmethode](roi-model.md#gemeten-netafname-en-teruglevering)). Profielen van vóór 25 oktober 2026 missen die waarden; importeer hetzelfde bestand opnieuw met dezelfde instellingen om ze aan te vullen. Staan opwek en meterdata in aparte bestanden, gebruik dan de stap ‘Meter’ hieronder.

## Omvormer- en meterbestand combineren

Stap 3 van de importwizard accepteert naast het omvormerbestand (alleen opwek, zonder verbruikskolom) een tweede bestand met netafname en teruglevering, bijvoorbeeld een P1-export. Dat bestand krijgt eigen instellingen: tijdkolom(men), kolommen voor afname en teruglevering, eenheid, interval of cumulatieve standen, periode (5 minuten tot een uur), tijdzone, tijdstempelpositie, decimaalteken, datumnotatie en beleid voor ontbrekende waarden.

Beide reeksen worden opgeteld tot de grofste resolutie van de twee, op perioden die op hele 5, 10, 15, 30 of 60 minuten sinds 1970 UTC beginnen (voor Nederlandse tijd vallen kwartieren en uren daarmee samen). Een meetperiode die over zo’n grens heen loopt (bijvoorbeeld 10 minuten tegen een kwartier) stopt de import. Alleen perioden die in beide bestanden volledig gemeten zijn, worden gebruikt; de rest is een zichtbaar gat en wordt nooit met nullen gevuld. Daarna geldt dezelfde balans als hierboven: bruto verbruik = opwek + afname − teruglevering, met dezelfde grenzen voor negatieve uitkomsten.

Het profiel heet ‘omvormerbestand + meterbestand’. De instellingen van beide bestanden worden bewaard (`meter`, `meter_filename`, `combined_period`); de SHA-256 is berekend over de hashes van beide bestanden. Dubbele tarieven (normaal en dal) tel je vooraf op tot één kolom voor afname en één voor teruglevering.

## Geschat profiel uit jaartotalen

Zonder meetbestand kan de [keuzehulp](keuzehulp.md) een geschat uurjaar maken uit jaartotalen. Dat profiel is gemodelleerd en draagt overal het label GESCHAT PROFIEL.

De aparte [ROI-tool](roi-model.md) gebruikt een bewaarde import met een volledig aaneengesloten jaar, intervallen van maximaal een uur, AC-zonneproductie en bruto huishoudelijk verbruik. Netafname is alleen het resterende verbruik na directe zonnestroom; invoeren als bruto verbruik zou de accubesparing vertekenen. Wanneer alleen netmetingen en productie beschikbaar zijn, moeten eerst correct uitgelijnde bruto verbruikswaarden worden bepaald. De huidige import voegt losse bestanden niet automatisch samen. Grove of korte overzichten blijven bruikbaar voor onderzoek, maar worden voor ROI geweigerd.
