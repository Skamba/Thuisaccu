#!/usr/bin/env python3
"""Bouwt crates/core/src/load_spread.rs uit de 1-secondeprofielen van HTW Berlin.

Eenmalig offline te draaien; de dataset zelf hoort niet in Git. Gebruik:

    python3 tools/build_load_spread.py <MAT_74_Loadprofiles_1s_W_var.mat> crates/core/src/load_spread.rs

Bron: Tjaden, T.; Bergner, J.; Weniger, J.; Quaschning, V.: "Representative electrical load
profiles of residential buildings in Germany with a temporal resolution of one second",
dataset, HTW Berlin, licentie CC BY-NC 4.0 (readme: "CC-BY-NV-4.0"),
https://solar.htw-berlin.de/elektrische-lastprofile-fuer-wohngebaeude/ ,
documentatie http://dx.doi.org/10.13140/RG.2.1.3713.1606/1 .
74 huishoudens, één jaar (2010, wintertijd), werkelijk vermogen per fase per seconde.

Per meetperiode (5, 10, 15, 30 en 60 minuten) en per huishouden worden de seconden van elk
interval gesorteerd en in tien even grote banden gemiddeld, gedeeld door het
intervalgemiddelde. Die vormen worden gemiddeld per klasse van het intervalgemiddelde (kW).
Alleen deze gemiddelden over alle huishoudens komen in de uitvoer, geen individuele profielen.
Vereist numpy en h5py.
"""
import sys
from multiprocessing import Pool

import h5py
import numpy as np

SOURCE, OUTPUT = sys.argv[1:3] if len(sys.argv) >= 3 else (None, None)
PERIODS = [300, 600, 900, 1800, 3600]
EDGES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 6.0]
BANDS = 10
MIN_INTERVALS = 20


def household(h):
    with h5py.File(SOURCE, "r") as f:
        watt = f["PL1"][h, :].astype(np.int32) + f["PL2"][h, :] + f["PL3"][h, :]
    # Saldo over de fasen; een enkel negatief saldo telt als geen verbruik.
    kw = np.maximum(watt, 0).astype(np.float64) / 1000
    out = []
    for period in PERIODS:
        intervals = np.sort(kw.reshape(-1, period), axis=1)
        mean = intervals.mean(axis=1)
        keep = mean >= 0.02
        bands = intervals[keep].reshape(keep.sum(), BANDS, -1).mean(axis=2) / mean[keep, None]
        classes = np.digitize(mean[keep], EDGES) - 1
        sums = np.zeros((len(EDGES), BANDS))
        np.add.at(sums, classes, bands)
        out.append((sums, np.bincount(classes, mean[keep], len(EDGES)), np.bincount(classes, None, len(EDGES))))
    return out


def main():
    with h5py.File(SOURCE, "r") as f:
        count = f["PL1"].shape[0]
    assert count == 74, count
    with Pool(8) as pool:
        results = pool.map(household, range(count))
    lines = [
        "//! Gegenereerd door `tools/build_load_spread.py`; niet met de hand bewerken.",
        "//!",
        "//! Gemiddelde verdeling van huishoudelijk verbruik binnen een meetperiode, afgeleid uit",
        "//! Tjaden, Bergner, Weniger en Quaschning, \"Representative electrical load profiles of",
        "//! residential buildings in Germany with a temporal resolution of one second\", HTW Berlin,",
        "//! CC BY-NC 4.0: 74 huishoudens, 2010, vermogen per seconde opgeteld over drie fasen.",
        "//! Per meetperiode: (gemiddeld vermogen in kW, tien even lange delen van de periode van",
        "//! laag naar hoog verbruik, elk als factor van het gemiddelde).",
        "",
        "/// Gemiddeld vermogen in kW en de tien factoren voor die klasse.",
        "pub(crate) type Row = (f64, [f64; 10]);",
        "",
        "// Meetwaarden die toevallig op wiskundige constanten lijken (zoals 2,7183), geen benaderingen ervan.",
        "#[allow(clippy::approx_constant)]",
        "#[rustfmt::skip]",
        "pub(crate) const TABLES: &[(u32, &[Row])] = &[",
    ]
    for p, period in enumerate(PERIODS):
        sums = sum(r[p][0] for r in results)
        refs = sum(r[p][1] for r in results)
        counts = sum(r[p][2] for r in results)
        lines.append(f"    ({period}, &[")
        for c in range(len(EDGES)):
            if counts[c] < MIN_INTERVALS:
                continue
            shape = sums[c] / counts[c]
            shape = shape / shape.mean()
            values = ", ".join(f"{v:.4f}" for v in shape)
            lines.append(f"        ({refs[c] / counts[c]:.4f}, [{values}]),")
        lines.append("    ]),")
    lines.append("];")
    with open(OUTPUT, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
