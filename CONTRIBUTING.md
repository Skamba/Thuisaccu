# Ontwikkelafspraken

- Schrijf code en identifiers in het Engels; projectdocumentatie en interface zijn voorlopig Nederlands.
- Houd rekenlogica in `thuisaccu-core`. Deze crate blijft onafhankelijk van HTTP, UI en opslag.
- Zet adapters, configuratie en HTTP-contracten in `thuisaccu-server`.
- Maak eenheden, valuta, tijdzone, tijdresolutie, bron en peildatum expliciet bij het ontwerpen van invoer.
- Leg regionale regels vast als scenario-invoer of afzonderlijk geconfigureerde beleidsonderdelen. Bouw geen stilzwijgende marktregels in de rekenkern.
- Schrijf gedragstests bij nieuwe berekeningen en API-contracten. Leg testdata en aannames vast; gebruik geen persoonlijke energiegegevens in Git.
- Voer de controles uit de README uit voordat je een wijziging aanbiedt.
- Commit `Cargo.lock` bij wijzigingen aan dependencies; commit geen `.env` of secrets.

De eerste domeinmodellen, analysemethode en databronnen moeten nog worden gekozen. Introduceer die op basis van expliciete eisen en leg beslissingen vast in `docs/`.

