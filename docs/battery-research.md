# Onderzoek: welke accugegevens leggen we vast?

Onderzocht op 24 oktober 2026. Dit document bepaalt de eerste datastructuur; het is geen productadvies of actuele prijslijst. De productdocumenten hieronder dienen als voorbeelden om het model te toetsen. Er worden geen productgegevens automatisch in de database geladen.

## Bevindingen uit primaire bronnen

De [BYD HVS-datasheet, BCU 2.0, V1.0](https://site.bydbatterybox.com/uploads/downloads/BCU2.0_BBOX_HVS_Datasheet_EN_V1.0_250328-67ee42d4ced21.pdf) onderscheidt module en configuratie. De voetnoten verbinden bruikbare energie aan DC, ontladingsdiepte, C-rate en temperatuur. De benodigde omvormer beïnvloedt de uiteindelijk beschikbare systeemenergie. Hieruit volgt onze keuze om configuratie, meetgrens en testcondities apart vast te leggen.

De [Tesla Powerwall 3-specificaties, Amerikaanse uitvoering](https://energylibrary.tesla.com/docs/Public/EnergyStorage/Powerwall/3/InstallManual/Gateway/3/en-us/GUID-EC527BC7-4750-4425-BBC4-DB8C000339B3.html) onderscheiden onder meer laad- en ontlaadvermogen, uitbreidingseenheden, netconfiguratie, aansluitspanning en rendement van verschillende energiepaden. Ook verschillen IP-bescherming en gewicht per onderdeel of uitvoering. Eén capaciteit, één vermogen en één rendement zijn daarom onvoldoende als productbeschrijving. De bron beschrijft een regionale uitvoering; eigenschappen worden niet overgenomen naar andere markten.

De [BYD-compatibiliteitslijst V2.22 van 10 oktober 2026](https://site.bydbatterybox.com/uploads/downloads/BCU2.0_261010_BYD_Battery_Box_Premium_HVS%26HVM_Compatible_Inverter_List_V2.22-6ac9cfeb73807.pdf) koppelt omvormers aan aantallen modules en firmwarevereisten. Parallelle opstellingen kennen aanvullende beperkingen. Compatibiliteit wordt daarom een gedateerde relatie met voorwaarden, geen algemeen ja/nee-veld op de accu.

De [BYD Europese garantievoorwaarden](https://site.bydbatterybox.com/uploads/downloads/BCU2.0_BYD%20Battery-Box%20Premium%20HVS%26HVM%20Limited%20Warranty-Europe-EN-V1.0-67eb5bb39ed39.pdf) onderscheiden product- en prestatiegarantie. De prestatievoorwaarden combineren looptijd, resterende capaciteit en energie-doorzet, met een grens die als eerste bereikt kan worden. Het document heeft in de inhoud revisie V1.2, terwijl de downloadnaam V1.0 vermeldt. Dit onderstreept waarom we documentrevisie, vindplaats en eventueel een archiefhash vastleggen. Garantie wordt als bronclaim geregistreerd; het systeem interpreteert geen juridische aanspraken.

De [HTW Berlin Stromspeicher-Inspektion 2026](https://solar.htw-berlin.de/studien/stromspeicher-inspektion-2026/) vergelijkt complete combinaties van batterijen en omvormers en bespreekt standbyverbruik, deellastverliezen, regeling en garantievoorwaarden. De [methodetoelichting van de Stromspeicher-Inspektor](https://solar.htw-berlin.de/rechner/stromspeicher-inspektor/) maakt onderscheid tussen SPI-referentiegevallen van 5 en 10 kW. Onze datastructuur houdt die indices apart van round-trip-rendement. Een labmeting krijgt een eigen bron en kan naast een fabrikantclaim blijven bestaan.

## Nederlandse momentopnamen voor de keuzehulp

`crates/server/resources/references-nl.json` (sleutel `research-2026-10-24-nl-v1`) bevat gedateerde claims van 24 oktober 2026 voor HomeWizard Plug-In Battery, Marstek Venus E Gen 3.0, Zendure SolarFlow 2400 AC+, Sessy 5 en 10 kWh, en een tweede bron (Nederlands datablad) voor de bestaande Powerwall 3P-uitvoering. Specificaties en prijzen staan als aparte entries met elk hun eigen bron:

| Uitvoering | Specificatiebron | Prijsbron (incl. btw, excl. installatie) |
| --- | --- | --- |
| HomeWizard Plug-In Battery | [technische specificaties](https://www.homewizard.com/plug-in-battery-technical-specifications) | € 1.195, [productpagina](https://www.homewizard.com/nl/plug-in-battery/) |
| Marstek Venus E Gen 3.0 | [productpagina Duitsland](https://marstek.de/products/venus-e-3) | € 1.199, [123accu](https://www.123accu.nl/Marstek-Venus-E-3-0-plug-in-thuisbatterij-i57624.html) |
| Zendure SolarFlow 2400 AC+ | [productpagina](https://zendure.com/products/zendure-solarflow-2400-ac-plus) | € 829, [ANWB Webwinkel](https://www.anwb.nl/webwinkel/p/252181/zendure-solarflow-2400-ac-thuisbatterij) |
| Sessy 5 / 10 kWh | [specificaties](https://www.sessy.nl/specificaties/) | € 3.550 / € 5.500, [Sessy](https://www.sessy.nl/vragen/wat-kost-een-sessy-thuisbatterij/) |
| Tesla Powerwall 3P | [datablad NL](https://energylibrary.tesla.com/docs/Public/EnergyStorage/Powerwall/3P/Datasheet/nl-nl/Powerwall-3P-Datasheet-NL.pdf) | Geen openbare Nederlandse prijs gevonden |

Wat de bron niet vermeldt, ontbreekt: bijvoorbeeld de bruikbare capaciteit van HomeWizard en Zendure, het round-trip-rendement van Marstek en Zendure, en de meetgrens van het Sessy-rendement. Waar een webwinkel de btw niet expliciet noemt, is de prijs als inclusief vastgelegd omdat een consumentenprijs volgens EU-richtlijn 98/6/EG de eindprijs inclusief btw is; dat staat in de entryvoorwaarden. Prijzen veranderen snel; het zijn momentopnamen, geen actuele prijslijst.

Een tweede set, `crates/server/resources/references-nl-2.json` (sleutel `research-2026-10-24-nl-v2`), voegt toe:

| Uitvoering | Specificaties | Prijs |
| --- | --- | --- |
| Anker SOLIX Solarbank Max AC, 7 kWh, stekker 800 W | [datasheet NL, 26 mei 2026](https://cdn.shopify.com/s/files/1/0726/0736/7225/files/Datasheet_20260526_E2_AC_NL_compressed.pdf?v=1780726254), pagina 2 | € 1.999 actieprijs (adviesprijs € 2.499), [Anker NL](https://www.ankersolix.com/nl/products/a17e2) |
| Anker SOLIX Solarbank Max AC, 7 kWh, eigen groep 3,5 kW | idem | idem |
| Zonneplan Nexus 1-fase, 10 / 15 kWh | [Zonneplan 1-fase](https://www.zonneplan.nl/thuisbatterij/1-fase/) en [Nexus-overzicht](https://www.zonneplan.nl/thuisbatterij) | € 4.690 / € 5.490 ‘na teruggave btw’, vastgelegd als exclusief btw |

De Anker-datasheet noemt de capaciteit nominaal met 100% ontladingsdiepte, maar geen round-trip-rendement en geen sluimerverbruik; de keuzehulp gebruikt daarvoor de zichtbare aannames. Het uitgangsvermogen is 0,8 kW via een Schuko-stekker en 3,5 kW op een eigen groep, daarom staan er twee uitvoeringen. Eerdere zoekresultaten toonden ook € 2.099 en € 2.199 voor dezelfde pagina; de vastgelegde prijs is die van 24 oktober 2026. Zonneplan noemt geen bruikbare capaciteit, geen laadvermogen en geen garantietermijn in jaren, alleen ‘10 jaar servicegarantie’ en ‘round-trip efficiency tot 90%’. Omdat btw terugvragen alleen bij handel als ondernemer kan (Belastingdienst), gebruikt de keuzehulp de Zonneplan-prijs niet automatisch; vul je eigen offerte in.

Niet opgenomen: EcoFlow STREAM AC Pro (geen Nederlandse fabrikantpagina met specificaties gevonden; prijzen alleen via marktplaatsverkopers) en Huawei LUNA2000 (de S0 is uit productie, de S1-specificatiepagina was niet bereikbaar; heeft een Huawei-omvormer nodig).

Na drie maanden (vanaf 24 januari 2027) tonen de catalogus en de keuzehulp een melding dat prijzen en tarieven verouderd kunnen zijn. Bestaande databases krijgen de tweede set met ‘Laad onderzochte uitvoeringen’ in de catalogus; eerder geladen sets worden niet opnieuw ingevoegd.

## Vast te leggen gegevens

De volgende inventaris is ons ontwerp op basis van dit onderzoek. Een veld mag onbekend blijven; een onbekende waarde is geen nul en geen ontkenning.

| Groep | Gegevens | Waarom nodig |
| --- | --- | --- |
| Identiteit | Fabrikant, productnaam, modelcode, type product | Voorkomt verwarring tussen module, systeem en omvormer |
| Uitvoering | Variant, hardwarerevisie, onderdelen, aantallen, rol | Vergelijkt een concrete samenstelling |
| Onderzoekscontext | Markt, firmware, bron, documentrevisie, publicatiedatum, raadpleegdatum, pagina/tabel, controle-status | Maakt een gegeven herleidbaar en beoordeelbaar |
| Energie | Nominale en bruikbare energie, ontladingsdiepte, maximale systeemenergie | Onderscheidt bruto/netto en uitbreidbaarheid |
| Vermogen | Continu laden/ontladen, piekvermogen met duur, schijnbaar vermogen, back-upvermogen | Ondersteunt later dimensionering en het beoordelen van piekbelasting |
| Elektrisch | Spanning en bereik, stroomlimieten, netfrequentie, fasen, PV-ingang, MPPT-aantal | Legt aansluitvoorwaarden vast |
| Rendement en regeling | Laad-, ontlaad- en round-trip-rendement, standby, zelfontlading, omschakel- en regeltijd, SPI per referentieklasse | Voorkomt een vergelijking op alleen piekrendement |
| Meetcondities | AC/DC-meetgrens, temperatuur, vermogen, SoC, DoD, C-rate, overige procedure | Ondersteunt beoordeling van meetpunten en curves |
| Levensduur | Cycli, ontwerplevensduur, bijbehorende resterende capaciteit en testcondities | Houdt testlevensduur gescheiden van garantie |
| Back-up | Noodstroom, eilandbedrijf, black-start, driefasenback-up, asymmetrie, vereiste accessoires | Een accuvermelding alleen bewijst geen noodstroomfunctie |
| Sturing | Netladen/-export, dynamische tarieven, EMS, lokale API, protocollen, offlinewerking, cloud- en abonnementsafhankelijkheid | Ondersteunt onderzoek naar integratie en exploitatievoorwaarden |
| Fysiek en omgeving | Afmetingen, gewicht, montage, koeling, IP-rating, binnen/buiten, laad-/ontlaad-/opslagtemperatuur, luchtvochtigheid, hoogte, geluid | Bepaalt of plaatsing praktisch mogelijk is |
| Compatibiliteit | Tegenproduct, claimstatus, firmware, moduleaantal, parallelaantal, voorwaarden | Legt ondersteunde combinaties en uitsluitingen vast |
| Veiligheid en conformiteit | Norm, editie, claim-/test-/certificaatstatus, certificaatreferentie, scope | Houdt fabrikantvermelding gescheiden van onderbouwde certificering |
| Garantie en service | Product-/prestatiemaanden, capaciteitbehoud, cycli, doorzet, eerste grens, toepassing, activatie/internet, arbeid, overdraagbaarheid, uitsluitingen, serviceregio | Een aantal garantiejaren beschrijft de voorwaarden onvoldoende |
| Prijsaanbiedingen | Verkoper, valuta, geldprecisie, aanschaf, periodieke kosten, btw-basis, tarief, inbegrepen onderdelen/installatie/levering, geldigheid en beschikbaarheid | Maakt later vergelijking van dezelfde pakketomvang mogelijk |
| Onderhoud en einde gebruik | Installatievereisten, aanvullende kosten, reparatiemogelijkheden, recycling | Legt relevante kwalitatieve beperkingen vast |

## Wat eerst volledig verzamelen?

Voor een eerste bruikbare vergelijking: een concrete uitvoering, bruikbare energie en meetgrens, continu laad-/ontlaadvermogen, systeemrendement met context, vereiste omvormer en accessoires, prijsomvang en valuta, en garantiegrenzen. Leg ook ontbrekende informatie vast in de onderzoeksnotities. Het schema laat gedeeltelijke dossiers toe en kent nog geen automatisch volledigheidsoordeel of rangschikking.

Bij verdieping volgen meerdere meetpunten voor deellast, temperatuur en degradatie; een getal zonder condities krijgt geen vergelijkbaarheidsclaim. Productonderzoek blijft gescheiden van huishoudelijk verbruik, toekomstige tarieven, subsidies, discontovoet en scenarioresultaten. Die laatste gegevens horen later in scenario- en rekenmodellen.

De technische uitwerking staat in [het datamodel](data-model.md). De velden voor voorwaarden en uitsluitingen bewaren tekst; complexe garantieformules, compatibiliteitslogica en complete testprocedures worden nog niet automatisch geëvalueerd.
