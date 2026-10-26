# Nederlandse scenariovergelijking en kostenonderzoek

Modelversie `nl-self-consumption-v6`, bronnen gecontroleerd op 24 oktober 2026. Versie 2 (25 oktober 2026) voegt de verdeling van het verbruik binnen een meetperiode toe; runs met versie 1 rekenden gelijkmatig binnen iedere periode. Versie 3 (25 oktober 2026) gebruikt per periode de gemeten netafname en teruglevering als die bij de import bekend zijn ([Gemeten netafname en teruglevering](#gemeten-netafname-en-teruglevering)); runs met versie 2 schatten de gelijktijdigheid binnen de periode ook dan met de verdeling. Versie 4 (26 oktober 2026) laat bij het doel ROI, net als bij de terugverdientijd, alleen opties met een niet-negatieve NPV winnen; runs met versie 3 konden een optie met positieve ROI maar negatieve NPV aanbevelen. Versie 5 (26 oktober 2026) telt een lening als rente en aflossing in het jaar waarin je ze betaalt, met alleen het eigen deel van de investering op tijdstip nul; runs met versie 4 zetten de hele investering op tijdstip nul en telden daarnaast de rente, waardoor een lening bij een discontovoet boven nul in geld van nu te duur uitkwam (bij € 5.000 over 10 jaar tegen 4% rente en 4% disconto ongeveer € 1.000). Nettowinst, ROI en levensduurkosten veranderen daardoor niet; NPV, terugverdientijd, het jaarlijkse netto voordeel en het cumulatieve verloop wel, alleen bij opties met een lening. Versie 6 (26 oktober 2026) berekent de terugverdientijd (ook gedisconteerd) over de investering zelf: de hele startinvestering op tijdstip nul, de leningrente als kosten en de aflossingen niet; runs met versie 5 rekenden met het kasverloop na lening, waardoor een volledig geleende accu ‘direct terugverdiend’ was zodra de besparing de aflossing dekte, en het doel terugverdientijd zo een geleende accu kon verkiezen boven een betere contante. Het jaarlijkse netto voordeel en het cumulatieve verloop blijven het geld dat je per jaar overhoudt, met de aflossing erin. Daarnaast wordt de startinvestering in de kostenvarianten niet meer negatief: teruggaven en subsidie schalen niet mee met de kosten en zijn begrensd op de kosten. Een accu die helemaal door teruggaven wordt betaald heeft geen ROI-getal, maar kan bij het doel ROI met een positieve NPV nu winnen. Alleen opties met een lening, subsidie of teruggave, of bij het doel ROI zonder startinvestering, krijgen een andere uitkomst. De tool vergelijkt opgegeven accu-uitvoeringen met dezelfde woning zonder accu. Het resultaat is een schatting op basis van opgegeven gegevens. De strategie is eigen zonnestroom bewaren voor later huishoudelijk gebruik, met vaste all-in tarieven.

## Invoer en adres

Gebruik één volledig, aaneengesloten meetjaar van 365 of 366 dagen. Iedere periode bevat AC-zonneproductie en bruto huishoudelijk verbruik, in dezelfde tijdsintervallen. De rekenkern accepteert intervallen van één minuut tot één uur, met maximaal 110.000 intervallen; de importinterface biedt onder meer vijfminuten-, kwartier- en uurdata. Korte reeksen, gaten, dagtotalen en ontbrekend verbruik worden voor ROI geweigerd. Jaarwaarden bepalen de gelijktijdigheid onvoldoende. Er wordt niet automatisch opgeschaald of aangevuld.

Bruto huishoudelijk verbruik is de totale vraag van het huis vóór aftrek van rechtstreeks gebruikte zonnestroom. Een P1-importkolom geeft alleen netafname. Gebruik ook geen netteruglevering als productie. Profielen van een installatie met een bestaande accu moeten eerst naar de bedoelde situatie zonder die accu worden herleid. Meetresolutie blijft een beperking: uurdata mist korte pieken. De simulatie verdeelt het verbruik binnen iedere periode daarom volgens gemeten huishoudens; zie [Verbruik binnen een meetperiode](#verbruik-binnen-een-meetperiode). Zijn netafname en teruglevering per periode gemeten, dan bepalen die hoeveel opwek en verbruik binnen de periode samenvielen.

Zonder meetbestand kan de [keuzehulp](keuzehulp.md) een geschat uurjaar uit jaartotalen maken (standaardprofiel E1A 2026 en een PVGIS-weerjaar). Dat profiel voldoet formeel aan bovenstaande eisen, maar is een gemiddelde over veel huishoudens: korte pieken en de verschillen tussen dagen ontbreken. Iedere analyse daarop begint daarom met de waarschuwing GESCHAT PROFIEL. De capaciteitscurve (`sizing::capacity_curve`) gebruikt dezelfde energiesimulatie, met dezelfde verdeling binnen het uur en dezelfde gemeten netwaarden, maar met een verliesvrije accu zonder vermogensgrens; zij is geen onderdeel van de vergelijking.

Het adres is optioneel en alleen een label bij de berekening; zonder adres staat er ‘Nederland (geen adres opgegeven)’. Een Nederlands adres kan handmatig worden ingevoerd of expliciet met de [PDOK Locatieserver](https://www.pdok.nl/pdok-locatieserver) worden opgezocht. Alleen de zoekknop verstuurt de zoekterm naar PDOK. De gebruiker kiest een resultaat; adres, eventuele BAG-identificatie en coördinaten worden bij de analyse bewaard. Energiegegevens blijven op de eigen server. Het adres bepaalt niet automatisch de aansluiting, dakkenmerken, installatiemogelijkheden, tarieven of omvormercompatibiliteit. Die vereisen eigen gegevens en zo nodig een installateursofferte.

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

### Verbruik binnen een meetperiode

Een uurwaarde van 1,1 kWh kan een uur van gelijkmatig 1,1 kW zijn, maar ook een kwartier koken op 3 kW en de rest van het uur 0,5 kW. Een accu met 800 W ontlaadvermogen dekt in het eerste geval 0,8 kWh, in het tweede veel minder. Omgekeerd ontstaan binnen een zonnig uur korte tekorten (waterkoker) en overschotten die een accu kan opvangen, terwijl het uurgemiddelde alleen een overschot laat zien. Met `parameters.load_variation: "households"` (de interface stuurt dit altijd mee) houdt de simulatie hier rekening mee:

- Iedere periode van 5, 10, 15, 30 of 60 minuten wordt opgedeeld in tien even lange delen. Het verbruik per deel is het periodegemiddelde maal een vaste factor, van laag naar hoog. De factoren hangen af van het gemiddelde vermogen in die periode (16 klassen van 0,07 tot ruim 6 kW, lineair geïnterpoleerd) en zijn gemiddelden over 74 huishoudens.
- Per deel gelden de gewone regels: zonnestroom eerst direct, dan laden tot het laadvermogen, tekort uit de accu tot het ontlaadvermogen. Laadtoestand, standby en verliezen worden daarna per periode verrekend, eerst laden en dan ontladen. De som van de delen is precies het verbruik van de periode. Die volgorde is een voorzichtige keuze: in een controle met een synthetisch huishouden per minuut (26 oktober 2026; uurmodel met de werkelijke verdeling van ieder uur, opwek binnen het uur gelijk) leverden accu's van 1 tot 10 kWh daarmee 3,1% minder tot 1,1% meer dan chronologisch per minuut; verweven laden en ontladen binnen het uur gaf 1,8% minder tot 3,1% meer.
- Een optioneel gelijkmatig deel van het verbruik per periode (`steady_consumption_kwh`, bijvoorbeeld warmtepomp en laadpaal in het keuzehulpprofiel) telt in ieder deel volledig mee; alleen het overige verbruik wordt verdeeld en bepaalt de klasse.
- Opwek blijft binnen de periode gelijkmatig. Andere perioden (bijvoorbeeld minuutdata) blijven gelijkmatig; daar zijn de pieken al grotendeels zichtbaar. Zonder het veld (runs van vóór modelversie 2) geldt `uniform`: gelijkmatig binnen de periode, zoals in modelversie 1.

Bron van de factoren: Tjaden, Bergner, Weniger en Quaschning, *Representative electrical load profiles of residential buildings in Germany with a temporal resolution of one second*, HTW Berlin, [dataset](https://solar.htw-berlin.de/elektrische-lastprofile-fuer-wohngebaeude/) onder CC BY-NC 4.0 ([documentatie](http://dx.doi.org/10.13140/RG.2.1.3713.1606/1)): 74 huishoudens, het jaar 2010, werkelijk vermogen per seconde, hier opgeteld over de drie fasen zoals een Nederlandse slimme meter saldeert. `tools/build_load_spread.py` maakt er `crates/core/src/load_spread.rs` van; alleen de gemiddelde factoren staan in de repository, de dataset niet.

Controle (eenmalig, 25 oktober 2026): per huishouden een volledige simulatie per seconde met een zonnestroomvorm uit PVGIS (De Bilt, zuid, jaaropwek gelijk aan het jaarverbruik), binnen het uur gelijkmatig, rendement 90%. Daarnaast dezelfde simulatie op uur- en kwartierbasis, met en zonder verdeling; de factoren kwamen bij die controle telkens van de andere helft van de huishoudens. Afwijking van de jaarlijkse vermindering van netafname door de accu ten opzichte van de simulatie per seconde, opgeteld over alle huishoudens:

| Accu (bruikbaar, ontladen) | Uur, gelijkmatig | Uur, verdeeld | Kwartier, gelijkmatig | Kwartier, verdeeld |
| --- | --- | --- | --- | --- |
| 2 kWh, 0,8 kW | −10,6% | −2,9% | −6,0% | −2,3% |
| 5 kWh, 0,8 kW | −4,2% | −0,7% | −2,2% | −0,7% |
| 10 kWh, 0,8 kW | +1,0% | +0,1% | +1,0% | +0,4% |
| 10 kWh, 2,5 kW | −5,3% | −1,3% | −2,9% | −1,2% |
| 10 kWh, onbegrensd | −7,4% | −2,4% | −4,5% | −2,0% |

Direct gebruikte zonnestroom zonder accu was op uurbasis 8,8% te hoog en verdeeld nog 2,7%. Bij twee keer zoveel opwek als verbruik liggen alle verdeelde afwijkingen tussen −2,5% en +0,3%. Het effect uit het kookvoorbeeld is zichtbaar: per seconde gerekend blijft een accu van 10 kWh met 800 W 14% achter bij dezelfde accu zonder vermogensgrens, op uurbasis maar 6%. Tegelijk komen er binnen het uur laad- en ontlaadmomenten bij die op uurbasis ontbreken. Daardoor ligt de uurwaarde voor een 800 W-accu als totaal toevallig dicht bij de werkelijkheid, maar wordt het verschil met krachtiger accu's onderschat. Zonder de huishoudens met een elektrische doorstroomverwarmer (meer dan 2% van het verbruik boven 8 kW) veranderen de uitkomsten minder dan 0,5 procentpunt.

Grenzen:

- Het geschatte keuzehulpprofiel blijft per huishouden onzeker: met de verdeling lag de accubesparing tussen −7,5% en +5,5% van de simulatie per seconde (zonder verdeling −16% tot +7,5%), en de direct gebruikte zonnestroom zonder accu blijft 13% tot 17% te hoog, omdat het standaardprofiel ook de verschillen tussen dagen uitmiddelt.
- Een accu reageert niet direct. Regelt de accu per seconde op de meting van enkele seconden eerder, dan daalt de besparing in dezelfde controle met ongeveer 2% (2 s), 3% (5 s) en 5% (10 s) voor 800 W, en iets meer voor krachtiger accu's. Ter vergelijking: de [Stromspeicher-Inspektion 2025](https://solar.htw-berlin.de/wp-content/uploads/HTW-Stromspeicher-Inspektion-2025.pdf) van HTW Berlin (hoofdstuk 2.5) mat bij 22 thuisaccusystemen in het lab gemiddeld 1 s totdat de accu reageert (totzeit, van onder 0,1 tot 5,9 s) en 4,5 s totdat het nieuwe vermogen bereikt is (einschwingzeit). Dat zijn vaste systemen van Duitse fabrikanten, geen stekkerbatterijen, en voor de producten in de catalogus zijn geen regelsnelheden bekend. De vertraging is daarom niet in de berekening opgenomen; de waarschuwing bij iedere run noemt de orde van grootte.
- Het zijn Duitse huishoudens uit 2010 zonder warmtepomp of laadpaal. In het geschatte keuzehulpprofiel staan warmtepomp en laden apart als gelijkmatig deel (`steady_consumption_kwh`); alleen de rest wordt verdeeld. In een gemeten import is dat onderscheid onbekend en wordt alles verdeeld; voor een accu van 1 tot 4 kW in uren met een laadsessie is dat iets te voorzichtig.
- Wolken laten de opwek binnen het uur schommelen. Dat is niet meegenomen en zou de wisselingen tussen overschot en tekort verder vergroten.

### Gemeten netafname en teruglevering

Een import met P1-netafname en -teruglevering (‘netafname’ met terugleverkolom, of een apart meterbestand) bewaart per periode naast het afgeleide bruto verbruik ook de gemeten `measured_import_kwh` en `measured_export_kwh` van de situatie zonder accu. Daaruit volgt de gelijktijdigheid binnen de periode, die de verdeling hierboven alleen schat. Gelijkmatig binnen de periode is direct gebruik `min(opwek, verbruik)`; werkelijk was het `opwek − teruglevering`. Het verschil is `min(netafname, teruglevering)`: zonnestroom die in hetzelfde uur eerst werd teruggeleverd terwijl het verbruik later (of eerder) van het net kwam. Per periode rekent de simulatie dan met

- overlap `k = min(netafname, teruglevering) × min(PV-factor, verbruiksfactor)`, begrensd tot `min(opwek, verbruik)`;
- direct gebruik `min(opwek, verbruik) − k`, overschot `max(opwek − verbruik, 0) + k` en tekort `max(verbruik − opwek, 0) + k`.

Zonder accu en zonder groei of degradatie geeft dat precies de gemeten netafname en teruglevering. De factoren schalen de overlap met de kleinste van beide, omdat minder opwek of verbruik niet meer gelijktijdigheid oplevert. Welk deel van overschot en tekort binnen het laad- en ontlaadvermogen valt, is niet gemeten; daarvoor geldt dezelfde verhouding als in de verdeling (of gelijkmatig met `uniform`), begrensd door het vermogen maal de duur. De meter laat niet zien in welke volgorde overschot en tekort binnen de periode vielen; de simulatie laadt eerst en ontlaadt dan, zoals in iedere periode.

Voorbeeld (referentiegeval in `crates/core/tests/analysis.rs`): een uur met 2 kWh opwek, 2 kWh verbruik, 0,5 kWh netafname en 0,5 kWh teruglevering. Zonder accu is direct gebruik 1,5 kWh, met netafname en teruglevering van 0,5 kWh. Een verliesvrije accu met 1 kW laadvermogen laadt de 0,5 kWh en levert die in hetzelfde uur terug. Met halve opwek is de overlap 0,25 kWh: direct 0,75 kWh, teruglevering 0,25 kWh en netafname 1,25 kWh.

Het verschil met de verdeling kan groot zijn: de verdeling is een gemiddelde van Duitse huishoudens, en een huishouden met minder wisselingen tussen overschot en tekort binnen het uur krijgt daarmee een te hoge accuopbrengst. Imports van vóór deze versie hebben de meterwaarden niet; opnieuw importeren met dezelfde instellingen vult ze aan in hetzelfde profiel. Een run vermeldt in een waarschuwing in hoeveel perioden de meterwaarden zijn gebruikt.

### Verandering in verbruik

Een warmtepomp of elektrische auto die er pas later bij komt, is een `load_changes`-regel in het verzoek: soort, beginjaar en extra kWh per jaar (met laadmoment voor een auto). De server zet die om in kWh per meetperiode met de vormen van het [geschatte profiel](keuzehulp.md): voor de warmtepomp 66% naar rato van de graaduren onder 18 °C in De Bilt (2023) en 34% gelijkmatig voor warm tapwater, voor de auto elke dag hetzelfde laadblok van 3,68 kW vanaf het gekozen uur. Elke meetperiode krijgt de waarde van het lokale uur (maand, dag, uur; 29 februari volgt 28 februari) maal de duur van de periode, en het geheel wordt geschaald naar het opgegeven jaartotaal. De rekenkern telt die kWh vanaf 1 januari van het beginjaar op bij het bruto verbruik, als gelijkmatig verbruik binnen de periode (net als warmtepomp en laden in het geschatte profiel), en daarna met dezelfde jaarlijkse verbruiksverandering als de rest van het huis. Een verandering in het startjaar hoort in het profiel zelf; het beginjaar ligt daarom na het startjaar en binnen de looptijd.

In perioden met extra verbruik beschrijven de gemeten netafname en teruglevering het huis niet meer; daar schat de simulatie de gelijktijdigheid weer met de verdeling, en een waarschuwing noemt vanaf welk jaar. Bij beide soorten noemt een waarschuwing het label, het beginjaar en het jaartotaal. Ieder jaar in de uitkomst bevat ook de netafname en teruglevering zonder accu (`baseline_grid_import_kwh`, `baseline_grid_export_kwh`), zodat de besparing van het eerste jaar met de verandering na te rekenen is als minder netafname × stroomprijs min minder teruglevering × (vergoeding − terugleverkosten), beide maal de prijsfactor van dat jaar. Een warmtepomp met een lager rendement bij vorst en wisselende laadmomenten zijn niet meegenomen, net als in het geschatte profiel.

Dit veranderde de betekenis van bestaande uitkomsten niet: zonder `load_changes` rekent het model precies als eerder, dus de modelversie bleef `nl-self-consumption-v5`.

Referentiegevallen: `extra_load_from_a_later_year_counts_only_from_that_year` in `crates/core/tests/analysis.rs` (1 kWh extra in ieder productie-uur vanaf jaar 2 halveert de besparing in dat jaar) en `heat_pump_and_ev_from_a_later_year_are_added_only_from_that_year` in `crates/server/tests/scenario_api.rs`.

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

Alle bedragen zijn lopende euro's en de discontovoet is een gewone (nominale) rente, met inflatie erin. De standaardaannames in de interface laten energieprijzen daarom even hard meestijgen als de jaarkosten: 2% per jaar, het inflatiedoel van de ECB. De energiebelasting, een groot deel van de stroomprijs, wordt elk jaar per 1 januari met de tabelcorrectiefactor voor inflatie gecorrigeerd (artikel 90 Wet belastingen op milieugrondslag). Met 0% prijsverandering en 4% disconto zou stroom elk jaar goedkoper worden ten opzichte van al het andere en kwam een accu stelselmatig te slecht uit. Bewaarde runs houden de aanname waarmee ze zijn gerekend.

Vanaf 2027 en zonder staffel is het netto voordeel lineair in de netto terugleverwaarde (vergoeding min terugleverkosten), wat het referentiegeval `npv_is_linear_in_the_net_export_value_from_2027_as_the_interface_assumes` vastlegt. De uitkomst gebruikt dat voor ‘Ook je contract telt’: 1 cent per kWh meer netto terugleverwaarde maakt de rekening zonder accu in jaar 1 lager met de teruglevering zonder accu × € 0,01, en het netto voordeel van de accu lager met de gedisconteerde som van (teruglevering zonder accu − teruglevering met accu) × € 0,01 per jaar, met de prijsverandering erin. Dat volgt uit de bewaarde jaarcijfers, zonder opnieuw te rekenen.

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
| [Homedeal: kosten elektriciteit aanleggen](https://homedeal.nl/elektricien/elektriciteit-aanleggen-kosten/), geraadpleegd 25 oktober 2026 | ‘Aanbrengen extra groep met aansluiting’ €280 incl. materiaal, montage en btw. Richtprijs voor een stekkerbatterij op een eigen groep; geen offerte, een volle groepenkast komt erbij |
| [Liander eenmalige tarieven 2026, revisie 1.1](https://www.liander.nl/-/media/files/tarieven/consument/2026/eenmalige-tarieven-stroom-2026-v11.pdf) | Van één naar drie fasen vanaf €368,77 incl. btw, onder voorwaarden. Controleer het eigen aansluitgeval en jaar |
| [Liander tarieven](https://www.liander.nl/tarieven) | Controleer ook het verschil in jaarlijkse vaste netbeheerkosten bij een zwaardere aansluiting |
| [Centraal Beheer opstalverzekering](https://www.centraalbeheer.nl/verzekeringen/opstalverzekering) | Voorbeeld van dekking voor een thuisbatterij. Eigen polis en eventuele extra premie controleren |

Deze voorbeelden worden niet stilzwijgend ingevuld. De keuzehulp en de knop ‘Vul open posten met indicaties’ zetten ze, met bron of benoemde aanname per post, pas na een expliciete gebruikersactie in een kostenregel; zie [keuzehulp](keuzehulp.md#kosten-en-indicaties). De werkelijke prijs hangt af van uitvoering, installateur, plaatsing, aansluiting en contract. Het kostencatalogusbestand bevat bronlinks, toelichtingen en onderzoeksdatum en is ook in de interface beschikbaar.

Btw-teruggave is voorwaardelijk; uitsluitend privégebruik geeft geen recht. Handelsgebruik, EMS, dynamisch contract en KOR zijn relevant. Btw over privégebruik en aangifte kunnen extra lasten veroorzaken. Daarom trekt de tool geen btw automatisch af. Zie [Belastingdienst](https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/content/thuisbatterij-btw). De tool bepaalt geen fiscaal recht of herzieningsberekening. Jaarposten lopen de volledige horizon; een tijdelijk fiscaal effect moet als expliciet begrote gebeurtenis via de API of als passende scenario-aanname worden vastgelegd. Handelsopbrengsten worden in dit model niet berekend.

## Geldstromen, ROI en vergelijking

Investering en directe teruggaven staan op tijdstip nul. Jaarlijkse extra kosten stijgen met de ingestelde kostenindex. Kosten voor een toekomstig jaar zijn het ingevoerde nominale bedrag op het einde van dat jaar; daar komt geen automatische inflatie bovenop. Alle exploitatiekasstromen worden voor disconteren op het jaareinde gezet. Een optionele annuïtaire lening (bij 0% rente gelijke aflossingen) verschuift het geleende deel van de investering naar de jaren waarin je aflost, en voegt de rente toe als kosten. Zo telt de discontovoet de lening niet dubbel: een lening tegen een rente gelijk aan de discontovoet laat de NPV ongewijzigd, een goedkopere lening verbetert hem. De lening loopt hoogstens tot het einde van de horizon, dus de aflossingen tellen samen op tot het leenbedrag en nettowinst en ROI zijn hetzelfde als bij volledig vooruit betalen min de rente. Dit is een projectvergelijking inclusief financieringskosten, geen liquiditeitsplanning of rendement op eigen vermogen.

```text
netto startinvestering = startkosten − directe bevestigde teruggaven
eigen deel op tijdstip nul = netto startinvestering − leenbedrag
netto voordeel jaar t = energiebesparing − extra kosten − leningrente − aflossing
nettowinst = som netto jaarvoordelen − eigen deel op tijdstip nul
ROI (%) = nettowinst / netto startinvestering × 100
NPV = −eigen deel op tijdstip nul + som(netto jaarvoordeel / (1 + discontovoet)^t)
```

**Lonend bij een startinvestering** (`break_even_investment_eur`) is de hoogste netto startinvestering waarbij de NPV nul is, met alle andere kosten, de lening en de energiestromen gelijk. Omdat de startinvestering met factor 1 op tijdstip nul in de NPV staat, is dat de huidige netto startinvestering plus de NPV. Een negatieve waarde betekent dat de optie zelfs gratis geld kost. De terugleveringsvariant krijgt een eigen grens; de prijs- en kostenvarianten niet, omdat de kostenvariatie de investering zelf meeschaalt. Zo kan een gebruiker een offerte of aanbieding toetsen zonder opnieuw te rekenen. Runs van vóór deze uitkomst tonen hem niet; de betekenis van de bestaande uitkomsten is niet veranderd, dus `model_version` blijft gelijk.

```text
lonend bij een startinvestering = netto startinvestering + NPV
```

ROI betreft de hele gekozen looptijd en is geen jaarlijks rendement. Bij nul startinvestering is ROI niet bepaald. Levensduurkosten zijn startinvestering plus extra jaarlijkse/toekomstige kosten en rente, na expliciete aftrekposten. Energiekosten staan afzonderlijk in de vergelijking.

De terugverdientijd is de eerste jaargrens waarna het cumulatieve resultaat tot het einde van de horizon niet meer negatief wordt. Een latere vervanging kan dus een eerdere schijnbare terugverdientijd ongeldig maken. Er wordt geen nauwkeurigheid tot maanden gesuggereerd. De API geeft ook de gedisconteerde terugverdientijd.

De gebruiker kiest het criterium:

- **NPV:** hoogste positieve netto contante waarde tegenover geen accu.
- **ROI:** hoogste positieve ROI over de horizon, met niet-negatieve NPV. ROI is ongedisconteerd; zonder die voorwaarde kan een optie winnen die in geld van nu verlies geeft.
- **Terugverdientijd:** kortste blijvende terugverdientijd, met niet-negatieve NPV.
- **Eigen gebruik:** hoogste nuttig gebruikte fractie van de zonnestroom in jaar één. Dit mag financieel ongunstig zijn en wordt bij het resultaat vermeld.

Een optioneel budget begrenst de netto startinvestering; het is geen plafond voor alle latere kosten of bruto voorfinanciering. Geen accu blijft beschikbaar en wint bij onvoldoende financieel voordeel. Bij gelijke score blijft de eerdere optie gekozen. De tool kiest binnen de ingevoerde opties; het zoekt niet automatisch alle capaciteiten of producten op de markt af.

Gunstige en ongunstige varianten combineren de opgegeven afwijking in inkoop-/terugleverprijzen en kosten. De gunstige variant verhoogt de inkoopprijs, verlaagt de terugleververgoeding en verlaagt uitgaven; de ongunstige doet het omgekeerde. Bevestigde aftrekposten blijven gelijk. Dit zijn gevoeligheidstests, geen statistische betrouwbaarheidsbanden; bij negatieve tarieven of niet-standaard kasstromen hoeft de volgorde van de uitkomsten niet vanzelf gunstig/ongunstig te zijn.

### Beleidswaarschuwingen

De rekenkern voegt waarschuwingen toe die de uitkomst niet veranderen:

- **Nettarieven vanaf 2029.** Loopt de horizon tot in 2029 of later, dan meldt de run dat de ACM vanaf 1 januari 2029 volume- en tijdsafhankelijke transporttarieven wil invoeren ([ontwerpbesluit van 8 oktober 2026](https://www.acm.nl/nl/publicaties/uitleg-bij-ontwerp-codebesluit-volume-en-tijdsafhankelijke-tarieven-voor-kleine-aansluitingen); ongeveer tweederde van het nettarief gaat afhangen van hoeveel en wanneer je afneemt; definitief besluit begin 2027). Het model rekent met vaste ingevoerde tarieven; een tariefvariant volgt pas als de tariefstructuur vaststaat (zie de [roadmap](roadmap.md)).
- **Btw-teruggave.** Een ingevoerde teruggave krijgt een waarschuwing: het model rekent alleen eigen gebruik, en volgens de [Belastingdienst](https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/content/thuisbatterij-btw) geeft alleen privégebruik geen recht op teruggave; bij aftrek kan btw over privégebruik verschuldigd zijn in het aanschafjaar en de vier jaren daarna.
- **Subsidie.** Een ingevoerde subsidie telt alleen als ze is toegekend; de waarschuwing vraagt regeling, toekenning en datum bij de kostenpost te noteren.
- **Na de levensduur.** Werkt een accu in een deel van de looptijd niet meer (leeftijd vanaf de technische gebruiksduur, zonder accuvervanging), dan noemt een waarschuwing die jaren. Ze besparen niets; ingevoerde jaarkosten lopen tot het einde van de looptijd door en worden dan apart genoemd. Pas zo nodig de looptijd aan, voer een vervanging in of zet tijdelijke jaarkosten als gebeurtenissen in.
- **Looptijd korter dan de levensduur.** Is de aangenomen technische gebruiksduur langer dan de looptijd en is er geen geprijsde accuvervanging, dan noemt een waarschuwing die accu’s (hoogstens drie bij naam). De jaren na de looptijd tellen niet mee en het model rekent zonder restwaarde, dus een kortere looptijd valt ongunstig uit; dat is bedoeld als je verwacht eerder te verhuizen, maar moet zichtbaar zijn.

### Terugleveringsvariant

Optioneel bevat `parameters.export_variant` een tweede set terugleverprijzen (`export_eur_per_kwh`, `export_fee_eur_per_kwh`) vanaf `from_calendar_year`, dat binnen de looptijd moet liggen (sinds 26 oktober 2026; daarvoor werd een variant na de looptijd geaccepteerd en kwam hij uit op de basis). De keuzehulp schuift het beginjaar bij een korte looptijd uit Instellingen naar het laatste jaar. Voor die jaren rekent de kern de rekening met en zonder accu opnieuw met deze twee tariefdelen; al het andere blijft gelijk en er is geen prijs- of kostenstress. Per optie staat de uitkomst in `export_variant` (NPV, nettowinst, ROI, blijvende terugverdientijd) en `export_variant_recommended_key` geeft de beste optie volgens hetzelfde doel en budget. De basisuitkomst en de aanbeveling veranderen niet. De variant van de keuzehulp (€ 0 vergoeding vanaf 2030) is een stresstest, geen aangekondigde regel: volgens de ACM blijft het recht op een redelijke vergoeding bestaan, tot 2030 minstens 50% van het kale leveringstarief, terwijl terugleverkosten de vergoeding kunnen overtreffen. Omdat bestaande velden hun betekenis houden en de nieuwe velden alleen verschijnen als de variant is opgegeven, veranderde de modelversie hiervoor niet (toen `nl-self-consumption-v1`). Het referentiegeval in `crates/core/tests/analysis.rs` rekent een besparing van 0,22 €/kWh in 2027 en 0,35 €/kWh vanaf 2028 met de hand na.

### Garantiestresstest

Optioneel bevat een kandidaat `warranty_stress`: `{ "operating_life_years": 10, "annual_capacity_loss_pct": 3.5, "basis": "…" }`. De kern simuleert dezelfde accu dan nog eens met de kortste van beide levensduren en het hoogste van beide capaciteitsverliezen (`stressed_battery`), zodat een stresstest nooit gunstiger uitvalt dan de basisaannames; al het andere (tarieven, kosten, lening, vervanging) blijft gelijk en er is geen prijs- of kostenstress. Na de levensduur levert de accu net als in de basis niets meer op, zolang er geen geprijsde vervanging is. Per optie staat de uitkomst in `warranty_stress` (NPV, nettowinst, ROI, blijvende terugverdientijd en de grensprijs); de basisuitkomst en de aanbeveling veranderen niet, en een waarschuwing noemt de aannames met hun herkomst.

De keuzehulp en ‘Neem over’ uit de catalogus vullen de stresstest met de kortste geldige productgarantie uit de bronnen (niet afgekeurde claims; naar beneden afgerond op hele jaren, hoogstens de aangenomen levensduur van 15 jaar) en 3,5% verlies per jaar. Dat is ongeveer 70% restcapaciteit na 10 jaar: volgens [Zonneplan](https://www.zonneplan.nl/kenniscentrum/thuisbatterij/thuisaccu-garantie) is een garantie op 70 tot 80% na 10 jaar gangbaar, en een veldstudie van 21 Duitse thuisaccusystemen (Figgener e.a., [Nature Energy, 2024](https://ideas.repec.org/a/nat/natene/v9y2024i11d10.1038_s41560-024-01620-9.html)) mat ongeveer 2 tot 3 procentpunt capaciteitsverlies per jaar; de basisaanname van 2% zit dus aan de onderkant (geraadpleegd 26 oktober 2026). Zonder bekende garantie is er geen stresstest; er wordt geen garantie verzonnen. In Zelf doorrekenen is het veld ‘Garantietermijn (jaar, optioneel)’. De uitkomst staat in de tabel ‘Grensprijs voor …’ bij ‘Tot welke prijs is het lonend’ (naast de grens zoals berekend, voor alleen de accuprijs en zonder terugleververgoeding), onder ‘Meer cijfers’ op de kaart en als rij in Vergelijk. Omdat bestaande velden hun betekenis houden en de nieuwe velden alleen verschijnen als de stresstest is opgegeven, verandert de modelversie niet. Het referentiegeval laat een accu met 2 jaar levensduur in een looptijd van 5 jaar precies twee jaar besparing opleveren; een stresstest die ruimer is dan de basis (10 jaar en 3,5% bij een basis van 3 jaar en 6%) geeft precies de basisuitkomst.

## Opslag, controle en grenzen

Een analyse bewaart de volledige invoer, gebruikte importmetadata, SHA-256 van het genormaliseerde profiel, onderzoeksdatum, modelversie en resultaat in SQLite. De bronintervallen blijven gekoppeld via import-ID. Historie toont de oorspronkelijke invoer, onafhankelijk van de huidige editor. Een hash detecteert veranderingen maar is geen reservekopie van alle intervallen of een onveranderbaar auditlog. Een bewaarde analyse verandert nooit; na een nieuwe `model_version` kan dezelfde invoer opnieuw worden doorgerekend als nieuwe analyse (`recalculated_from` verwijst naar de oude), maar alleen als het profiel nog dezelfde hash heeft.

De referentietests controleren energiebehoud, AC-verliezen, vermogensgrenzen, standby, degradatie, de tariefomslag in 2027, analytisch narekenbare NPV/ROI, financieringsrente, vervanging, keuzecriteria, budget en de optie geen accu.

Nog buiten de berekening vallen dynamische uur-/kwartierprijzen en optimale aansturing, netladen/handel, onbalansdiensten, fiscale automatisering, cyclusafhankelijke slijtage, temperatuur- en vermogensafhankelijke rendementscurves, variabele fysieke installaties en gegarandeerde back-upduur. Het model beoordeelt ook geen certificaten, vergunningplicht, fasebelasting of elektrische veiligheid voor een adres. Gebruik daarvoor de afzonderlijke productclaims en installateursgegevens.
