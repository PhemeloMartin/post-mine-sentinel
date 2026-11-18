"""Google Earth Engine extraction of monthly indices around each shaft (production job).

Requires ``pip install sentinel-ml[satellite]`` and an authenticated Earth Engine
project (``earthengine authenticate``). Not executed in CI.

For every site we buffer the shaft by ``radius_m`` (default 400 m, as in the original
ShaftWatch ZA concept), build a cloud-masked monthly median Sentinel-2 L2A composite
(SCL classes 3, 8, 9, 10 removed), and reduce NDVI / BSI / NDBI plus Dynamic World
"bare" and "built" probabilities to the buffer mean. Output is one CSV row per site-month
which ``change.detect_disturbance`` consumes.

Usage:
    python -m sentinel_ml.satellite.gee_pipeline --project my-ee-project \
        --register data/mines/sa_mines.json --start 2019-01-01 --end 2026-11-01 --out shaftwatch.csv
"""

from __future__ import annotations

import argparse
import csv
import json
from datetime import date
from pathlib import Path

SCL_CLOUDY = (3, 8, 9, 10)  # cloud shadow, cloud medium/high probability, thin cirrus


def _months(start: date, end: date):
    y, m = start.year, start.month
    while (y, m) < (end.year, end.month):
        yield date(y, m, 1)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def build_composite(ee, geom, month_start: date):
    start = ee.Date(month_start.isoformat())
    end = start.advance(1, "month")

    def mask(img):
        scl = img.select("SCL")
        keep = scl.neq(SCL_CLOUDY[0])
        for c in SCL_CLOUDY[1:]:
            keep = keep.And(scl.neq(c))
        return img.updateMask(keep).divide(10000)

    s2 = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(geom)
          .filterDate(start, end).map(mask).median())
    ndvi = s2.normalizedDifference(["B8", "B4"]).rename("ndvi")
    ndbi = s2.normalizedDifference(["B11", "B8"]).rename("ndbi")
    bsi = s2.expression("((S + R) - (N + B)) / ((S + R) + (N + B))",
                        {"S": s2.select("B11"), "R": s2.select("B4"),
                         "N": s2.select("B8"), "B": s2.select("B2")}).rename("bsi")
    dw = (ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1").filterBounds(geom).filterDate(start, end)
          .select(["bare", "built"]).mean())
    return ndvi.addBands([bsi, ndbi, dw])


def main() -> None:  # pragma: no cover - requires network + credentials
    import ee  # type: ignore[import-not-found]

    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--register", type=Path, required=True)
    ap.add_argument("--start", type=date.fromisoformat, required=True)
    ap.add_argument("--end", type=date.fromisoformat, required=True)
    ap.add_argument("--radius-m", type=float, default=400.0)
    ap.add_argument("--min-rai", type=float, default=25.0, help="only monitor elevated-risk sites")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    ee.Initialize(project=args.project)
    register = json.loads(args.register.read_text(encoding="utf-8"))["mines"]
    sites = [m for m in register if m["risk"]["rai"] >= args.min_rai]

    with args.out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["mine_id", "month", "ndvi", "bsi", "ndbi", "dw_bare", "dw_built"])
        for site in sites:
            geom = ee.Geometry.Point([site["lon"], site["lat"]]).buffer(args.radius_m)
            for month in _months(args.start, args.end):
                stats = build_composite(ee, geom, month).reduceRegion(
                    reducer=ee.Reducer.mean(), geometry=geom, scale=10, maxPixels=1e8).getInfo()
                w.writerow([site["id"], month.isoformat(), stats.get("ndvi"), stats.get("bsi"),
                            stats.get("ndbi"), stats.get("bare"), stats.get("built")])


if __name__ == "__main__":  # pragma: no cover
    main()
