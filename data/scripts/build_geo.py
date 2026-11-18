"""Build a lightweight South African province boundary file for the 3D command centre.

Source: geoBoundaries gbOpen ZAF ADM1 (OCHA ROSEA / Municipal Demarcation Board),
licensed CC BY 3.0 IGO. https://www.geoboundaries.org

The raw simplified GeoJSON (~720 KB) is simplified again with the
Ramer-Douglas-Peucker algorithm so the browser bundle stays small, while the
validation step in ``build_mines.py`` keeps using the higher-resolution rings.

Usage:
    python data/scripts/build_geo.py --raw path/to/geoBoundaries-ZAF-ADM1_simplified.geojson
"""

from __future__ import annotations

import argparse
import json
import math
import urllib.request
from pathlib import Path

RAW_URL = (
    "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/"
    "ZAF/ADM1/geoBoundaries-ZAF-ADM1_simplified.geojson"
)

# geoBoundaries ships with a typo ("Nothern Cape"); normalise names and add ISO 3166-2 codes.
PROVINCES = {
    "Eastern Cape": "EC",
    "Free State": "FS",
    "Gauteng": "GP",
    "KwaZulu-Natal": "KZN",
    "Limpopo": "LP",
    "Mpumalanga": "MP",
    "North West": "NW",
    "Nothern Cape": "NC",
    "Northern Cape": "NC",
    "Western Cape": "WC",
}
CANONICAL = {
    "EC": "Eastern Cape", "FS": "Free State", "GP": "Gauteng", "KZN": "KwaZulu-Natal",
    "LP": "Limpopo", "MP": "Mpumalanga", "NW": "North West", "NC": "Northern Cape",
    "WC": "Western Cape",
}

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "data" / "geo"


def _perp_distance(p, a, b) -> float:
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def rdp(points: list[list[float]], epsilon: float) -> list[list[float]]:
    """Iterative Ramer-Douglas-Peucker polyline simplification (O(n log n) average)."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        dmax, index = 0.0, start
        for i in range(start + 1, end):
            d = _perp_distance(points[i], points[start], points[end])
            if d > dmax:
                dmax, index = d, i
        if dmax > epsilon:
            keep[index] = True
            stack.extend([(start, index), (index, end)])
    return [p for p, k in zip(points, keep) if k]


def polygons_of(geometry: dict) -> list[list[list[list[float]]]]:
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    raise ValueError(f"unsupported geometry {geometry['type']}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", type=Path, help="local copy of the geoBoundaries file")
    parser.add_argument("--epsilon", type=float, default=0.02, help="RDP tolerance in degrees")
    args = parser.parse_args()

    if args.raw:
        raw = json.loads(args.raw.read_text(encoding="utf-8"))
    else:
        with urllib.request.urlopen(RAW_URL, timeout=60) as resp:  # noqa: S310 (fixed https URL)
            raw = json.loads(resp.read().decode("utf-8"))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    validation = {"type": "FeatureCollection", "features": []}
    light = {"provinces": [], "attribution": "geoBoundaries (CC BY 3.0 IGO): OCHA ROSEA / MDB"}

    for feature in raw["features"]:
        code = PROVINCES[feature["properties"]["shapeName"]]
        polys = polygons_of(feature["geometry"])
        # Validation copy: rounded to ~11 m but otherwise untouched.
        validation["features"].append({
            "type": "Feature",
            "properties": {"code": code, "name": CANONICAL[code]},
            "geometry": {
                "type": "MultiPolygon",
                "coordinates": [[[[round(x, 4), round(y, 4)] for x, y in ring] for ring in poly] for poly in polys],
            },
        })
        # Render copy: outer rings only, aggressively simplified, tiny islands dropped.
        rings = []
        for poly in polys:
            outer = rdp(poly[0], args.epsilon)
            if len(outer) >= 4:
                rings.append([[round(x, 3), round(y, 3)] for x, y in outer])
        light["provinces"].append({"code": code, "name": CANONICAL[code], "rings": rings})

    (OUT_DIR / "za_provinces_validation.geojson").write_text(json.dumps(validation), encoding="utf-8")
    (OUT_DIR / "za_provinces_render.json").write_text(json.dumps(light), encoding="utf-8")
    n_pts = sum(len(r) for p in light["provinces"] for r in p["rings"])
    print(f"wrote {len(light['provinces'])} provinces, {n_pts} render vertices")


if __name__ == "__main__":
    main()
