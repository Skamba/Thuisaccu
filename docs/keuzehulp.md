# Keuzehulp

De keuzehulp (`#/keuzehulp`, ook het startscherm) is de begeleide route voor consumenten zonder technische voorkennis. Hij stelt vragen in gewone taal, maakt zo nodig een geschat energieprofiel, laat zien welke accugrootte zinvol is, filtert de catalogus op praktische eisen en rekent passende accu’s door met dezelfde rekenkern als de scenariotool. ‘Geen accu’ blijft een volwaardige uitkomst. Het resultaat is een gewone, onveranderlijke analyse die je kunt dupliceren en in de scenariotool verder kunt verfijnen.

## Stappen

1. **Je energie.** Zonnepanelen ja/nee en welke gegevens je hebt. Met jaartotalen vul je netafname, teruglevering en opwek (of kWp en ligging) in. Bruto verbruik wordt afgeleid als `netafname + opwek − teruglevering`. Dat klopt alleen zonder bestaande accu. Met een bestand kies je een bewaard, ROI-geschikt profiel.
2. **Je woning.** Stekker of vaste installatie, 1- of 3-fase, binnen of buiten en of noodstroom nodig is.
3. **Je contract.** Contractsoort, all-in stroomprijs, terugleververgoeding vanaf 2027 en terugleverkosten. Een knop vult gedateerde indicaties in (zie hieronder). Bij een dynamisch contract meldt de keuzehulp dat handelswaarde nog niet wordt berekend.
4. **Wat je belangrijk vindt.** Doel (NPV, terugverdientijd of eigen gebruik), optioneel budget en horizon van 10, 15 of 20 jaar.
5. **Advies.** Capaciteitscurve, passende accu’s met redenen, een expliciete keuze voor installatiekosten, drie bevestigingen en de berekening.

Antwoorden worden als concept in `localStorage` (`thuisaccu-keuzehulp`) bewaard; zonder browseropslag werkt de keuzehulp gewoon. Er gaat niets naar externe diensten.

## Geschat profiel uit jaartotalen

`POST /api/v1/solar/typical` maakt een volledig uurprofiel en bewaart het als gemodelleerde import (`generator: typical-nl-v1`). De vormen zijn ingebakken bronmomentopnamen in `crates/server/resources/typical-profiles.json`, gebouwd met `tools/build_typical_profiles.py`:

| Reeks | Bron | Toepassing |
| --- | --- | --- |
| Verbruik | [Energiedatawijzer, Standaardprofielen elektriciteit 2026 versie 1.00](https://energiedatawijzer.nl/documenten/profielen-elektriciteit-2026/), categorie E1A (≤ 3×25 A), aansluitingen zonder invoeding, afname | Kwartierfracties opgeteld per UTC-uur van kalenderjaar 2026 (Amsterdam) en geschaald naar het bruto jaarverbruik |
| Opwek | [PVGIS 5.3](https://re.jrc.ec.europa.eu/pvg_tools/en/), SARAH3/ERA5, De Bilt (52,101 N; 5,177 O), weerjaar 2023, 1 kWp, 14% systeemverlies, 35° helling | Zuid, zuidoost, zuidwest, oost en west; oost-west is het gemiddelde van oost en west. Geschaald naar de opgegeven jaaropwek, of kWp × PVGIS-jaaropbrengst |

Opbrengst per kWp in dit weerjaar: zuid 1.005,7, zuidoost 960,2, zuidwest 945,4, oost 822,1 en west 803,7 kWh. 2023 was een zonnig jaar; daarom vraagt de keuzehulp bij voorkeur de jaaropbrengst uit de omvormer-app.

Grenzen: een standaardprofiel is een gemiddelde over veel huishoudens en dus gladder dan één huishouden. Korte pieken (koken, wasmachine) en dagen zonder verbruik ontbreken, waardoor vermogensgrenzen van een accu minder vaak knellen. Warmtepomp, laadpaal en thuiswerken zitten niet in E1A. Het weer is dat van één jaar op één plek. De import, de analysewaarschuwing en het resultaat dragen daarom het label GESCHAT PROFIEL.

## Capaciteitscurve

`GET /api/v1/solar/imports/{id}/capacity` simuleert een verliesvrije accu zonder vermogensgrens, standby of slijtage voor 0 tot 20 kWh, twee keer achter elkaar zodat de beginlading niet meetelt. De uitkomst is een bovengrens voor zonnestroom die via de accu zelf wordt gebruikt. De keuzehulp noemt het bereik waarbinnen 75% tot 90% van de waarde bij 20 kWh wordt gehaald ‘zinvol’. Dit is een hulpmiddel bij de keuze, geen productberekening en geen advies over een exacte grootte.

## Van bronclaim naar rekengegevens

De browser leidt per catalogusuitvoering rekengegevens af en toont elke aanname bij de accu:

| Rekengegeven | Gebruikte claim | Als die ontbreekt |
| --- | --- | --- |
| Bruikbare capaciteit | `usable_energy_wh`, anders `nominal_energy_wh × depth_of_discharge_pct` | Aanname 90% van `nominal_energy_wh`; zonder energieclaim niet doorrekenbaar |
| Ontladen | `continuous_discharge_power_w` | Niet doorrekenbaar; kVA wordt niet als kW gebruikt |
| Laden | `continuous_charge_power_w` | Aanname: gelijk aan ontladen |
| Rendement | `round_trip_efficiency_pct`; bij een bereik de ondergrens. Andere meetgrenzen worden als AC→AC-aanname benoemd | Aanname 85% |
| Standby | `standby_power_w` | Aanname 5 W |
| Slijtage en levensduur | — | Aanname 2% per jaar en 15 jaar, geen garantie |

Uitvoeringen met een niet doorrekenbaar gegeven of een harde mismatch (bijvoorbeeld 3-fase bij een 1-fase-aansluiting, stekker versus vaste installatie, geen noodstroom terwijl dat gevraagd is) zijn zichtbaar maar niet aan te vinken. Het soort aansluiting komt uit de tekstclaim `coupling`; de Nederlandse momentopnamen gebruiken daarvoor ‘AC-gekoppeld (stekker)’, ‘AC-gekoppeld (vaste installatie)’ en ‘Hybride omvormer’.

## Kosten en indicaties

Per accu worden alle 26 kostenposten ingevuld. De aanschafprijs komt uit een gepubliceerde aanbieding (inclusief btw, met bron) of uit eigen invoer. Installatie is bij een stekkerbatterij ‘niet van toepassing’. Bij een vaste installatie is het een offertebedrag of, na expliciete keuze, een indicatie. Alle overige posten staan op ‘niet van toepassing’ met de bron ‘Keuzehulp: niet meegenomen in deze indicatie’; de interface noemt ze één voor één. Wie ze wil beoordelen, dupliceert de analyse naar de scenariotool.

Indicaties, geraadpleegd op 24 oktober 2026:

| Waarde | Indicatie | Onderbouwing |
| --- | --- | --- |
| All-in stroomprijs | € 0,2596/kWh | [CBS](https://www.cbs.nl/nl-nl/maatwerk/2026/42/verdeling-energietarieven-2026): gemiddeld variabel leveringstarief september 2026 € 0,1487 incl. btw, exclusief energiebelasting; plus [energiebelasting 2026](https://www.anwb.nl/huis/energie/energiebelasting) € 0,11085 incl. btw |
| Terugleververgoeding vanaf 2027 | € 0,0744/kWh | Wettelijk minimaal 50% van de kale leveringsprijs tot 2030 ([Solar Magazine](https://solarmagazine.nl/nieuws-zonne-energie/i39030/salderingsregeling-hoogte-terugleververgoeding-en-verlaging-terugleverkosten-in-wet-vastgelegd-door-tweede-kamer)); 50% × € 0,1487 = € 0,07435, naar boven afgerond. Niet geverifieerd of de grens incl. of excl. btw geldt |
| Terugleverkosten | € 0 | Alleen als je contract er geen noemt; hogere kosten maken een accu gunstiger |
| Installatie vaste accu | € 1.349 | Vanaf-prijs basisinstallatie van één aanbieder ([Batterij-Outlet](https://www.batterij-outlet.nl/nl/installatie/pakketprijzen/)) |

Overige projectie-aannames komen uit de standaardaannames in Instellingen (anders 4% discontovoet, 2% kostenstijging, 0% PV-afname, verbruiksgroei en prijsverandering, 20% en 15% gevoeligheid). Startjaar is 2027, het eerste jaar zonder salderen. Een adres is optioneel; zonder adres wordt ‘Nederland (keuzehulp, geen adres opgegeven)’ vastgelegd.

## Voorbereid op dynamische tarieven

De contractsoort wordt al gevraagd en een dynamisch contract krijgt een expliciete melding. Er is nog geen tariefreeks of handelsstrategie in de rekenkern. Zie de [roadmap](roadmap.md).
