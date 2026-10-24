# Nederlandse scenariovergelijking en kostenonderzoek

Modelversie `nl-self-consumption-v1`, bronnen gecontroleerd op 24 oktober 2026. De tool vergelijkt opgegeven accu-uitvoeringen met dezelfde woning zonder accu. Het resultaat is een schatting op basis van opgegeven gegevens. De strategie is eigen zonnestroom bewaren voor later huishoudelijk gebruik, met vaste all-in tarieven.

## Invoer en adres

Gebruik één volledig, aaneengesloten meetjaar van 365 of 366 dagen. Iedere periode bevat AC-zonneproductie en bruto huishoudelijk verbruik, in dezelfde tijdsintervallen. De rekenkern accepteert intervallen van één minuut tot één uur, met maximaal 110.000 intervallen; de importinterface biedt onder meer vijfminuten-, kwartier- en uurdata. Korte reeksen, gaten, dagtotalen en ontbrekend verbruik worden voor ROI geweigerd. Jaarwaarden bepalen de gelijktijdigheid onvoldoende. Er wordt niet automatisch opgeschaald of aangevuld.

Bruto huishoudelijk verbruik is de totale vraag van het huis vóór aftrek van rechtstreeks gebruikte zonnestroom. Een P1-importkolom geeft alleen netafname. Gebruik ook geen netteruglevering als productie. Profielen van een installatie met een bestaande accu moeten eerst naar de bedoelde situatie zonder die accu worden herleid. Meetresolutie blijft een beperking: uurdata kan korte pieken en verliezen binnen het uur missen. De simulatie behandelt energie binnen iedere periode als gelijkmatig verdeeld.

Zonder meetbestand kan de [keuzehulp](keuzehulp.md) een geschat uurjaar uit jaartotalen maken (standaardprofiel E1A 2026 en een PVGIS-weerjaar). Dat profiel voldoet formeel aan bovenstaande eisen, maar is een gemiddelde over veel huishoudens: korte pieken ontbreken en vermogensgrenzen knellen minder vaak dan in werkelijkheid. Iedere analyse daarop begint daarom met de waarschuwing GESCHAT PROFIEL. De rekenkern en `model_version` zijn hiervoor niet veranderd; de capaciteitscurve (`sizing::capacity_curve`) gebruikt dezelfde energiesimulatie met een verliesvrije accu zonder vermogensgrens en is geen onderdeel van de vergelijking.

Een Nederlands adres kan handmatig worden ingevoerd of expliciet met de [PDOK Locatieserver](https://www.pdok.nl/pdok-locatieserver) worden opgezocht. Alleen de zoekknop verstuurt de zoekterm naar PDOK. De gebruiker kiest een resultaat; adres, eventuele BAG-identificatie en coördinaten worden bij de analyse bewaard. Energiegegevens blijven op de eigen server. Het adres bepaalt niet automatisch de aansluiting, dakkenmerken, installatiemogelijkheden, tarieven of omvormercompatibiliteit. Die vereisen eigen gegevens en zo nodig een installateursofferte.

## Technische simulatie

Per tijdstap wordt zonnestroom eerst rechtstreeks aan de huishoudelijke vraag geleverd. Het resterende overschot kan laden, begrensd door AC-laadvermogen en resterende opslagruimte. Een tekort kan worden gedekt uit de accu, begrensd door AC-ontlaadvermogen en aanwezige lading. De rest komt uit het net; overblijvende productie wordt teruggeleverd.

Benodigde accugegevens:

| Gegeven | Betekenis in dit model |
| --- | --- |
| Bruikbare capaciteit, kWh | Interne opslag na toegestane ontlaaddiepte; DoD wordt niet opnieuw afgetrokken |
| Continu laad-/ontlaadvermogen, kW | Werkelijk vermogen aan de AC-zijde; geen schijnbaar vermogen in kVA |
| AC→AC round-trip-rendement, % | Laad- en ontlaadfactor zijn beide de wortel van dit rendement |
| Extra standby, W | Continu aanvullend AC-verbruik zolang de accu operationeel is; geef geen verlies tweemaal op |
| Capaciteitsverlies per jaar, % | Geometrische kalenderafname als expliciete aanname; geen cyclusafhankelijke curve |
| Technische gebruiksduur, jaren | Daarna stopt de accu, tenzij een betaalde accuvervanging is ingevoerd |

Laadtoestand begint leeg en loopt door naar het volgende projectiejaar. Een capaciteitsdaling kan aanwezige lading beperken; dat verlies wordt geregistreerd. Standby krijgt eerst resterende zonnestroom en anders netstroom. De accu voedt in deze versie het huishoudelijk tekort; standby wordt apart via AC afgenomen. Een accuvervanging vindt plaats aan het einde van het opgegeven jaar, wist de oude restlading en herstelt vanaf het volgende jaar dezelfde nominale techniek. Een omvormervervanging verandert de technische parameters niet. Restlading aan het einde van de horizon krijgt geen geldwaarde.

Het gemeten jaar wordt herhaald met instelbare jaarlijkse verandering van verbruik en PV-opwek. Ook een schrikkeljaar blijft bij herhaling even lang; er is geen kalender- of weermodellering. Startjaar is het eerste volledige exploitatiejaar, geen berekening van een gedeeltelijk installatiejaar. De standaardwaarden voor degradatie en levensduur zijn bewerkbare aannames, geen fabrikantvoorspelling of garantie.

De uitkomst bevat per jaar productie, vraag, direct gebruikte zonnestroom, acculading en -levering, netafname, teruglevering, standby, verliezen, begin-/eindlading, equivalente cycli en maximaal gemiddeld netafnamevermogen per meetperiode. Dit laatste is geen aansluitingsontwerp of gegarandeerde piekreductie.

Eigen gebruik is `(directe zonnestroom + acculevering aan huis) / PV-productie`. Verliezen en standby verhogen dit percentage niet. Zelfvoorziening is dezelfde nuttige zonnestroom gedeeld door de bruto huishoudelijke vraag. Het zijn verschillende kengetallen.

## Energietarieven en Nederland

Vanaf 1 januari 2027 stopt de salderingsregeling. Daarom gebruikt dit model vanaf 2027 apart betaalde netafname en vergoede teruglevering. In 2026 rekent het vereenvoudigd met jaarlijks gesaldeerde kWh en één vast afnametarief; een overschot krijgt de ingevoerde terugleververgoeding. Zie [Rijksoverheid](https://www.rijksoverheid.nl/themas/klimaat-milieu-en-natuur/energie-thuis/salderingsregeling).

Vanaf 2027 is de jaarrekening:

```text
netafname × all-in inkoopprijs
− netteruglevering × bruto terugleververgoeding
+ netteruglevering × terugleverkosten per kWh
+ toepasselijke jaarlijkse terugleverstaffel
+ ongewijzigde vaste contractkosten (API; valt weg in het verschil)
```

De gebruiker voert de contractprijzen en belastingen in; de tool leidt geen tarief af uit een adres. Het model bepaalt geen wettelijke minimumvergoeding uit het all-in tarief. Terugleverkosten per kWh en een staffel mogen alleen samen worden ingevoerd wanneer beide werkelijk verschuldigd zijn. Staffelgrenzen zijn inclusief; de laatste regel is onbegrensd. Een prijsverandering per jaar schaalt energietarieven en terugleverkosten, niet de ongewijzigde vaste contractkosten.

Besparing is elk jaar de rekening zonder accu min die met accu. Minder terugleververgoeding, laadverliezen en standby zijn daardoor al verwerkt; tel deze niet nogmaals als losse kosten. Bestaande zonnepanelen en bestaande vaste kosten zijn gelijk in beide situaties. Alleen extra vaste kosten door de accu worden aan de kostenopbouw toegevoegd.

## Alle te beoordelen kostenposten

Elke optie moet alle 26 categorieën beoordelen: bedrag, inbegrepen of niet van toepassing. Onbekend blokkeert de berekening. Per post is een offertebron of expliciete aanname verplicht. Een pakketprijs wordt één keer ingevoerd; inbegrepen onderdelen worden niet opnieuw opgeteld. Bedragen bevatten niet-teruggevraagde btw en worden als gehele eurocenten ingevoerd.

| Moment | Categorieën |
| --- | --- |
| Start | Accu/pakket, extra omvormer, EMS/meter/CT/gateway, noodstroomvoorziening, installatie/inbedrijfstelling, kabels/beveiliging/montage, groepenkast, aanpassing netaansluiting, schouw/keuring/toestemming, levering/voorrijden, overige start-/afsluitkosten, reserve voor onvoorzien |
| Jaarlijks | Abonnement/software, onderhoud/service, extra verzekering, extra vaste netbeheerkosten, extra contractkosten, fiscale administratie, btw privégebruik/extra belasting, overige extra jaarkosten |
| Toekomstig jaar | Omvormervervanging, accuvervanging, verwijdering/recycling |
| Aftrek | Bevestigde subsidie/korting, bevestigde btw-teruggave, expliciete restwaarde |

Dit zijn te onderzoeken kosten, geen verplichte toeslagen voor elk huishouden. Reserve is een begrotingskeuze. Noodstroom kan extra onderdelen vereisen, maar het model rekent geen financiële waarde toe aan vermeden stroomuitval. Bestaande dekking kan extra verzekeringspremie overbodig maken. Netverzwaring kan zowel eenmalige kosten als hogere jaarlijkse aansluitkosten geven.

Onderzochte Nederlandse prijsvoorbeelden laten zien waarom een accuprijs geen totaalprijs is:

| Bron, geraadpleegd 24 oktober 2026 | Gepubliceerd voorbeeld en toepassing |
| --- | --- |
| [Sessy](https://www.sessy.nl/vragen/wat-kost-een-sessy-thuisbatterij/) | 5 kWh €3.550, 10 kWh €5.500 incl. btw, exclusief installatie. Referentie voor hardware; geen offerte voor dit adres |
| [Batterij-Outlet installatiepakketten](https://www.batterij-outlet.nl/nl/installatie/pakketprijzen/) | Basis vanaf €1.349, uitgebreid vanaf €2.049 incl. btw; maatwerk/groepenkast apart. Voorbeeld van deze aanbieder, geen algemene marktprijs of standaardprijs voor elk merk |
| [Liander eenmalige tarieven 2026, revisie 1.1](https://www.liander.nl/-/media/files/tarieven/consument/2026/eenmalige-tarieven-stroom-2026-v11.pdf) | Van één naar drie fasen vanaf €368,77 incl. btw, onder voorwaarden. Controleer het eigen aansluitgeval en jaar |
| [Liander tarieven](https://www.liander.nl/tarieven) | Controleer ook het verschil in jaarlijkse vaste netbeheerkosten bij een zwaardere aansluiting |
| [Centraal Beheer opstalverzekering](https://www.centraalbeheer.nl/verzekeringen/opstalverzekering) | Voorbeeld van dekking voor een thuisbatterij. Eigen polis en eventuele extra premie controleren |

Deze voorbeelden worden niet stilzwijgend ingevuld. De keuzehulp en de knop ‘Vul open posten met indicaties’ zetten ze, met bron of benoemde aanname per post, pas na een expliciete gebruikersactie in een kostenregel; zie [keuzehulp](keuzehulp.md#kosten-en-indicaties). De werkelijke prijs hangt af van uitvoering, installateur, plaatsing, aansluiting en contract. Het kostencatalogusbestand bevat bronlinks, toelichtingen en onderzoeksdatum en is ook in de interface beschikbaar.

Btw-teruggave is voorwaardelijk; uitsluitend privégebruik geeft geen recht. Handelsgebruik, EMS, dynamisch contract en KOR zijn relevant. Btw over privégebruik en aangifte kunnen extra lasten veroorzaken. Daarom trekt de tool geen btw automatisch af. Zie [Belastingdienst](https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/content/thuisbatterij-btw). De tool bepaalt geen fiscaal recht of herzieningsberekening. Jaarposten lopen de volledige horizon; een tijdelijk fiscaal effect moet als expliciet begrote gebeurtenis via de API of als passende scenario-aanname worden vastgelegd. Handelsopbrengsten worden in dit model niet berekend.

## Geldstromen, ROI en vergelijking

Investering en directe teruggaven staan op tijdstip nul. Jaarlijkse extra kosten stijgen met de ingestelde kostenindex. Kosten voor een toekomstig jaar zijn het ingevoerde nominale bedrag op het einde van dat jaar; daar komt geen automatische inflatie bovenop. Alle exploitatiekasstromen worden voor disconteren op het jaareinde gezet. Een optionele annuïtaire lening voegt alleen rente toe; de hoofdsom zit al in de investering. Dit is economische projectvergelijking inclusief financieringskosten, geen liquiditeitsplanning of rendement op eigen vermogen.

```text
netto startinvestering = startkosten − directe bevestigde teruggaven
netto voordeel jaar t = energiebesparing − extra kosten − leningrente
nettowinst = som netto jaarvoordelen − netto startinvestering
ROI (%) = nettowinst / netto startinvestering × 100
NPV = −netto startinvestering + som(netto jaarvoordeel / (1 + discontovoet)^t)
```

ROI betreft de hele gekozen looptijd en is geen jaarlijks rendement. Bij nul startinvestering is ROI niet bepaald. Levensduurkosten zijn startinvestering plus extra jaarlijkse/toekomstige kosten en rente, na expliciete aftrekposten. Energiekosten staan afzonderlijk in de vergelijking.

De terugverdientijd is de eerste jaargrens waarna het cumulatieve resultaat tot het einde van de horizon niet meer negatief wordt. Een latere vervanging kan dus een eerdere schijnbare terugverdientijd ongeldig maken. Er wordt geen nauwkeurigheid tot maanden gesuggereerd. De API geeft ook de gedisconteerde terugverdientijd.

De gebruiker kiest het criterium:

- **NPV:** hoogste positieve netto contante waarde tegenover geen accu.
- **ROI:** hoogste positieve ROI over de horizon.
- **Terugverdientijd:** kortste blijvende terugverdientijd, met niet-negatieve NPV.
- **Eigen gebruik:** hoogste nuttig gebruikte fractie van de zonnestroom in jaar één. Dit mag financieel ongunstig zijn en wordt bij het resultaat vermeld.

Een optioneel budget begrenst de netto startinvestering; het is geen plafond voor alle latere kosten of bruto voorfinanciering. Geen accu blijft beschikbaar en wint bij onvoldoende financieel voordeel. Bij gelijke score blijft de eerdere optie gekozen. De tool kiest binnen de ingevoerde opties; het zoekt niet automatisch alle capaciteiten of producten op de markt af.

Gunstige en ongunstige varianten combineren de opgegeven afwijking in inkoop-/terugleverprijzen en kosten. De gunstige variant verhoogt de inkoopprijs, verlaagt de terugleververgoeding en verlaagt uitgaven; de ongunstige doet het omgekeerde. Bevestigde aftrekposten blijven gelijk. Dit zijn gevoeligheidstests, geen statistische betrouwbaarheidsbanden; bij negatieve tarieven of niet-standaard kasstromen hoeft de volgorde van de uitkomsten niet vanzelf gunstig/ongunstig te zijn.

### Terugleveringsvariant

Optioneel bevat `parameters.export_variant` een tweede set terugleverprijzen (`export_eur_per_kwh`, `export_fee_eur_per_kwh`) vanaf `from_calendar_year`. Voor die jaren rekent de kern de rekening met en zonder accu opnieuw met deze twee tariefdelen; al het andere blijft gelijk en er is geen prijs- of kostenstress. Per optie staat de uitkomst in `export_variant` (NPV, nettowinst, ROI, blijvende terugverdientijd) en `export_variant_recommended_key` geeft de beste optie volgens hetzelfde doel en budget. De basisuitkomst en de aanbeveling veranderen niet. Omdat bestaande velden hun betekenis houden en de nieuwe velden alleen verschijnen als de variant is opgegeven, blijft de modelversie `nl-self-consumption-v1`. Het referentiegeval in `crates/core/tests/analysis.rs` rekent een besparing van 0,22 €/kWh in 2027 en 0,35 €/kWh vanaf 2028 met de hand na.

## Opslag, controle en grenzen

Een analyse bewaart de volledige invoer, gebruikte importmetadata, SHA-256 van het genormaliseerde profiel, onderzoeksdatum, modelversie en resultaat in SQLite. De bronintervallen blijven gekoppeld via import-ID. Historie toont de oorspronkelijke invoer, onafhankelijk van de huidige editor. Een hash detecteert veranderingen maar is geen reservekopie van alle intervallen of een onveranderbaar auditlog.

De referentietests controleren energiebehoud, AC-verliezen, vermogensgrenzen, standby, degradatie, de tariefomslag in 2027, analytisch narekenbare NPV/ROI, financieringsrente, vervanging, keuzecriteria, budget en de optie geen accu.

Nog buiten de berekening vallen dynamische uur-/kwartierprijzen en optimale aansturing, netladen/handel, onbalansdiensten, fiscale automatisering, cyclusafhankelijke slijtage, temperatuur- en vermogensafhankelijke rendementscurves, variabele fysieke installaties en gegarandeerde back-upduur. Het model beoordeelt ook geen certificaten, vergunningplicht, fasebelasting of elektrische veiligheid voor een adres. Gebruik daarvoor de afzonderlijke productclaims en installateursgegevens.
