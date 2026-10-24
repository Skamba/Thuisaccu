# Onderzoek: welke accugegevens leggen we vast?

Onderzocht op 24 oktober 2026. Dit document bepaalt de eerste datastructuur; het is geen productadvies of actuele prijslijst. De productdocumenten hieronder dienen als voorbeelden om het model te toetsen. Er worden geen productgegevens automatisch in de database geladen.

## Bevindingen uit primaire bronnen

De [BYD HVS-datasheet, BCU 2.0, V1.0](https://site.bydbatterybox.com/uploads/downloads/BCU2.0_BBOX_HVS_Datasheet_EN_V1.0_250328-67ee42d4ced21.pdf) onderscheidt module en configuratie. De voetnoten verbinden bruikbare energie aan DC, ontladingsdiepte, C-rate en temperatuur. De benodigde omvormer beïnvloedt de uiteindelijk beschikbare systeemenergie. Hieruit volgt onze keuze om configuratie, meetgrens en testcondities apart vast te leggen.

De [Tesla Powerwall 3-specificaties, Amerikaanse uitvoering](https://energylibrary.tesla.com/docs/Public/EnergyStorage/Powerwall/3/InstallManual/Gateway/3/en-us/GUID-EC527BC7-4750-4425-BBC4-DB8C000339B3.html) onderscheiden onder meer laad- en ontlaadvermogen, uitbreidingseenheden, netconfiguratie, aansluitspanning en rendement van verschillende energiepaden. Ook verschillen IP-bescherming en gewicht per onderdeel of uitvoering. Eén capaciteit, één vermogen en één rendement zijn daarom onvoldoende als productbeschrijving. De bron beschrijft een regionale uitvoering; eigenschappen worden niet overgenomen naar andere markten.

De [BYD-compatibiliteitslijst V2.22 van 10 oktober 2026](https://site.bydbatterybox.com/uploads/downloads/BCU2.0_261010_BYD_Battery_Box_Premium_HVS%26HVM_Compatible_Inverter_List_V2.22-6ac9cfeb73807.pdf) koppelt omvormers aan aantallen modules en firmwarevereisten. Parallelle opstellingen kennen aanvullende beperkingen. Compatibiliteit wordt daarom een gedateerde relatie met voorwaarden, geen algemeen ja/nee-veld op de accu.

De [BYD Europese garantievoorwaarden](https://site.bydbatterybox.com/uploads/downloads/BCU2.0_BYD%20Battery-Box%20Premium%20HVS%26HVM%20Limited%20Warranty-Europe-EN-V1.0-67eb5bb39ed39.pdf) onderscheiden product- en prestatiegarantie. De prestatievoorwaarden combineren looptijd, resterende capaciteit en energie-doorzet, met een grens die als eerste bereikt kan worden. Het document heeft in de inhoud revisie V1.2, terwijl de downloadnaam V1.0 vermeldt. Dit onderstreept waarom we documentrevisie, vindplaats en eventueel een archiefhash vastleggen. Garantie wordt als bronclaim geregistreerd; het systeem interpreteert geen juridische aanspraken.

De [HTW Berlin Stromspeicher-Inspektion 2026](https://solar.htw-berlin.de/studien/stromspeicher-inspektion-2026/) vergelijkt complete combinaties van batterijen en omvormers en bespreekt standbyverbruik, deellastverliezen, regeling en garantievoorwaarden. De [methodetoelichting van de Stromspeicher-Inspektor](https://solar.htw-berlin.de/rechner/stromspeicher-inspektor/) maakt onderscheid tussen SPI-referentiegevallen van 5 en 10 kW. Onze datastructuur houdt die indices apart van round-trip-rendement. Een labmeting krijgt een eigen bron en kan naast een fabrikantclaim blijven bestaan.

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
