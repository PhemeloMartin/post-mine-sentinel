"""Validate the curated mine register and publish ``data/mines/sa_mines.json``.

Pipeline
--------
1. Parse ``curated_mines.csv`` (human-edited, reviewable in a PR diff).
2. Validate every record (schema, enumerations, year sanity, coordinates inside
   the stated province using point-in-polygon, near-duplicate coordinates).
   Duplicate / misplaced coordinates were a specific finding of the Auditor-General's
   2022 report on the derelict & ownerless mines database, so they are hard errors here.
3. Score each record with the Residual Attraction Index (``sentinel_ml.risk``).
4. Write the JSON register consumed by the API seed and the 3D command centre,
   plus a Markdown validation report.

Usage:  python data/scripts/build_mines.py [--as-of 2026] [--strict]
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml"))

from sentinel_ml.geo import haversine_m, point_in_multipolygon  # noqa: E402
from sentinel_ml.risk.rai import MineRecord, Town, score_register  # noqa: E402

MINES_CSV = ROOT / "data" / "mines" / "curated_mines.csv"
TOWNS_CSV = ROOT / "data" / "mines" / "towns.csv"
PROVINCES = ROOT / "data" / "geo" / "za_provinces_validation.geojson"
OUT_JSON = ROOT / "data" / "mines" / "sa_mines.json"
OUT_REPORT = ROOT / "data" / "mines" / "VALIDATION_REPORT.md"

COMMODITIES = {"gold", "diamonds", "pgm", "coal", "iron", "manganese", "copper", "zinc", "asbestos", "tin", "chrome"}
STATUSES = {"operating", "care_maintenance", "closed", "derelict", "rehabilitated", "restarted"}
METHODS = {"underground", "open_pit", "both", "alluvial", "tailings"}
CONFIDENCE = {"high", "medium", "low"}
PROVINCE_NAMES = {
    "EC": "Eastern Cape", "FS": "Free State", "GP": "Gauteng", "KZN": "KwaZulu-Natal", "LP": "Limpopo",
    "MP": "Mpumalanga", "NW": "North West", "NC": "Northern Cape", "WC": "Western Cape",
}
DUPLICATE_RADIUS_M = 150.0


def _f(v: str) -> float | None:
    return float(v) if v.strip() else None


def _i(v: str) -> int | None:
    return int(v) if v.strip() else None


def load_towns() -> list[Town]:
    with TOWNS_CSV.open(encoding="utf-8") as fh:
        return [Town(r["name"], float(r["lat"]), float(r["lon"]), int(r["population"])) for r in csv.DictReader(fh)]


def validate(rows: list[dict], provinces: dict, as_of: int) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    seen_ids: set[str] = set()
    for r in rows:
        rid = r["id"]
        if rid in seen_ids:
            errors.append(f"{rid}: duplicate id")
        seen_ids.add(rid)
        if r["commodity"] not in COMMODITIES:
            errors.append(f"{rid}: unknown commodity '{r['commodity']}'")
        if r["status"] not in STATUSES:
            errors.append(f"{rid}: unknown status '{r['status']}'")
        if r["method"] not in METHODS:
            errors.append(f"{rid}: unknown method '{r['method']}'")
        for col in ("dates_conf", "prod_conf"):
            if r[col] not in CONFIDENCE:
                errors.append(f"{rid}: {col} must be one of {sorted(CONFIDENCE)}")
        opened, closed = _i(r["opened"]), _i(r["closed"])
        if opened and not 1850 <= opened <= as_of:
            errors.append(f"{rid}: opened year {opened} out of range")
        if closed and opened and closed < opened:
            errors.append(f"{rid}: closed ({closed}) before opened ({opened})")
        if r["status"] == "operating" and closed:
            errors.append(f"{rid}: operating mine has a closure year")
        if r["status"] in {"closed", "derelict"} and not closed:
            warnings.append(f"{rid}: {r['status']} but closure year unknown")
        lo, hi = _f(r["prod_low"]), _f(r["prod_high"])
        if (lo is None) != (hi is None) or (lo is not None and hi is not None and lo > hi):
            errors.append(f"{rid}: invalid production range [{lo}, {hi}]")
        if r["prod_conf"] == "low" and lo is not None:
            warnings.append(f"{rid}: production range is a low-confidence estimate")

        lat, lon = float(r["lat"]), float(r["lon"])
        geom = provinces.get(r["province"])
        if geom is None:
            errors.append(f"{rid}: unknown province code {r['province']}")
        elif not point_in_multipolygon(lon, lat, geom):
            hit = next((code for code, g in provinces.items() if point_in_multipolygon(lon, lat, g)), "outside SA")
            errors.append(f"{rid}: coordinates ({lat}, {lon}) fall in {hit}, not {r['province']}")

    for i, a in enumerate(rows):
        for b in rows[i + 1:]:
            d = haversine_m(float(a["lat"]), float(a["lon"]), float(b["lat"]), float(b["lon"]))
            if d < DUPLICATE_RADIUS_M:
                errors.append(f"{a['id']} and {b['id']}: coordinates only {d:.0f} m apart (possible duplicate)")
    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--as-of", type=int, default=date.today().year)
    parser.add_argument("--strict", action="store_true", help="treat warnings as errors")
    args = parser.parse_args()

    with MINES_CSV.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    geo = json.loads(PROVINCES.read_text(encoding="utf-8"))
    provinces = {f["properties"]["code"]: f["geometry"]["coordinates"] for f in geo["features"]}

    errors, warnings = validate(rows, provinces, args.as_of)

    records = [
        MineRecord(
            id=r["id"], name=r["name"], commodity=r["commodity"], lat=float(r["lat"]), lon=float(r["lon"]),
            method=r["method"], status=r["status"], opened=_i(r["opened"]), closed=_i(r["closed"]),
            max_depth_m=_f(r["max_depth_m"]), prod_low=_f(r["prod_low"]), prod_high=_f(r["prod_high"]),
            prod_unit=r["prod_unit"], illegal_reported=r["illegal_reported"] == "1",
            illegal_last_year=_i(r["illegal_last_year"]), flooded=r["flooded"], sealed=r["sealed"] == "1",
        )
        for r in rows
    ]
    scores = {s.mine_id: s for s in score_register(records, load_towns(), args.as_of)}

    mines_out = []
    for r in rows:
        s = scores[r["id"]]
        mines_out.append({
            "id": r["id"],
            "name": r["name"],
            "commodity": r["commodity"],
            "secondary": [x.strip() for x in r["secondary"].split(",") if x.strip()],
            "province": r["province"],
            "provinceName": PROVINCE_NAMES[r["province"]],
            "locality": r["locality"],
            "lat": float(r["lat"]),
            "lon": float(r["lon"]),
            "precisionM": int(r["precision_m"]),
            "field": r["field"],
            "method": r["method"],
            "opened": _i(r["opened"]),
            "closed": _i(r["closed"]),
            "status": r["status"],
            "datesConfidence": r["dates_conf"],
            "maxDepthM": _f(r["max_depth_m"]),
            "production": None if _f(r["prod_low"]) is None else {
                "low": _f(r["prod_low"]), "high": _f(r["prod_high"]),
                "unit": r["prod_unit"], "confidence": r["prod_conf"],
            },
            "residual": None if s.residual_low is None else {
                "low": s.residual_low, "high": s.residual_high, "unit": s.residual_unit, "confidence": "modelled",
            },
            "illegalActivity": {
                "reported": r["illegal_reported"] == "1",
                "lastReportedYear": _i(r["illegal_last_year"]),
            },
            "flooded": r["flooded"] or None,
            "sealed": r["sealed"] == "1",
            "notes": r["notes"] or None,
            "risk": {
                "rai": s.score, "band": s.band, "logit": s.z,
                "factors": s.factors, "contributions": s.contributions,
            },
        })
    mines_out.sort(key=lambda m: -m["risk"]["rai"])

    payload = {
        "schemaVersion": 1,
        "generatedFor": args.as_of,
        "disclaimer": (
            "Prototype register of notable South African mines compiled from public sources. Coordinates are "
            "approximate (see precisionM). Production ranges marked 'low' confidence and all residual figures "
            "are modelled estimates that must be replaced with SAMINDABA / DMPR records before operational use."
        ),
        "count": len(mines_out),
        "mines": mines_out,
    }
    OUT_JSON.write_text(json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8")

    by_band: dict[str, int] = {}
    for m in mines_out:
        by_band[m["risk"]["band"]] = by_band.get(m["risk"]["band"], 0) + 1
    lines = [
        "# Mine register validation report",
        "",
        f"* Records: **{len(rows)}**  ·  errors: **{len(errors)}**  ·  warnings: **{len(warnings)}**",
        f"* Risk bands: {', '.join(f'{k}: {v}' for k, v in sorted(by_band.items()))}",
        "",
        "## Top 15 by Residual Attraction Index",
        "",
        "| # | Mine | Commodity | Status | RAI | Band |",
        "|---|------|-----------|--------|-----|------|",
    ]
    for i, m in enumerate(mines_out[:15], 1):
        lines.append(f"| {i} | {m['name']} | {m['commodity']} | {m['status']} | {m['risk']['rai']:.1f} | {m['risk']['band']} |")
    lines += ["", "## Errors", ""] + ([f"- {e}" for e in errors] or ["None."])
    lines += ["", "## Warnings", ""] + ([f"- {w}" for w in warnings] or ["None."])
    OUT_REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"{len(rows)} mines | {len(errors)} errors | {len(warnings)} warnings -> {OUT_JSON.relative_to(ROOT)}")
    for e in errors:
        print("  ERROR", e)
    return 1 if errors or (args.strict and warnings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
