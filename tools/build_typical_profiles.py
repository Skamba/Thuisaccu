#!/usr/bin/env python3
"""Bouwt crates/server/resources/typical-profiles.json uit openbare bronnen.

Eenmalig offline te draaien; de server downloadt niets. Gebruik:

    python3 tools/build_typical_profiles.py <standaardprofielen.csv> <pvgis-map> <uitvoer.json>

- Standaardprofielen: "Standaardprofielen elektriciteit 2026 versie 1.00.csv" uit
  https://energiedatawijzer.nl/app/uploads/Documenten/Profielen/Profielen/Profielen-elektriciteit-2026-v1.01.zip
  Kolom E1A_AZI_A: kleinverbruik <= 3x25 A zonder invoeding, afname. Kolom A is
  het einde van het kwartier in UTC+1 (doorlopende wintertijd).
- PVGIS 5.3 seriescalc, De Bilt (52.101, 5.177), 2023, 1 kWp, 14% systeemverlies,
  helling 35 graden, azimut 0/-45/45/-90/90, bestanden pv_<azimut>.json. De luchttemperatuur
  T2m uit pv_0.json levert de graaduren voor het warmtepompdeel:
  https://re.jrc.ec.europa.eu/api/v5_3/seriescalc?lat=52.101&lon=5.177&peakpower=1&loss=14&angle=35&aspect=<azimut>&startyear=2023&endyear=2023&pvcalculation=1&outputformat=json
"""
import csv
import json
import sys
from datetime import datetime, timedelta, timezone

profile_csv, pvgis_dir, output = sys.argv[1:4]

rows = []
with open(profile_csv, newline="", encoding="latin-1") as handle:
    for line in csv.reader(handle, delimiter=";"):
        if line and len(line) > 3 and line[0][:2].isdigit() and "-" in line[0]:
            rows.append((line[0], float(line[3])))
assert len(rows) == 35040, len(rows)
first_end = datetime.strptime(rows[0][0], "%d-%m-%Y %H:%M").replace(tzinfo=timezone(timedelta(hours=1)))
start = first_end - timedelta(minutes=15)
assert start.astimezone(timezone.utc) == datetime(2025, 12, 31, 23, tzinfo=timezone.utc)
hourly = [sum(v for _, v in rows[i * 4:i * 4 + 4]) for i in range(8760)]
total = sum(hourly)
# Breuken per uur als gehele delen per miljard; de server normaliseert opnieuw.
load = [round(v / total * 1e9) for v in hourly]

orientations = {}
yields = {}
for key, azimuth in [("south", 0), ("south_east", -45), ("south_west", 45), ("east", -90), ("west", 90)]:
    with open(f"{pvgis_dir}/pv_{azimuth}.json", encoding="utf-8") as handle:
        data = json.load(handle)
    hours = data["outputs"]["hourly"]
    assert len(hours) == 8760 and hours[0]["time"].startswith("20230101:00")
    # PVGIS-uur 0 is 1 januari 00:00 UTC; profieluur 0 is 31 december 23:00 UTC.
    watts = [h["P"] for h in hours]
    shifted = [watts[(i - 1) % 8760] for i in range(8760)]
    orientations[key] = [round(w * 10) for w in shifted]
    yields[key] = round(sum(watts) / 1000, 1)
    if azimuth == 0:
        # Graaduren onder de Nederlandse stookgrens van 18 °C, uit de luchttemperatuur T2m
        # van hetzelfde weerjaar; vorm voor het ruimteverwarmingsdeel van een warmtepomp.
        temperature = [h["T2m"] for h in hours]
        degree_hours = [round(max(0.0, 18.0 - temperature[(i - 1) % 8760]) * 100) for i in range(8760)]

json.dump({
    "start_unix_s": int(start.timestamp()),
    "interval_s": 3600,
    "load": {
        "source": "Energiedatawijzer (Het Normo/MFFBAS), Standaardprofielen elektriciteit 2026 versie 1.00, profielcategorie E1A, aansluitingen zonder invoeding (AZI), afname",
        "url": "https://energiedatawijzer.nl/documenten/profielen-elektriciteit-2026/",
        "unit": "fractie van het jaarverbruik x 1e9 per uur (UTC)",
        "values": load,
    },
    "pv": {
        "source": "PVGIS 5.3 (EU JRC), SARAH3/ERA5, De Bilt 52,101 N 5,177 O, weerjaar 2023, 1 kWp c-Si, 14% systeemverlies, helling 35 graden, vrijstaand",
        "url": "https://re.jrc.ec.europa.eu/pvg_tools/en/",
        "unit": "0,1 Wh AC per kWp per uur (UTC)",
        "annual_kwh_per_kwp": yields,
        "orientations": orientations,
    },
    "heating": {
        "source": "PVGIS 5.3 (EU JRC), luchttemperatuur T2m op 2 m, De Bilt, weerjaar 2023; graaduren onder 18 °C",
        "url": "https://re.jrc.ec.europa.eu/pvg_tools/en/",
        "unit": "0,01 graaduur per uur (UTC)",
        "base_c": 18,
        "degree_hours": degree_hours,
    },
}, open(output, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
print("geschreven", output, yields)
