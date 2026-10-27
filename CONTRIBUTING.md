# Ontwikkelafspraken

- Schrijf code en identifiers in het Engels; projectdocumentatie en interface zijn voorlopig Nederlands.
- Houd rekenlogica in `thuisaccu-core`. Deze crate blijft onafhankelijk van HTTP, UI en opslag.
- Zet adapters, configuratie en HTTP-contracten in `thuisaccu-server`.
- Maak eenheden, valuta, tijdzone, tijdresolutie, bron en peildatum expliciet bij het ontwerpen van invoer.
- Leg regionale regels vast als scenario-invoer of afzonderlijk geconfigureerde beleidsonderdelen. Bouw geen stilzwijgende marktregels in de rekenkern.
- Schrijf gedragstests bij nieuwe berekeningen en API-contracten. Leg testdata en aannames vast; gebruik geen persoonlijke energiegegevens in Git.
- Voer de controles uit de README uit voordat je een wijziging aanbiedt.
- Verander je een constante die de interface uit Rust overneemt (modelversie, offertevelden, grenzen van de invoer, doelen, meldingscodes), vernieuw dan `web/contract.js` met `UPDATE_CONTRACT=1 cargo test -p thuisaccu-server --test contract`. Bewerk dat bestand nooit met de hand.
- Commit `Cargo.lock` bij wijzigingen aan dependencies; commit geen `.env` of secrets.

De domeinmodellen, analysemethode en bronmomentopnamen staan in de code en `docs/`. Leg wijzigingen aan hun betekenis expliciet vast en houd de documentatie in lijn met de implementatie.

