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

Een derde set, `crates/server/resources/references-nl-3.json` (sleutel `research-2026-10-25-nl-v3`, onderzocht op 25 oktober 2026), vult de uitvoeringen aan die in Nederlandse vergelijkingen van oktober 2026 vaak terugkomen. Specificaties komen van de fabrikant (datasheet, handleiding of productpagina); de vergelijkingssites zelf zijn geen bron.

| Uitvoering | Specificaties | Prijs (momentopname) |
| --- | --- | --- |
| Marstek Venus E Mini, 2 kWh, stekker 800 W / eigen groep 1,5 kW | [marstek.de](https://marstek.de/products/marstek-venus-e-mini), Technische Details | € 639 incl. btw ([123accu](https://www.123accu.nl/Marstek-Venus-E-Mini-2-kWh-plug-in-thuisbatterij-i59880.html)) en € 674 incl. btw ([marstek.nl](https://www.marstek.nl/product/marstek-venus-e-mini-plug-charge-thuisbatterij/)), beide als aparte claim |
| Indevolt PowerFlex 2000 Eco + 2 × PFA4000, 10 kWh, stekker 800 W / eigen groep 2,4 kW | [handleiding PowerFlex 2000 Series](https://thuisbatterij.nl/wp-content/uploads/2026/08/Indevolt-PowerFlex-2000-datasheet-nieuw.pdf), NL hoofdstuk 9 | € 2.349 ([Thuisbatterij.nl](https://thuisbatterij.nl/winkel/indevolt-powerflex-2000/)) |
| Zendure SolarFlow 2400 Pro, 2,4 kWh, stekker 800 W / eigen groep 2,4 kW | [zendure.nl](https://zendure.nl/products/zendure-solarflow-2400-pro) | € 969 actieprijs incl. btw (Zendure NL) |
| Anker SOLIX Solarbank 4 E5000 Pro, 5 kWh, stekker 800 W / eigen groep 2,5 kW | [ankersolix.com/nl](https://www.ankersolix.com/nl/products/ae103) en EU-datasheet van 25 april 2026 | € 1.999 actieprijs (Anker NL) |
| Growatt NOAH 2000, 2 kWh | [datasheet EN 202509](https://en.growatt.com/upload/file/NOAH_2000_Datasheet_EN_202509.pdf) | € 749 (Wallbox Discounter) en € 509,33 (Uwsolarinstallatie), beide als aparte claim |
| Sigenergy SigenStor EC 5.0 SP / EC 10.0 TP + 1 × BAT 10.0 | datasheets batterij en Energy Controller via [sigenergy.com/nl](https://www.sigenergy.com/nl/products/sigenstor), Europese garantievoorwaarden | € 5.412 / € 6.995 ‘na btw-teruggave’ incl. installatie ([Beter Duurzaam](https://beterduurzaam.nl/thuisbatterij/sigenergy)), vastgelegd als exclusief btw |
| SolarEdge Home Battery 400V, 9,7 kWh | [NL-datablad DS-000164-NL](https://knowledge-center.solaredge.com/sites/kc/files/se-solaredge-home-battery-400v-datasheet-nl.pdf) | € 6.375, zonder omvormer ([Plug Play Energie](https://plugplayenergie.nl/product/solaredge-home-batterij-400v-9-7-kwh-1-phase/)) |
| AlphaESS SMILE-G3-S5 + 1 × BAT-9.3S / SMILE-G3-T10 + 2 × BAT-9.3S | NL-datasheets uit het [downloadcentrum](https://www.alphaess.nl/pages/downloaden) | € 3.728,35 / € 6.385,76 zonder montage ([Multi-Solar](https://multi-solar.nl/products/alphaess-smile-g3-thuisbatterij-compleet-pakket)) |
| Homevolt (Polarium/Tibber), 6,6 / 13,3 kWh, 3-fase | Polarium-handleiding Rev 2.1 en Rev 1.1; voorwaarden van [Tibber NL](https://tibber.com/nl/slimme-thuisbatterij) | Geen openbare Nederlandse prijs; de Tibber Store NL toont Homevolt niet meer |
| Conow Atlas 6000 AC, 6 kWh, stekker 800 W / eigen groep 3 kW | [datasheet](https://images.tuyacn.com/conow-website/file/179033866427e90a5a27b.pdf) en [productpagina NL](https://www.conow.com/nl/products/atlas-6000-ac-plugin-home-battery) | € 1.523,39 incl. btw (Elektramat) |
| AEG SolarCube Pro (AS-BBL08-6K), 6 kWh, stekker 800 W / eigen groep | [NL-datasheet V3.1](https://cdn.shopify.com/s/files/1/0969/2132/1809/files/AEG_-_AS-BBL08-6K_SolarCube_Pro_Datasheet_-_NL.pdf?v=1785414993), EN-datasheet V2.0 en [handleiding](https://www.123accu.nl/pdf/AAE00159_handleiding.pdf) | € 1.599 incl. btw (aegthuisbatterij.nl en 123accu), beide als aparte claim |

De set bevat ook eigen metingen van [Jay's Desk](https://jaysdesk.com/en/energie) als `independent_test`-bron, naast de fabrikantclaims: de [Conow Atlas-test](https://jaysdesk.com/en/energie/conow-atlas-getest) (4 oktober 2026), de [AEG SolarCube-test](https://jaysdesk.com/en/energie/aeg-solarcube-getest) (1 oktober 2026) en de [Zendure SolarFlow 2400 Pro en AC+-review](https://jaysdesk.com/en/energie/zendure-2400-pro-ac-plus-review) (23 mei 2026). Het gaat om round-trip-rendement AC → AC, sluimerverbruik, geleverde energie en gemeten vermogens, elk met de testomstandigheden. Elke meting is gedaan op één exemplaar met een eigen meetopstelling. De Conow-meting is gedaan in de 3 kW-stand en de Zendure Pro-meting boven 800 W; die metingen hangen daarom aan de uitvoering met eigen groep. De AEG-meting hoort bij een firmware die volgens AEG niet meer geldt.

Behalve deze metingen ontbreekt veel: geen fabrikantbron noemt sluimerverbruik, en alleen SolarEdge noemt een round-trip-rendement (‘tot 94,5%’, zonder meetgrens). De keuzehulp gebruikt dan de zichtbare aannames. Vermogens die een bron alleen aan de DC-kant noemt (Sigenergy, SolarEdge, Growatt) staan met meetgrens `battery_dc` of `dc_dc`. De Growatt NOAH 2000 zit tussen de zonnepanelen en een aparte micro-omvormer, en heeft geen AC-ingang. De keuzehulp meldt dat, maar rekent hem verder als een accu die overschot opslaat. SolarEdge en Growatt hebben een aparte omvormer nodig; zolang die kostenpost onbekend is, wordt er niet gerekend. Waar een bron het vermogen per aansluitwijze onderscheidt, staan een stekker- en een eigen-groepuitvoering apart.

Een vierde set, `crates/server/resources/references-nl-4.json` (sleutel `research-2026-10-25-nl-v4`, onderzocht op 25 oktober 2026), neemt de [thuisaccucatalogus van Jay's Desk](https://jaysdesk.com/nl/thuisaccu) over: 89 entries, 70 nieuwe uitvoeringen van 62 producten (stekkeraccu's van onder meer AccuMate, Anker, Bluetti, EcoFlow, Hoymiles, HYXI, Indevolt, Jackery, Lunergy, Marstek, MOVA, SAMDUO, Sunpura, TSUN, Voltdeer, Zendure en ZinVolt). Voor accu's die er al in stonden (AEG SolarCube Pro, Anker Solarbank Max AC en 4 E5000 Pro, Conow Atlas, HomeWizard, Marstek Venus E 3.0 en E Mini, Zendure 2400 AC+ en 2400 Pro) hangen de cataloguswaarden als extra bron aan de bestaande uitvoering. Werkwijze:

- Bron is de detailpagina in de catalogus (`source_kind` `other`); per waarde staan in de voorwaarden de herkomst (fabrikant of winkel/reviewsite), de bron met link en de controledatum die Jay's Desk noemt. Die oorspronkelijke bronnen zijn niet opnieuw gecontroleerd.
- ‘Capaciteit’ staat als `nominal_energy_wh`: de catalogus zegt niet of het nominaal of bruikbaar is, en de toelichtingen die het wel zeggen noemen nominale energie. De keuzehulp rekent dan met de zichtbare aanname van 90 %.
- Een laadvermogen dat volgens de toelichting zon- of DC-invoer is, is niet overgenomen; een vermogen in VA staat als `apparent_power_va` of alleen als noodstroomkenmerk. Rendementen die geen heen-en-terugrendement zijn (‘AC-conversie-efficiëntie’, ‘AC-rendement’) zijn weggelaten.
- Koppeling en ingebouwde omvormer volgen uit de indeling van de catalogus (‘Stekkerbatterij, AC-gekoppeld’, ‘met eigen MPPT’, ‘Stekker-XL’). Noemt de toelichting naast de stekkerstand een hoger vermogen op een eigen groep, dan staan er twee uitvoeringen; anders staat het opgegeven vermogen in de naam van de uitvoering.
- De eigen metingen aan de Growatt AURA 5000 en de AlphaESS VitaPower 3600 AC (met één VitaMate 4000) zijn een aparte `independent_test`-bron. De metingen aan Conow en AEG kwamen al uit de testartikelen in de derde set.
- Straatprijzen zijn niet als aanbieding opgenomen: de catalogus noemt de winkel niet. Ze staan wel in de voorwaarden van de entry. Zonder prijs vult de gebruiker een offertebedrag in.
- Overgeslagen: de Bluetti AC200MAX (draagbaar, voedt niet terug in de groep), ‘AlphaESS 9,6 kWh + 10 kW omvormer’ (geen model of productblad) en de Powerwall 3P (alleen waarden van derden; de datasheet staat er al in). Aangekondigde en uit productie genomen modellen staan erin met die status in de naam van de uitvoering.

Een vijfde set, `crates/server/resources/references-nl-5.json` (sleutel `research-2026-10-25-nl-v5`, onderzocht op 25 oktober 2026), voegt geen uitvoeringen toe. Ze hangt gemeten rendement en sluimerverbruik aan uitvoeringen die tot dan op de aannames rekenden, plus het laadvermogen van de Indevolt per aansluitwijze:

| Uitvoering | Bron | Vastgelegd |
| --- | --- | --- |
| Indevolt PowerFlex 2000 Eco, stekker en eigen groep | [Energienerds-review](https://energienerds.nl/index.php/2025/12/23/indevolt-powerflex-2000-eco-review) (23 december 2025, bijgewerkt 23 september 2026) | 80,5% AC → AC bij 800 W; standby ≈ 9,3 W (1 W uit het net plus 8,3 W uit de accu, opgeteld) |
| Indevolt PowerFlex 2000 Eco, stekker / eigen groep | [Thuisbatterij.nl](https://thuisbatterij.nl/winkel/indevolt-powerflex-2000/), productbeschrijving | Laden 800 W op een bestaande groep; laden en ontladen 2000 W op een eigen groep, naast de 2400 W uit de specificatielijst |
| Indevolt SolidFlex 3000 AC | [Energienerds-review](https://energienerds.nl/index.php/2026/09/08/indevolt-solidflex-3000-ac-review) (8 september 2026) | 80,5% bij 800 W, 82,8% bij 1800 W, 81,3% bij 2400 W; standby 8,51 W |
| Marstek Venus E Gen 3.0 | [Technikblog](https://technikblog.ch/2026/03/marstek-venus-e-3-0-roundtrip-effizienz-gemessen-so-effizient-ist-der-speicher-wirklich/) (19 maart 2026); [Test-Aankoop](https://www.test-aankoop.be/woning-energie/hernieuwbare-energie/nieuws/beste-plug-and-play-thuisbatterijen) (26 augustus 2026) | ≈ 84% zonder standby (80% inclusief); standby 7,5–8 W per unit, volgens Test-Aankoop 0,54 W |
| Zendure SolarFlow 2400 AC+ | Test-Aankoop | Standby 4,6 W |
| Marstek Venus E Mini, stekker en eigen groep | [Energienerds.de](https://energienerds.de/review-marstek-venus-e-mini/) (7 september 2026); [smartzone.de](https://www.smartzone.de/marstek-venus-e-mini-balkonspeicher-test/) (29 september 2026) | 81,7% AC → AC bij 800 W; 77–81% per ontlaadvermogen, 79% gemiddeld; standby 7 W uit het net, of ≈ 14 W inclusief zelfontlading |
| Anker SOLIX Solarbank 3 E2700 Pro | [Notebookcheck](https://www.notebookcheck.com/Maechtiges-Balkonkraftwerk-System-mit-KI-Anker-Solix-Solarbank-3-Pro-im-Praxis-Test.1030280.0.html) (11 juni 2025, bijgewerkt 5 oktober 2026) | ≈ 80% |
| Anker SOLIX Solarbank 4 E5000 Pro, stekker en eigen groep | [PC-WELT](https://www.pcwelt.de/article/3205257/anker-solix-solarbank-4-e5000-pro-test.html) (5 augustus 2026) | 80–85% AC → AC (verlies 15–20%) |
| Anker SOLIX Solarbank Max AC, stekker en eigen groep | [smartzone.de](https://www.smartzone.de/anker-solix-solarbank-max-ac-im-test/) (22 september 2026) | 78–83%, 80% gemiddeld; eigen verbruik 7 W |
| Zendure SolarFlow 2400 Pro, stekker | [smartzone.de](https://www.smartzone.de/zendure-solarflow-2400-pro-im-test-das-laeuft-und-laeuft-und-laeuft/) (21 maart 2026) | ≈ 86,7% (2255 van 2600 Wh); standby 0,1–0,3 W en ≈ 3 W, tegenstrijdig |
| Zendure SolarFlow 1600 AC+ | [techtest.org](https://techtest.org/zendure-solarflow-1600-ac-test-ac-speicher-ab-unter-500-e-mit-bis-zu-1152-kwh/) (17 juli 2026) | 85,5%, methode niet vermeld |
| Sigenergy SigenMate 2700 Ultra | [Notebookcheck](https://www.notebookcheck.net/Balcony-solar-storage-system-with-two-backup-power-outlets-SigenMate-2700-Ultra-review.1416493.0.html) (5 oktober 2026) | ≈ 80% |
| Enphase IQ Battery 5P with FlexPhase | Datasheet DSH-00477-7.0 (6 mei 2026, [kopie bij PluginSolar](https://www.pluginsolar.co.uk/wp-content/uploads/2026/09/Enphase-IQ-Battery-5p-with-Flexphase.pdf)) | 90% AC → AC (fabrikant), 96% DC aan het begin van de levensduur |

Werkwijze:

- Testberichten zijn `independent_test`-bronnen met de meetopstelling in de voorwaarden; elke meting is één exemplaar met een eigen opstelling. Meetgrens AC → AC alleen waar de bron meet van stopcontact tot stopcontact (Energienerds definieert RTE zo op zijn benchmarkpagina); anders ‘niet vermeld’. Volgens de selectieregel van de keuzehulp gaat AC → AC voor ‘niet vermeld’.
- Een rendement inclusief standby is niet als round-trip vastgelegd, omdat het model het sluimerverbruik apart rekent. Sluimerverbruik is vastgelegd als de som van netafname en wat de accu zelf verliest wanneer de bron beide noemt; dat verlies moet later weer worden bijgeladen.
- Een meting bij 800 W hangt ook aan de uitvoering met eigen groep wanneer er voor die stand geen meting is; de voorwaarden zeggen dat.
- Gevonden, maar niet opgenomen: het percentage van heise voor de Venus E 3.0 (pagina niet volledig gelezen), forum- en app-waarden (Bluetti, Hoymiles, Venus E v2), fabrikantclaims zonder meetgrens (Zendure Mix 90%, Marstek Venus E 4.0 ‘> 90%’, AlphaESS ‘Systemwirkungsgrad bis zu 98%’) en de benchmarktabel van Energienerds (overnemen vereist toestemming).
- Niets gevonden voor Sunpura, TSUN, Voltdeer, EcoFlow, Jackery, SAMDUO, Lunergy, HYXI, Jet, Conow Lyra, MOVA, NextEnergy, ZinVolt, AccuMate, AEG AS-BBH1 en SolarCube Pro (die laatste heeft wel de meting van Jay's Desk uit de derde set), Indevolt BK1600 en PowerFlex 2000 (niet-Eco), Growatt, Polarium en de SigenStor; zonder andere bronclaim rekenen die op de aannames (77% en 10 W, zie [keuzehulp](keuzehulp.md#van-bronclaim-naar-rekengegevens)).

Een zesde set, `crates/server/resources/references-nl-6.json` (sleutel `research-2026-10-25-nl-v6`, onderzocht op 25 oktober 2026), voegt ook geen uitvoeringen toe. Ze hangt 35 webwinkelprijzen aan uitvoeringen die nog geen gepubliceerde prijs hadden. Het zoeken is verdeeld over zoekagents. Elke prijs is daarna zelf nagelezen op de productpagina, in de browser of in de productgegevens van de winkel zelf (Shopify `/products/<handle>.js`, WooCommerce-varianten); een zoekresultaat of prijsvergelijker telt niet als bron.

| Winkel | Uitvoeringen | Opmerking |
| --- | --- | --- |
| [MediaMarkt](https://www.mediamarkt.nl/) (marktplaats, verkoop door Powerness Europe GmbH NL) | Anker SOLIX Solarbank 3 E2700 Pro met Smart Meter, Growatt AURA 5000 (beide aansluitwijzen), Growatt NEXA 2000 | Actieprijzen met doorgestreepte prijs |
| MediaMarkt | EcoFlow STREAM AC Pro | Bijna uitverkocht, alleen afhalen; EcoFlow NL vraagt € 609 |
| [Solar Power Supply](https://www.solarpowersupply.nl/) | Jackery SolarVault 3 Pro, Pro Max en Pro Max AC; Lunergy Hub 2400 AC + BP5200 + P1-meter; EcoFlow STREAM 5000 | STREAM 5000 is pre-order (medio november 2026) |
| Fabrikantwinkels: [EcoFlow NL](https://nl.ecoflow.com/), [Marstek NL](https://www.marstek.nl/), [Zendure NL](https://www.zendure.nl/), [SAMDUO NL](https://nl.samduo.com/), [Sigenergy EU-store](https://eu-store.sigenergy.com/), [ZinVolt](https://zinvolt.com/), [NextEnergy](https://www.nextenergy.nl/) | STREAM AC 5000; Venus D, Venus E 4.0, Venus E Max; zeven SolarFlow-uitvoeringen; Nex E6000 en E6000H; SigenMate 2700 Ultra; ZinVolt Base en Power; Terugverdien Batterij | Variant zonder meter, extra accu of panelen; Marstek Venus E 4.0 en E Max leveren begin december 2026 |
| [Thuisbatterij.nl](https://thuisbatterij.nl/) | Indevolt PowerFlex 2000, SolidFlex 3000 AC | |
| [Slimmelaadpunt.nl](https://www.slimmelaadpunt.nl/) | EcoFlow STREAM AC | Bundel met Tibber Pulse |
| [NKON](https://www.nkon.nl/) | Voltdeer SR5000, SR5000 AC Pro (beide aansluitwijzen) | Pre-order, verzending 30 november 2026 |
| [MWenergie](https://www.mwenergie.nl/) (Benelux-distributeur) | MOVA LumeGret A4000 (beide aansluitwijzen) | Consumentenadviesprijs; verkoop alleen via een partner |

Werkwijze:

- Elke prijs is inclusief btw en zonder installatie. Noemt de pagina de btw niet, dan zeggen de voorwaarden dat en verwijzen ze naar de ACM-regel dat consumentenprijzen inclusief btw zijn. Een prijs voor twee aansluitwijzen van hetzelfde product hangt aan beide uitvoeringen; de aansluiting op een eigen groep zit er niet bij.
- Doorgestreepte prijzen, bundels (meters), voorraad en levertijd staan in de voorwaarden; de keuzehulp rekent met de aanbiedingsprijs.
- Niet opgenomen: uitverkochte of uit productie genomen uitvoeringen (AEG SolarCube 4,8 kWh, Zendure SolarFlow 800 Pro, Marstek Venus A, SAMDUO Nex P2800 Pro, Jackery HomePower 2000 Ultra), een Belgische winkel (Enphase 5P), alleen een prijs exclusief btw (Zonneplan Nexus, SigenStor), alleen een prijsbereik (Polarium Homevolt) en twijfel over de variant (Hoymiles HiBattery 4020 AC, Marstek Venus E 5,12 kWh).
- Geen Nederlandse winkelprijs gevonden voor AccuMate, AEG AS-BBH1, Anker SOLIX Solarbank 2 E1600 AC, Bluetti Balco, BYD HVS, Conow Lyra, Hoymiles MS-A2, HYXI Halo, Indevolt BK1600 en SolidFlex 2000, Jet GreenArk Pro, Lunergy X2400 AC, Marstek Plug & Charge, Venus C en Venus E Pro, Sunpura, TSUN PowerTrunk, Voltdeer SR2000 en de Tesla Powerwall 3P; daar vult de gebruiker een offertebedrag in.

Een zevende set, `crates/server/resources/references-nl-7.json` (sleutel `research-2026-10-25-nl-v7`), voegt de prijs van de [AlphaESS VitaPower 3600 AC](https://www.alphaess.nl/en/products/alphaess-vitapower-3600-ac?variant=57405999317367) toe: € 1.798 voor de variant ‘8kWh’ (hoofdunit met één uitbreidingsaccu, P1-meter inbegrepen), voor beide aansluitwijzen. De pagina noemt de btw niet en toont zowel ‘Op voorraad’ als ‘Tijdelijke pre-order’. De 4 kWh-variant (€ 999) staat niet als uitvoering in de catalogus.

Een achtste set, `crates/server/resources/references-nl-8.json` (sleutel `research-2026-10-26-nl-v8`, onderzocht 26 oktober 2026), vult ontbrekende gegevens aan bij bestaande uitvoeringen:

- AC-ontlaadvermogen: Zendure SolarFlow 3000 Mix AC+ (‘Tot 3 kW plug-and-play AC-vermogen’; volgens de FAQ volgen de definitieve gegevens nog) en 4000 Mix AC+ (plug-and-play maximaal 3 kW), [Growatt NEXA 2000](https://cdn.tepto.de/media/a8/8c/3c/1739365907/NEXA%202000_Datasheet_EN%20DE_202501.pdf) (800 W; datasheet van Growatt, gehost door een Duitse winkel), EcoFlow STREAM AC 5000 (‘800 W/3000 W’, gerekend met 800 W), SAMDUO Nex E6000 (800 W netgekoppeld; 2600 W is het bidirectionele vermogen), AEG SolarCube 4,8 kWh (800–2400 W, boven 800 W alleen op een eigen groep) en [Jackery SolarVault 3 Pro Max](https://nl.jackery.com/products/solarvault-3-pro-max) (800 W met stekker; 2.500 W pas na professionele installatie).
- Prijzen inclusief btw: Sunpura S2400 (€ 969, sunpuraenergy.nl), TSUN PowerTrunk MAU5000 (€ 1.399, bol; bol noemt 5,02 kWh), HYXI Halo (€ 899 bij BatterijXpert en € 799 bij Powerstationshop), Indevolt SolidFlex 2000 (€ 725, Thuisbatterij.nl, hybride variant) en Anker SOLIX Solarbank 2 E1600 AC (€ 599 na korting, ankersolix.com/nl).

Bewust niet opgenomen: uitverkochte of niet meer leverbare uitvoeringen (AccuMate BM2400, AEG SolarCube, Hoymiles MS-A2, Jackery HomePower 2000 Ultra, Conow Lyra 2500 AC, Marstek Venus A, Lunergy X2400 AC, Voltdeer SR2000), prijzen van buitenlandse webwinkels (Bluetti EU met Duitse btw, Indevolt Europe voor de BK1600), twijfel over de variant (Hoymiles HiBattery 4020 AC, Marstek Venus E 5,12 kWh) en claims van webwinkels over de Jackery SolarVault 3 Pro Max AC bij de Pro Max. Schattingen zonder bron staan niet in de catalogus.

De interface toont een onderzochte uitvoering alleen als de keuzehulp hem zonder eigen invoer kan doorrekenen: bruikbare of nominale capaciteit, AC-ontlaadvermogen in W, een prijs inclusief btw en een ingebouwde of geprijsde omvormer (`complete` in `web/data.js`). De overige bronclaims blijven in de database staan; de catalogus meldt hoeveel uitvoeringen er niet bij staan. Zelf toegevoegde uitvoeringen blijven altijd zichtbaar (`researched` in `GET /api/v1/comparison`).

Na drie maanden (vanaf 24 januari 2027) tonen de catalogus en de keuzehulp een melding dat prijzen en tarieven verouderd kunnen zijn. De interface laadt bij elk bezoek ontbrekende sets bij, ook in bestaande databases (`GET /api/v1/references` meldt hoeveel er ontbreken); eerder geladen sets worden niet opnieuw ingevoegd en bestaande claims veranderen niet.

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
