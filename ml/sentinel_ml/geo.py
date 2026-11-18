"""Small, dependency-free geodesy helpers (WGS84 sphere approximation)."""

from __future__ import annotations

import math
from collections.abc import Sequence

EARTH_RADIUS_M = 6_371_008.8  # IUGG mean radius


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres.

    d = 2R · asin( sqrt( sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2) ) )
    """
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def point_in_ring(lon: float, lat: float, ring: Sequence[Sequence[float]]) -> bool:
    """Even-odd ray casting test for a single linear ring of (lon, lat) vertices."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat):
            x_cross = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lon < x_cross:
                inside = not inside
        j = i
    return inside


def point_in_multipolygon(lon: float, lat: float, multipolygon: Sequence) -> bool:
    """GeoJSON MultiPolygon coordinates: outer ring minus holes."""
    for polygon in multipolygon:
        if point_in_ring(lon, lat, polygon[0]) and not any(
            point_in_ring(lon, lat, hole) for hole in polygon[1:]
        ):
            return True
    return False


def local_enu(lat0: float, lon0: float, lat: float, lon: float) -> tuple[float, float]:
    """Equirectangular projection to local East/North metres around (lat0, lon0).

    Accurate to <0.1 % within a few km, which is all a single site network needs.
    """
    x = math.radians(lon - lon0) * EARTH_RADIUS_M * math.cos(math.radians(lat0))
    y = math.radians(lat - lat0) * EARTH_RADIUS_M
    return x, y
