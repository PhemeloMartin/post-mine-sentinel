"""Per-site change detection against the site's own seasonal history.

Each shaft is compared with *itself*, not with a national threshold, so a naturally
bare Karoo site and a grassy Highveld site are judged fairly.

1. Robust seasonal z-score for month m of year y, using only *earlier* years
   (no look-ahead leakage):

       z_{y,m} = (x_{y,m} − median_{y'<y}(x_{y',m})) / (1.4826 · MAD_{y'<y}(x_{y',m}) + ε)

2. Disturbance index (signs chosen so that "more disturbance" is positive):

       D_t = w_v·(−z_NDVI) + w_b·z_BSI + w_u·z_NDBI

3. One-sided CUSUM (Page, 1954) accumulates persistent small shifts that a single
   month would miss:

       S_t = max(0, S_{t−1} + D_t − k),    alarm when S_t > h

   k (allowance) ≈ half the shift we want to detect; h trades detection delay against
   false alarms (ARL₀). Defaults k = 0.5, h = 4 give ARL₀ ≈ 170 months for N(0,1) noise.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def robust_seasonal_z(values: np.ndarray, period: int = 12, min_history: int = 2) -> np.ndarray:
    """z-scores of a monthly series against same-month history from earlier cycles only."""
    values = np.asarray(values, dtype=float)
    z = np.full_like(values, np.nan)
    for t in range(len(values)):
        hist = values[t - period::-period][: 50] if t >= period else np.array([])
        hist = hist[~np.isnan(hist)]
        if len(hist) >= min_history and not np.isnan(values[t]):
            med = np.median(hist)
            mad = np.median(np.abs(hist - med))
            z[t] = (values[t] - med) / (1.4826 * mad + 0.01)
    return z


def cusum(d: np.ndarray, k: float = 0.5, h: float = 4.0) -> tuple[np.ndarray, np.ndarray]:
    s = np.zeros(len(d))
    alarms = np.zeros(len(d), dtype=bool)
    acc = 0.0
    for t, v in enumerate(np.nan_to_num(d, nan=0.0)):
        acc = max(0.0, acc + v - k)
        s[t] = acc
        alarms[t] = acc > h
    return s, alarms


@dataclass(frozen=True)
class ChangeResult:
    disturbance: np.ndarray
    cusum: np.ndarray
    alarms: np.ndarray
    first_alarm: int | None

    @property
    def change_score(self) -> float:
        """0–100 score of the latest state, for blending into the site prior."""
        s = float(self.cusum[-1]) if len(self.cusum) else 0.0
        return float(100 * (1 - np.exp(-s / 6)))


def detect_disturbance(
    ndvi_series: np.ndarray,
    bsi_series: np.ndarray,
    ndbi_series: np.ndarray | None = None,
    weights: tuple[float, float, float] = (0.45, 0.4, 0.15),
    k: float = 0.5,
    h: float = 4.0,
) -> ChangeResult:
    zv = robust_seasonal_z(ndvi_series)
    zb = robust_seasonal_z(bsi_series)
    zu = robust_seasonal_z(ndbi_series) if ndbi_series is not None else np.zeros_like(zv)
    wv, wb, wu = weights
    d = wv * (-np.nan_to_num(zv)) + wb * np.nan_to_num(zb) + wu * np.nan_to_num(zu)
    d = np.clip(d, -6, 6)  # a single cloudy composite must not dominate
    s, alarms = cusum(d, k, h)
    first = int(np.argmax(alarms)) if alarms.any() else None
    return ChangeResult(d, s, alarms, first)


def synthetic_site_series(n_months: int = 72, onset: int | None = 54, seed: int = 0,
                          intensity: float = 0.12) -> dict[str, np.ndarray]:
    """Demo series: seasonal Highveld grassland NDVI, with optional disturbance from ``onset``.

    Used by tests and the command-centre demo only. Clearly labelled synthetic in the UI.
    """
    rng = np.random.default_rng(seed)
    t = np.arange(n_months)
    season = np.cos(2 * np.pi * (t - 1) / 12)            # summer-rainfall peak around Jan/Feb
    ndvi_s = 0.42 + 0.16 * season + rng.normal(0, 0.025, n_months)
    bsi_s = 0.05 - 0.07 * season + rng.normal(0, 0.02, n_months)
    ndbi_s = -0.12 - 0.04 * season + rng.normal(0, 0.015, n_months)
    if onset is not None:
        ramp = np.clip((t - onset) / 6, 0, 1)
        ndvi_s -= intensity * ramp
        bsi_s += intensity * 0.8 * ramp
        ndbi_s += intensity * 0.35 * ramp
    return {"ndvi": ndvi_s, "bsi": bsi_s, "ndbi": ndbi_s}
