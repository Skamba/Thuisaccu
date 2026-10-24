# Vervolgstappen

De eerste versie bevat brongebonden productonderzoek in SQLite, productvergelijking, dossier-/offerte-invoer en zonne-opwekimport. De Nederlandse scenariotool bevat adresopzoeken, simulatie voor eigen zonnestroom, een volledige kostenbeoordeling, ROI/NPV/terugverdientijd, keuzecriteria en bewaarde analyses. Zie [rekenmodel en grenzen](roi-model.md). De volgende onderdelen staan nog open.

1. Verrijk productdossiers met volledige garantievoorwaarden, compatibiliteitsmatrices, accessoires, actuele offertes en onafhankelijke meetgegevens. Ontwerp hiervoor uitgebreide invoer en reviewbediening.
2. Combineer verbruik en opwek uit afzonderlijke bestanden (bijvoorbeeld een P1-export en een omvormerexport); één bestand met opwek, netafname en teruglevering wordt al ondersteund met controle van tijdsuitlijning en meetgrenzen. Ondersteun een expliciete herleiding van bruto verbruik uit netmetingen waar de beschikbare reeksen dat toelaten.
3. Breid onafhankelijke referentiescenario's uit met geanonimiseerde jaarprofielen en veldmetingen. Onderzoek het effect van tijdresolutie en variabele rendementscurves.
4. Zoek automatisch een reeks capaciteiten en vermogens af binnen fysiek geschikte uitvoeringen, met expliciete omvormer-, fase- en installatiebeperkingen.
5. Voeg dynamische tariefreeksen toe, als eerste stap naar de keuzehulp: de contractsoort wordt daar al gevraagd. Daarna contractwissels, contractwissels, optimale aansturing en expliciete handelsstrategieën toe. Breid geldstromen uit met tijdelijke jaarposten, fiscaal maatwerk en afzonderlijke financieringskasstromen wanneer nodig. Houd handelsopbrengsten en garanties strikt uit elkaar.
6. Ondersteun meer leveranciersspecifieke exportvarianten met echte, geanonimiseerde testbestanden. Voeg expliciete mapping voor brede rapporten en meerdere inverter-/paneelreeksen toe.
7. Voeg bewerking/herberekening van bewaarde scenario's en resultaat-export toe. Houd oorspronkelijke uitkomsten en modelversies beschikbaar en voeg marktregels voor andere landen toe.
8. Ontwerp productiehosting, authenticatie, back-upbediening en eventuele schaalvergroting wanneer concrete gebruikseisen daarom vragen.

Het onderzoeksmodel blijft generiek. De huidige scenario-adapter gebruikt Nederlandse regels en EUR. De drie optionele referentie-uitvoeringen zijn gedateerde bronvoorbeelden; een advies ontstaat alleen binnen de expliciet ingevulde technische en financiële scenario-aannames.
