# Keuzehulp

De keuzehulp (`#/keuzehulp`, ook het startscherm) is de begeleide route voor consumenten zonder technische voorkennis. Hij stelt vragen in gewone taal, maakt zo nodig een geschat energieprofiel, laat zien welke accugrootte zinvol is, filtert de catalogus op praktische eisen en rekent passende accu’s door met dezelfde rekenkern als de scenariotool. ‘Geen accu’ blijft een volwaardige uitkomst. Het resultaat is een gewone, onveranderlijke analyse; met ‘Pas aan en reken opnieuw’ neem je hem over in Zelf doorrekenen.

## Stappen

1. **Je energie.** Zonnepanelen ja/nee en welke gegevens je hebt. Met jaartotalen vul je opwek (of kWp en ligging) in, en daarnaast óf netafname en teruglevering van de jaarafrekening, óf direct het totale (bruto) verbruik van het huis; optioneel ook welk deel naar een warmtepomp of het thuisladen van een auto gaat (met laadmoment). Uit netafname en teruglevering wordt het bruto verbruik afgeleid als `netafname + opwek − teruglevering`. Dat klopt alleen zonder bestaande accu. Met een bestand kies je een bewaard, ROI-geschikt profiel.
2. **Je woning.** Stekker of vaste installatie, 1- of 3-fase, binnen of buiten en of noodstroom nodig is. Wie een stekkerbatterij overweegt, ziet direct het veiligheidsadvies (zie [Aansluitregels](#aansluitregels)).
3. **Je contract.** Contractsoort en all-in stroomprijs (met een knop voor de gedateerde indicatie). Daarna een expliciete keuze voor teruglevering vanaf 2027: eigen vergoeding en terugleverkosten uit het contract, of de indicatie. Een leeg veld telt nooit als nul. Tot slot de vraag of ook de terugleveringsvariant ‘geen vergoeding vanaf 2030’ als stresstest moet worden doorgerekend (standaard ja). Bij een dynamisch contract meldt de keuzehulp dat handelswaarde nog niet wordt berekend.
4. **Wat je belangrijk vindt.** Doel (NPV, terugverdientijd of eigen gebruik), optioneel budget en horizon van 10, 15 of 20 jaar.
5. **Advies.** Capaciteitscurve, welke accu’s worden doorgerekend en waarom de rest niet, drie bevestigingen en de berekening, plus ‘Voordat je koopt’ met de aanmeldplicht en het stekkeradvies.

Antwoorden worden als concept in `localStorage` (`thuisaccu-keuzehulp`) bewaard; zonder browseropslag werkt de keuzehulp gewoon. Er gaat niets naar externe diensten.

## Geschat profiel uit jaartotalen

`POST /api/v1/solar/typical` maakt een volledig uurprofiel en bewaart het als gemodelleerde import (`generator: typical-nl-v1`). De vormen zijn ingebakken bronmomentopnamen in `crates/server/resources/typical-profiles.json`, gebouwd met `tools/build_typical_profiles.py`:

| Reeks | Bron | Toepassing |
| --- | --- | --- |
| Verbruik | [Energiedatawijzer, Standaardprofielen elektriciteit 2026 versie 1.00](https://energiedatawijzer.nl/documenten/profielen-elektriciteit-2026/), categorie E1A (≤ 3×25 A), aansluitingen zonder invoeding, afname | Kwartierfracties opgeteld per UTC-uur van kalenderjaar 2026 (Amsterdam) en geschaald naar het bruto jaarverbruik |
| Opwek | [PVGIS 5.3](https://re.jrc.ec.europa.eu/pvg_tools/en/), SARAH3/ERA5, De Bilt (52,101 N; 5,177 O), weerjaar 2023, 1 kWp, 14% systeemverlies, 35° helling | Zuid, zuidoost, zuidwest, oost en west; oost-west is het gemiddelde van oost en west. Geschaald naar de opgegeven jaaropwek, of kWp × PVGIS-jaaropbrengst |
| Warmtepomp, ruimteverwarming | Luchttemperatuur T2m uit dezelfde PVGIS-reeks; graaduren onder de Nederlandse stookgrens van 18 °C (som 60.743 graaduren in 2023) | 66% van het opgegeven warmtepompverbruik, per uur naar rato van de graaduren |
| Warmtepomp, warm tapwater | [CE Delft, factsheet bodemwarmtepomp](https://ce.nl/wp-content/uploads/2021/04/05_Factsheet-Bodemwarmtepomp_DEF.pdf): bij 2 personen 680 kWh tapwater + 320 kWh stilstandsverlies, naast 1.960 kWh ruimteverwarming bij label B | 34% (1.000 / 2.960) gelijkmatig over alle uren |
| Elektrische auto | Aanname: elke dag dezelfde hoeveelheid, geladen met 3,68 kW (1-fase 16 A × 230 V) vanaf 18.00, 01.00 of 11.00 uur lokale tijd | Wat niet in een uur past, schuift door naar de volgende uren |

Opbrengst per kWp in dit weerjaar: zuid 1.005,7, zuidoost 960,2, zuidwest 945,4, oost 822,1 en west 803,7 kWh. 2023 was een zonnig jaar; daarom vraagt de keuzehulp bij voorkeur de jaaropbrengst uit de omvormer-app.

Grenzen: een standaardprofiel is een gemiddelde over veel huishoudens en dus gladder dan één huishouden. Korte pieken (koken, wasmachine) en dagen zonder verbruik ontbreken. De pieken binnen het uur vult de rekenkern aan met de gemeten verdeling van 74 huishoudens ([rekenmethode](roi-model.md#verbruik-binnen-een-meetperiode)); warmtepomp en laden tellen daarbij als gelijkmatig (`steady_consumption_wh` per interval). De verschillen tussen dagen blijven ontbreken. Warmtepomp en laadpaal zitten niet in E1A; geef je ze op, dan gaat dat deel van het jaarverbruik (dat er al in zit) naar de eigen vormen hierboven en volgt de rest E1A. Een lager warmtepomprendement bij vorst, de regeling van de eigen warmtepomp en wisselende laadmomenten zijn niet meegenomen; een snellere lader (11 kW) vraagt meer vermogen dan de meeste accu’s leveren, waardoor de accu in werkelijkheid minder van het laden kan dekken. Thuiswerken zit er niet in. Het weer is dat van één jaar op één plek. Zonder warmtepomp en auto is het profiel precies gelijk aan eerdere versies, dus de generator blijft `typical-nl-v1`. De import, de analysewaarschuwing en het resultaat dragen daarom het label GESCHAT PROFIEL.

Controle bij afname en teruglevering: wie netafname en teruglevering opgeeft, heeft ook het eigen direct gebruik al gemeten (opwek − teruglevering). De keuzehulp vergelijkt dat bij het advies met het direct gebruik in het geschatte profiel. Verschilt het 10 procentpunt of meer, dan staat boven de capaciteitscurve een melding met de richting van de fout: meer eigen gebruik dan het profiel betekent dat de accubesparing waarschijnlijk lager uitvalt. Daarnaast meldt de keuzehulp het als de curve meer accugebruik laat zien dan het kleinste van jaarafname en teruglevering; zonder bestaande accu kan een accu niet meer vervangen. Het profiel wordt niet gekalibreerd: jaartotalen bepalen geen uurprofiel, en een verschoven verbruiksvorm zou een nieuwe, niet onderbouwde aanname zijn. De vergelijking gaat mee in de aannames van iedere doorgerekende optie.

## Capaciteitscurve

`GET /api/v1/solar/imports/{id}/capacity` simuleert een verliesvrije accu zonder vermogensgrens, standby of slijtage voor 0 tot 20 kWh, met dezelfde verdeling van het verbruik binnen het uur (of, waar gemeten, de netafname en teruglevering; zie [rekenmethode](roi-model.md#gemeten-netafname-en-teruglevering)), twee keer achter elkaar zodat de beginlading niet meetelt. De uitkomst is een bovengrens voor zonnestroom die via de accu zelf wordt gebruikt. De keuzehulp noemt het bereik waarbinnen 75% tot 90% van de waarde bij 20 kWh wordt gehaald ‘zinvol’ (doel ‘veel opbrengst per kWh accu’, standaard; een energieheuristiek, geen financiële optimalisatie) of 90% tot 97% (doel ‘zo veel mogelijk eigen zonnestroom’). De gebruiker kiest dat doel boven de grafiek. Het doel zet twee schuifregelaars (kleinste en grootste bruikbare capaciteit, 0 tot 20 kWh in stappen van 0,5 kWh); schuift de gebruiker zelf, dan geldt dat eigen bereik (`sizing: "custom"` met `rangeLow`/`rangeHigh` in het concept in de browser) en staat bij iedere schuif het aandeel van de waarde bij 20 kWh, lineair tussen de punten van de curve. De grenzen zijn als lijnen in de grafiek getekend, ook tussen twee punten, en de kolom ‘Zinvol bereik’ (binnen, kleiner of groter) in de lijst van doorgerekende accu’s schuift direct mee. Beide drempels zijn ontwerpkeuzes, geen bronwaarden. Dit is een hulpmiddel bij de keuze, geen productberekening en geen advies over een exacte grootte.

## Van bronclaim naar rekengegevens

De browser leidt per catalogusuitvoering rekengegevens af en toont elke aanname bij de accu:

| Rekengegeven | Gebruikte claim | Als die ontbreekt |
| --- | --- | --- |
| Bruikbare capaciteit | `usable_energy_wh`, anders `nominal_energy_wh × depth_of_discharge_pct` | Aanname 90% van `nominal_energy_wh`; zonder energieclaim niet doorrekenbaar |
| Ontladen | `continuous_discharge_power_w` met een AC-meetgrens of zonder vermelde meetgrens | Niet doorrekenbaar; kVA wordt niet als kW gebruikt en een DC-vermogen niet als AC-vermogen |
| Laden | `continuous_charge_power_w`, idem | Aanname: gelijk aan ontladen |
| Rendement | `round_trip_efficiency_pct` met meetgrens systeem AC, AC → AC, PV → opslag → AC of niet vermeld; bij een bereik de ondergrens. Alles behalve AC → AC wordt als AC→AC-aanname benoemd | Aanname 77%; een DC-rendement (accu DC, DC → DC) mist de omvormerverliezen en telt niet, maar wordt wel genoemd |
| Standby | `standby_power_w` | Aanname 10 W |
| Slijtage en levensduur | — | Aanname 2% per jaar en 15 jaar, geen garantie |

De aannames voor rendement en standby zijn bewust voorzichtig gekozen (25 oktober 2026). Onafhankelijk gemeten stekkeraccu's in de vijfde referentieset halen 77–87% heen en terug en gebruiken in rust 3–14 W (netzijde plus wat de accu zelf verliest). [Test-Aankoop](https://www.test-aankoop.be/woning-energie/hernieuwbare-energie/nieuws/beste-plug-and-play-thuisbatterijen) (26 augustus 2026, acht stekkeraccu's) mat bij 23 °C gemiddeld 82,4% met als laagste 77,1%, bij 5 °C gemiddeld 78,1%, en in rust van minder dan 1 W tot 36 W. De [benchmark van Energienerds](https://energienerds.nl/index.php/2026/10/11/keuzehulp-thuisbatterij-rendement-rte) (11 oktober 2026) meldt 78–88% AC → AC bij 800 W voor negentien accu's, zonder standby. Een ontbrekende waarde krijgt daarom ongeveer de laagst gemeten waarde: 77% en 10 W. Dat geldt ook voor vaste installaties, die vaak beter presteren; een bronclaim gaat altijd voor.

Selectieregel bij meerdere claims: eerst de meest geschikte meetgrens (systeem AC, AC → AC, niet vermeld, PV → opslag → AC, daarna voor capaciteit en standby ook accu DC en DC → DC), daarbinnen de voorzichtigste waarde: de laagste capaciteit, het laagste vermogen en rendement, het hoogste sluimerverbruik. Betwiste en vervangen claims tellen niet. Liggen de bruikbare claims uiteen, dan noemt de toelichting alle waarden en het ID van de gebruikte claim. Elke berekening legt in de aannames van de optie de bron en het claim-ID van iedere gebruikte rekenwaarde vast. Onopgeloste verschillen kun je in Zelf doorrekenen als aparte opties doorrekenen.

Een prijs telt alleen als de aanbieding niet betwist, vervangen of verlopen (`valid_until`) is.

Uitvoeringen met een niet doorrekenbaar gegeven of een harde mismatch (bijvoorbeeld 3-fase bij een 1-fase-aansluiting, stekker versus vaste installatie, geen noodstroom terwijl dat gevraagd is) doen niet mee. Het soort aansluiting komt uit de tekstclaim `coupling`; de Nederlandse momentopnamen gebruiken daarvoor ‘AC-gekoppeld (stekker)’, ‘AC-gekoppeld (vaste installatie)’ en ‘Hybride omvormer’.

De gebruiker kiest geen accu’s. De keuzehulp rekent automatisch elke uitvoering door die past, waarvan capaciteit en vermogen bekend zijn, die een gepubliceerde prijs inclusief btw heeft en waarvan geen kostenpost onbekend blijft (zoals een aparte omvormer). Iedere accu wordt vergeleken met geen accu; de uitkomst ordent de opties op het gekozen doel. De rekenkern vergelijkt hoogstens vijftig accu’s tegelijk; passen er meer, dan gaan de accu’s voor waarvan de bruikbare capaciteit het dichtst bij het zinvolle bereik ligt. Twee ingeklapte tabellen tonen de doorgerekende accu’s (soort, bruikbare capaciteit, ontlaadvermogen, prijs met bronlink en de plaats ten opzichte van het zinvolle bereik) en de overige accu’s met de reden waarom ze niet meedoen. Wie een offerte heeft of een accu zonder gepubliceerde prijs wil meenemen, gebruikt Zelf doorrekenen. Een stekkerbatterij met eigen zonne-ingangen (koppeltekst ‘Hybride: … (stekker) …’) krijgt de toelichting dat panelen aansluiten mag maar niet hoeft, in plaats van het advies voor een hybride omvormer.

Het resultaat toont bij meer dan vijf accu’s kaarten en grafieken voor geen accu en de beste vijf op het gekozen doel; een tabel in het overzicht en de gevoeligheidstabel tonen alle opties, en de jaartabel en de energiecijfers zijn per optie te kiezen.

## Kosten en indicaties

Per accu krijgen alle 26 kostenposten een indicatie, gebouwd door `Data.estimateCosts` (`web/data.js`) uit `estimates` in `crates/server/resources/cost-catalog.json` (geraadpleegd 24 oktober 2026, bedragen inclusief btw). Elke post toont in het resultaat (‘Invoer en aannames’) ‘Bron’ met link of ‘Aanname’ met reden. Aanpassen gaat via ‘Pas aan en reken opnieuw’, dat de run in Zelf doorrekenen opent; een ingevuld bedrag vervangt daar de indicatie. Zelf doorrekenen heeft per optie de knop ‘Vul open posten met indicaties’, die alleen nog onbekende posten vult.

Een stekkerbatterij op een eigen groep (koppeling ‘vaste installatie’ en ‘eigen groep’ in de naam van de uitvoering, bijvoorbeeld ‘eigen groep 2,4 kW’) krijgt de posten van een stekkerbatterij plus een extra groep in de meterkast: installatie € 280 als richtprijs voor ‘Aanbrengen extra groep met aansluiting’ inclusief materiaal, montage en btw ([Homedeal](https://homedeal.nl/elektricien/elektriciteit-aanleggen-kosten/), prijstabel van 18 juni 2026), kabels en beveiliging daarin inbegrepen, en 10% reserve over die € 280. Aangenomen is dat er plek is in de groepenkast; een volle of verouderde kast is niet meegeteld. Een installatiepakket voor een vaste thuisaccu (€ 1.349) telt dan niet. In de lijst van doorgerekende accu’s heet dat soort ‘Stekker, eigen groep’.

| Post | Stekkerbatterij | Vaste installatie | Bron of aanname |
| --- | --- | --- | --- |
| Accu | Gepubliceerde prijs inclusief btw | idem | Prijsbron in de catalogus |
| Omvormer | Inbegrepen | Inbegrepen als de bronclaim `inverter_included` of de aanbieding (`includes_inverter`) dat zegt; anders zelf in te vullen | Fabrikantclaim of aanbieding |
| Meter / EMS | HomeWizard P1 Meter € 24,95; Marstek CT002 € 99,95; Zendure Smart Meter P1 € 99,99; anders aanname vergelijkbare P1-meter | Inbegrepen (‘meting via P1 of CT-klem’) | [HomeWizard](https://www.homewizard.com/nl/plug-in-battery/), [Wattuneed](https://www.wattuneed.com/nl/batterij-accessoires/27111-slimme-meter-marstek-ct002-compatibel-met-venus-e-batterijen-0768563822537.html), [Zendure](https://be.zendure.com/en/products/slimme-meter-p1), [Batterij-Outlet](https://www.batterij-outlet.nl/nl/installatie/pakketprijzen/) |
| Installatie | Niet van toepassing (aanname: geen installatiewerk; bij twijfel over de groep een installateur laten kijken) | € 1.349 binnen, € 2.049 buiten (schuur, garage, gevel); inbegrepen als de aanbieding `includes_installation` heeft | Batterij-Outlet vanaf-prijzen of aanbieding |
| Kabels, beveiliging, schouw | Aanname: geen eigen groep, zie [Aansluitregels](#aansluitregels) | Inbegrepen in het pakket of in de aanbieding | Batterij-Outlet |
| Noodstroom | Niet van toepassing | € 500 meerprijs als noodstroom gevraagd is (€ 1.849 − € 1.349) | Batterij-Outlet |
| Groepenkast | Niet van toepassing | Inbegrepen; € 239 bij een 3-fasenaccu. Groepenkast vervangen (vanaf € 919) niet meegeteld | Batterij-Outlet |
| Netaansluiting | Niet van toepassing | € 368,77 alleen bij een 3-fasenaccu op een 1-fase-aansluiting | [Liander eenmalige tarieven 2026](https://www.liander.nl/-/media/files/tarieven/consument/2026/eenmalige-tarieven-stroom-2026-v11.pdf) |
| Levering | Inbegrepen bij HomeWizard (‘Gratis thuisbezorgd’); anders aanname | Aanname: in pakket- of productprijs | HomeWizard |
| Reserve onvoorzien | Niet van toepassing | 10% van installatie, noodstroom, groepenkast en netaansluiting; zit de installatie in de aanbieding, dan over de indicatieve pakketprijs, als ruimte voor meerwerk | Aanname (begrotingskeuze) |
| Abonnement | Gratis volgens HomeWizard en Sessy; anders aanname | idem | HomeWizard, [Sessy](https://www.sessy.nl/specificaties/) |
| Onderhoud, extra contractkosten, overige | Niet van toepassing | idem | Aanname |
| Verzekering | Niet van toepassing | idem | Voorbeeld [Centraal Beheer](https://www.centraalbeheer.nl/verzekeringen/opstalverzekering): standaard meeverzekerd |
| Extra vaste netbeheerkosten | Niet van toepassing | idem | [Liander](https://www.liander.nl/tarieven): 1x35A/1x40A en 3x25A in dezelfde tariefgroep |
| Btw-administratie, btw privégebruik, btw-teruggave | Niet van toepassing | idem | [Belastingdienst](https://www.belastingdienst.nl/wps/wcm/connect/nl/btw/content/thuisbatterij-btw): bij alleen privégebruik geen btw-ondernemer |
| Omvormer- en accuvervanging | Niet van toepassing | idem | Aanname: het model stopt de accu na de aangenomen levensduur |
| Verwijderen en recycling | Niet van toepassing | idem | [Solar Magazine](https://solarmagazine.nl/nieuws-zonne-energie/i44777/recycling-thuisbatterijen-krijgt-eindelijk-collectieve-aanpak-systeem-moet-klaar-zijn-in-2027): producent verantwoordelijk, collectief systeem verwacht vanaf juli 2027 |
| Subsidie | Niet van toepassing | idem | [Zonneplan](https://www.zonneplan.nl/thuisbatterij/subsidie/): geen landelijke subsidie in 2026; lokale regelingen zelf invullen |
| Restwaarde | Niet van toepassing | idem | Aanname (voorzichtig) |

Tegenstrijdigheid: Zonneplan schrijft dat je 21% btw terugkrijgt. Dat geldt volgens de Belastingdienst alleen bij handel in stroom als btw-ondernemer, niet bij alleen eigen gebruik; de keuzehulp volgt de Belastingdienst. Meerwerk dat pas bij de schouw blijkt (hak- en breekwerk, verouderde groepenkast, aanvraag bij de netbeheerder) is niet meegeteld.

Tariefindicaties, geraadpleegd op 24 oktober 2026:

| Waarde | Indicatie | Onderbouwing |
| --- | --- | --- |
| All-in stroomprijs | € 0,2596/kWh | [CBS](https://www.cbs.nl/nl-nl/maatwerk/2026/42/verdeling-energietarieven-2026): gemiddeld variabel leveringstarief september 2026 € 0,1487 incl. btw, exclusief energiebelasting; plus [energiebelasting 2026](https://www.anwb.nl/huis/energie/energiebelasting) € 0,11085 incl. btw |
| Terugleververgoeding vanaf 2027 | € 0,0615/kWh | Tot 1 januari 2030 minstens 50% van de stroomprijs zonder energiebelasting en btw ([ACM](https://consument.acm.nl/elektriciteit-en-gas/duurzame-energie/wat-is-salderen), bevestigd door [Vattenfall](https://www.vattenfall.nl/zonnepanelen/salderen/salderingsregeling-2027/)); 50% × € 0,1229 (CBS, september 2026, excl. btw) = € 0,06145, naar boven afgerond |
| Terugleverkosten vanaf 2027 | € 0,0515/kWh | Gekozen zodat vergoeding min kosten 1,0 cent per kWh is: de mediaan van 15 leveranciers voor een 1-jarig vast contract vanaf 2027 (spreiding −4,32 tot +4,37 cent), volgens het overzicht van [salderingcheck.nl](https://salderingcheck.nl/terugleverkosten-per-leverancier-2026/) met peildatum 16 oktober 2026 (secundaire bron op basis van tariefbladen en Keuze.nl). Primaire controle: [Eneco](https://www.eneco.nl/klantenservice/einde-salderen/rekenvoorbeelden/) rekent met € 0,05058 vergoeding (excl. btw) en € 0,03865 kosten (incl. btw), 1,2 cent netto, peildatum 25 februari 2026. Alleen het verschil telt in het model; de losse bedragen zijn geen leveranciersprijs |
| Terugleveringsvariant | Vanaf 2030: € 0 vergoeding, terugleverkosten gelijk | Stresstest, geen aangekondigde regel. Volgens de [ACM](https://consument.acm.nl/elektriciteit-en-gas/duurzame-energie/wat-is-salderen) krijg je een redelijke vergoeding, tot 2030 minstens 50% van het kale leveringstarief; voor daarna is geen minimum gevonden, en één leverancier in het overzicht rekent nu al 4,32 cent per kWh meer kosten dan vergoeding |

Eerdere versies van de keuzehulp rekenden met € 0,0615 vergoeding en € 0 terugleverkosten. Dat is 6,15 cent netto, meer dan bij elke leverancier in het overzicht, en onderschatte daardoor de waarde van een accu. Bewaarde berekeningen houden hun oorspronkelijke invoer.

## Aansluitregels

Geraadpleegd op 24 oktober 2026; dit is een samenvatting, geen juridisch of installatieadvies.

- **Aanmelden.** Volgens [Netbeheer Nederland](https://www.netbeheernederland.nl/sites/default/files/2024-12/nbnl_netbewust-gebruik-thuisbatterij_a4_fc_.pdf) (december 2024) is aanmelden van een thuisaccu via energieleveren.nl verplicht, net als bij zonnepanelen; naar schatting is minder dan 40% aangemeld. De plicht volgt uit een wijziging van de Netcode elektriciteit en geldt voor opslag vanaf 0,8 kW die op het net is aangesloten ([Solar Magazine, 8 mei 2024](https://solarmagazine.nl/nieuws-zonne-energie/i37394/verplichte-registratie-thuisbatterij-website-energieleveren-nl-vernieuwd)); het artikelnummer in de Netcode is niet gevonden. De website energieleveren.nl zelf was niet leesbaar voor controle.
- **Stekkerbatterij.** [Milieu Centraal](https://www.milieucentraal.nl/energie-besparen/zonnepanelen/thuisbatterij-zonne-energie-opslaan/) (gewijzigd 28 september 2026) raadt stekkerbatterijen op dit moment niet aan, onder meer vanwege brandrisico: in één groep kan stroom van twee kanten komen. Installateurs sluiten een accu volgens NEN 1010 aan op een aparte groep, niet op een stopcontact.
- **800 W.** Milieu Centraal adviseert voor [stekkerzonnepanelen](https://www.milieucentraal.nl/energie-besparen/zonnepanelen/zonnepanelen-met-een-stekker/) (gewijzigd 30 juni 2026) maximaal 800 W per groep, een groep met weinig andere apparaten en geen verlengsnoeren. De keuzehulp past dat advies toe op stekkerbatterijen en zegt erbij dat het daarvoor niet afzonderlijk is gepubliceerd. Commerciële bronnen noemen de NVWA of Europese regels als herkomst van de 800 W-grens; dat is niet in een primaire bron bevestigd.

Overige projectie-aannames komen uit de standaardaannames in Instellingen (anders 4% discontovoet, 2% kostenstijging, 0% PV-afname, verbruiksgroei en prijsverandering, 20% en 15% gevoeligheid). Startjaar is 2027, het eerste jaar zonder salderen. Een adres is optioneel; zonder adres wordt ‘Nederland (keuzehulp, geen adres opgegeven)’ vastgelegd.

## Voorbereid op dynamische tarieven

De contractsoort wordt al gevraagd en een dynamisch contract krijgt een expliciete melding. Er is nog geen tariefreeks of handelsstrategie in de rekenkern. Zie de [roadmap](roadmap.md).
