"""Bayesian log-odds evidence fusion with temporal decay.

Each site keeps a belief that an intrusion is in progress, H₁, versus H₀ (benign).
Independent sensor reports d_i update the log-odds additively (naive-Bayes /
sequential probability ratio):

    L_t = λ^(Δt) · (L_{t−1} − L₀) + L₀ + Σ_i log [ P(d_i | H₁) / P(d_i | H₀) ]

    P(H₁ | d₁..d_n) = σ(L_t) = 1 / (1 + e^(−L_t))

* L₀ = logit(prior). The prior comes from the site's Residual Attraction Index, so the
  same evidence is weighed more heavily at a known hotspot than at a quiet site.
* λ = 2^(−1/T½) decays evidence back towards the prior with half-life T½ (default 120 s),
  so one isolated footstep cannot hold an alert open forever.
* Likelihood ratios per sensor type come from measured detection/false-alarm rates:
  a positive report contributes log(DR / FAR), a silent sensor that *should* have heard
  the event contributes log((1 − DR) / (1 − FAR)) (negative evidence).
* Correlated sensors (e.g. two geophones 3 m apart hearing the same step) are
  down-weighted by a redundancy factor ρ ∈ (0, 1] to avoid double counting.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field


def logit(p: float) -> float:
    p = min(max(p, 1e-9), 1 - 1e-9)
    return math.log(p / (1 - p))


def sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x)) if x >= 0 else math.exp(x) / (1 + math.exp(x))


@dataclass(frozen=True)
class SensorModel:
    """Operating characteristics of one sensing modality."""

    name: str
    detection_rate: float      # P(report | H₁)
    false_alarm_rate: float    # P(report | H₀)

    @property
    def llr_positive(self) -> float:
        return math.log(self.detection_rate / self.false_alarm_rate)

    @property
    def llr_negative(self) -> float:
        return math.log((1 - self.detection_rate) / (1 - self.false_alarm_rate))


#: Default modality models. The seismic numbers are overwritten from the model card at runtime.
DEFAULT_MODELS: dict[str, SensorModel] = {
    "seismic": SensorModel("seismic", 0.85, 0.02),
    "pir": SensorModel("pir", 0.70, 0.05),
    "acoustic": SensorModel("acoustic", 0.75, 0.04),
    "magnetic": SensorModel("magnetic", 0.40, 0.01),     # metal tools / vehicles
    "tamper": SensorModel("tamper", 0.90, 0.005),        # node moved / opened
    "satellite": SensorModel("satellite", 0.55, 0.08),   # ShaftWatch surface-change flag
}


@dataclass
class EvidenceFuser:
    prior: float
    half_life_s: float = 120.0
    models: dict[str, SensorModel] = field(default_factory=lambda: dict(DEFAULT_MODELS))
    #: Negative evidence may lower belief at most this many log-odds below the prior
    #: (hearing animals is weak evidence that nobody else is present).
    floor_below_prior: float = 2.5
    log_odds: float = field(init=False)
    last_t: float | None = field(default=None, init=False)

    def __post_init__(self) -> None:
        self.l0 = logit(self.prior)
        self.log_odds = self.l0

    def _decay_to(self, t: float) -> None:
        if self.last_t is not None and t > self.last_t:
            lam = 2 ** (-(t - self.last_t) / self.half_life_s)
            self.log_odds = self.l0 + lam * (self.log_odds - self.l0)
        self.last_t = t if self.last_t is None else max(self.last_t, t)

    def update(self, t: float, modality: str, detected: bool, confidence: float = 1.0,
               redundancy: float = 1.0) -> float:
        """Fold one report into the belief and return the posterior probability.

        ``confidence`` ∈ [0, 1] scales the likelihood ratio (e.g. classifier P(threat)
        relative to its threshold); ``redundancy`` ρ down-weights correlated reports.
        """
        self._decay_to(t)
        m = self.models[modality]
        llr = m.llr_positive if detected else m.llr_negative
        self.log_odds += redundancy * max(0.0, min(1.0, confidence)) * llr
        self.log_odds = max(self.log_odds, self.l0 - self.floor_below_prior)
        return self.probability

    def add_llr(self, t: float, llr: float) -> float:
        """Fold a pre-computed log-likelihood ratio (e.g. a fused window vote) into the belief."""
        self._decay_to(t)
        self.log_odds = max(self.log_odds + llr, self.l0 - self.floor_below_prior)
        return self.probability

    @property
    def probability(self) -> float:
        return sigmoid(self.log_odds)

    def probability_at(self, t: float) -> float:
        self._decay_to(t)
        return self.probability
