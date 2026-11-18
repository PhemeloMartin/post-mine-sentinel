# Mine register (prototype)

`curated_mines.csv` is the human-edited source of truth (reviewable in pull requests). `data/scripts/build_mines.py` validates it and publishes `sa_mines.json` (consumed by the API seed and the 3D console) plus `VALIDATION_REPORT.md`.

## What it contains

119 notable South African mines across all major commodities and provinces: Witwatersrand gold (Central, West, Far West, East and Far East Rand; KOSH; Free State), Barberton and Pilgrim's Rest gold, Kimberley and Namaqualand diamonds, Bushveld PGMs, Highveld/Witbank/Waterberg/KZN coal, Northern Cape iron, manganese, copper and zinc, and derelict asbestos and tin mines.

| Column | Meaning |
|---|---|
| `lat`, `lon`, `precision_m` | Approximate location and its stated uncertainty radius |
| `opened`, `closed`, `dates_conf` | Operating years and confidence |
| `status` | operating · restarted · care_maintenance · closed · derelict · rehabilitated |
| `prod_low`, `prod_high`, `prod_unit`, `prod_conf` | Historic production **range** (t Au, Mct, Moz 4E, Mt, kt) |
| `illegal_reported`, `illegal_last_year` | Publicly reported illegal mining at or next to the site |
| `flooded`, `sealed` | Accessibility modifiers used by the RAI |

## Honesty about the data

* Coordinates are **approximate** (town or mine-area level, see `precision_m`) and must not be used for navigation.
* Most production ranges are **order-of-magnitude estimates marked `low` confidence**. Some figures (e.g. the Kimberley Big Hole's 14.5 Mct) are well established. *Residual* figures are **modelled** (remnant fractions in `ml/sentinel_ml/risk/rai.py`), not reserves.
* Before operational use, replace the register with the official **D&O database** and **SAMINDABA** records ([PAIA request template](../../docs/policies/paia-request-template.md)).

## Validation rules (CI-enforced)

Schema and enumerations · year sanity (`closed ≥ opened`, operating mines have no closure year) · **point-in-polygon check that each mine lies in its stated province** (geoBoundaries ADM1) · **near-duplicate coordinate detection within 150 m**. The last two directly address the Auditor-General's finding of duplicate GPS coordinates in the state register. The validator caught three border cases (Kopanang and Moab Khotsong on the Vaal River; Two Rivers in the Steelpoort valley), which were reassigned from the authoritative geometry.

## Attribution

Province boundaries: geoBoundaries gbOpen ZAF ADM1 (OCHA ROSEA / Municipal Demarcation Board), CC BY 3.0 IGO. Town populations in `towns.csv` are rounded approximations for the gravity model.
