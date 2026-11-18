"""Residual Attraction Index (RAI): how strongly a mine site attracts illegal mining.

The RAI is an *interpretable* logistic model. Every input is a physically or
socially meaningful factor in [0, 1], and every factor's contribution to the
final score is returned so analysts can see *why* a site is ranked high
(explainability is a POPIA s71 / administrative-justice requirement when a
score informs state action).

    z   = β₀ + β_C·C + β_V·V + β_A·A + β_P·P + β_H·H
    RAI = 100 · σ(z),   σ(z) = 1 / (1 + e^(−z))

C  commodity attraction      value density × ease of artisanal recovery × fence-market liquidity
V  residual value            C · R̂ where R̂ is the log-normalised remnant left behind (pillars,
                             remnants, gravels) *within* the commodity, so tonnes of asbestos never
                             outweigh tonnes of gold (an interaction term in the logit)
A  physical accessibility    status × flooding × sealing × depth × dormancy
P  socio-economic pressure   min-max of log population gravity  G = Σ pop_j / (1 + (d_ij / d₀)²)
H  incident history          exp(−Δt / τ) since the last publicly reported incident

β are expert-elicited priors (see docs/09-mathematical-models.md). ``calibrate.py``
re-estimates them from weakly-labelled incident data and reports the drift.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from ..geo import haversine_m

# --- Factor look-up tables (documented assumptions, not measurements) -------------------

#: Relative attraction of a commodity to illegal operators (gold = 1).
COMMODITY_ATTRACTION: dict[str, float] = {
    "gold": 1.00,
    "diamonds": 0.85,
    "chrome": 0.45,
    "coal": 0.40,
    "pgm": 0.35,
    "copper": 0.30,
    "tin": 0.20,
    "zinc": 0.15,
    "manganese": 0.12,
    "iron": 0.08,
    "asbestos": 0.02,
}

#: Fraction of historic production plausibly left as accessible remnants
#: (shaft/crown pillars, low-grade blocks, residual gravels), as a (low, high) range.
REMNANT_FRACTION: dict[tuple[str, str], tuple[float, float]] = {
    ("gold", "underground"): (0.08, 0.15),
    ("diamonds", "both"): (0.02, 0.05),
    ("diamonds", "open_pit"): (0.02, 0.05),
    ("diamonds", "alluvial"): (0.05, 0.12),
    ("coal", "underground"): (0.30, 0.50),  # bord-and-pillar leaves 40-60 % in situ
    ("coal", "both"): (0.15, 0.30),
    ("coal", "open_pit"): (0.03, 0.08),
    ("pgm", "underground"): (0.10, 0.20),
    ("pgm", "open_pit"): (0.03, 0.08),
    ("copper", "underground"): (0.05, 0.10),
    ("copper", "both"): (0.05, 0.10),
}
DEFAULT_REMNANT = (0.02, 0.06)

STATUS_ACCESS: dict[str, float] = {
    "operating": 0.35,          # owner security present, but infiltration still reported
    "restarted": 0.50,
    "care_maintenance": 0.80,
    "closed": 0.90,
    "derelict": 1.00,
    "rehabilitated": 0.15,
}
FLOOD_ACCESS = {"yes": 0.45, "partial": 0.75, "no": 1.0, "": 1.0}
SEALED_ACCESS = {True: 0.30, False: 1.0}

#: Expert-elicited logistic weights (Delphi-style; see docs).
EXPERT_WEIGHTS: dict[str, float] = {
    "bias": -6.0,
    "commodity": 2.0,
    "residual": 2.0,
    "access": 3.0,
    "pressure": 1.5,
    "history": 1.8,
}

DEPTH_SCALE_M = 3500.0      # depth at which accessibility halves (Stilfontein workings reached > 2 km)
DORMANCY_TAU_Y = 8.0        # years for surface security & infrastructure to decay
HISTORY_TAU_Y = 6.0         # incident memory half-life ≈ τ·ln2 ≈ 4 years
PRESSURE_D0_KM = 10.0       # gravity-model distance scale


@dataclass(frozen=True)
class Town:
    name: str
    lat: float
    lon: float
    population: int


@dataclass(frozen=True)
class MineRecord:
    id: str
    name: str
    commodity: str
    lat: float
    lon: float
    method: str
    status: str
    opened: int | None = None
    closed: int | None = None
    max_depth_m: float | None = None
    prod_low: float | None = None
    prod_high: float | None = None
    prod_unit: str = ""
    illegal_reported: bool = False
    illegal_last_year: int | None = None
    flooded: str = ""
    sealed: bool = False


@dataclass
class RAIBreakdown:
    mine_id: str
    score: float                                   # 0..100
    z: float                                       # log-odds
    factors: dict[str, float] = field(default_factory=dict)        # x_k in [0,1]
    contributions: dict[str, float] = field(default_factory=dict)  # w_k · x_k
    residual_low: float | None = None
    residual_high: float | None = None
    residual_unit: str = ""

    @property
    def band(self) -> str:
        if self.score >= 75:
            return "critical"
        if self.score >= 50:
            return "high"
        if self.score >= 25:
            return "elevated"
        return "low"


def sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


def residual_estimate(m: MineRecord) -> tuple[float, float] | None:
    """Remnant resource range in the mine's production unit: R = P · κ(commodity, method)."""
    if m.prod_low is None or m.prod_high is None:
        return None
    k_lo, k_hi = REMNANT_FRACTION.get((m.commodity, m.method), DEFAULT_REMNANT)
    return m.prod_low * k_lo, m.prod_high * k_hi


def access_factor(m: MineRecord, as_of_year: int) -> float:
    """A = s_status · s_flood · s_sealed · s_depth · s_dormancy  ∈ [0, 1]."""
    a = STATUS_ACCESS.get(m.status, 0.9)
    a *= FLOOD_ACCESS.get(m.flooded or "", 1.0)
    a *= SEALED_ACCESS[bool(m.sealed)]
    if m.method in ("underground", "both") and m.max_depth_m:
        a *= 1.0 / (1.0 + (m.max_depth_m / DEPTH_SCALE_M) ** 2)
    if m.status != "operating":
        years = max(0, as_of_year - m.closed) if m.closed else 10
        a *= 0.5 + 0.5 * (1.0 - math.exp(-years / DORMANCY_TAU_Y))
    return max(0.0, min(1.0, a))


def gravity_pressure(lat: float, lon: float, towns: Iterable[Town]) -> float:
    """Population gravity G = Σ_j pop_j / (1 + (d_ij/d₀)²)  (people-equivalents)."""
    g = 0.0
    for t in towns:
        d_km = haversine_m(lat, lon, t.lat, t.lon) / 1000.0
        g += t.population / (1.0 + (d_km / PRESSURE_D0_KM) ** 2)
    return g


def history_factor(m: MineRecord, as_of_year: int) -> float:
    if not m.illegal_reported:
        return 0.0
    last = m.illegal_last_year or as_of_year - 5
    return math.exp(-max(0, as_of_year - last) / HISTORY_TAU_Y)


def score_register(
    mines: Sequence[MineRecord],
    towns: Sequence[Town],
    as_of_year: int,
    weights: dict[str, float] | None = None,
    use_history: bool = True,
) -> list[RAIBreakdown]:
    """Score every mine; normalisations are computed over the whole register."""
    w = dict(EXPERT_WEIGHTS if weights is None else weights)

    residuals = {m.id: residual_estimate(m) for m in mines}
    # Log-normalise residual midpoints *within each commodity* so units never mix.
    max_log: dict[str, float] = {}
    for m in mines:
        r = residuals[m.id]
        if r:
            max_log[m.commodity] = max(max_log.get(m.commodity, 0.0), math.log10(1 + (r[0] + r[1]) / 2))
    median_fill: dict[str, float] = {}
    for c in {m.commodity for m in mines}:
        vals = sorted(math.log10(1 + sum(residuals[m.id]) / 2) for m in mines if m.commodity == c and residuals[m.id])
        median_fill[c] = vals[len(vals) // 2] if vals else 0.0

    log_g = {m.id: math.log1p(gravity_pressure(m.lat, m.lon, towns)) for m in mines}
    g_lo, g_hi = (min(log_g.values()), max(log_g.values())) if log_g else (0.0, 1.0)
    g_span = (g_hi - g_lo) or 1.0

    out: list[RAIBreakdown] = []
    for m in mines:
        r = residuals[m.id]
        r_log = math.log10(1 + (r[0] + r[1]) / 2) if r else median_fill.get(m.commodity, 0.0)
        denom = max_log.get(m.commodity, 0.0)
        c = COMMODITY_ATTRACTION.get(m.commodity, 0.1)
        r_hat = (r_log / denom) if denom > 0 else 0.5
        factors = {
            "commodity": c,
            "residual": c * r_hat,
            "access": access_factor(m, as_of_year),
            "pressure": (log_g[m.id] - g_lo) / g_span,
            "history": history_factor(m, as_of_year) if use_history else 0.0,
        }
        contributions = {k: w[k] * v for k, v in factors.items()}
        z = w["bias"] + sum(contributions.values())
        out.append(
            RAIBreakdown(
                mine_id=m.id,
                score=round(100.0 * sigmoid(z), 2),
                z=round(z, 4),
                factors={k: round(v, 4) for k, v in factors.items()},
                contributions={k: round(v, 4) for k, v in contributions.items()},
                residual_low=None if r is None else round(r[0], 4),
                residual_high=None if r is None else round(r[1], 4),
                residual_unit=m.prod_unit,
            )
        )
    return out


def compute_rai(m: MineRecord, towns: Sequence[Town], as_of_year: int) -> RAIBreakdown:
    """Score a single mine in isolation (normalisation degenerates to self-reference)."""
    return score_register([m], towns, as_of_year)[0]
