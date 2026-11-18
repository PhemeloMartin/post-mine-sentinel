import numpy as np
import pytest

from sentinel_ml.fusion import EvidenceFuser, multilaterate


def test_positive_evidence_raises_and_decays_back_to_prior():
    f = EvidenceFuser(prior=0.05, half_life_s=60)
    p1 = f.update(0, "seismic", True)
    p2 = f.update(1, "pir", True)
    assert 0.05 < p1 < p2
    assert f.probability_at(10_000) == pytest.approx(0.05, abs=1e-3)


def test_negative_evidence_lowers_belief():
    f = EvidenceFuser(prior=0.3)
    assert f.update(0, "seismic", False) < 0.3


def test_hotspot_prior_reaches_alert_faster_than_quiet_site():
    # A single geophone report is decisive at a known hotspot but not at a quiet site,
    # which needs corroboration from a second modality before crossing the alert line.
    hot, quiet = EvidenceFuser(prior=0.4), EvidenceFuser(prior=0.02)
    hot.update(0, "seismic", True)
    quiet.update(0, "seismic", True)
    assert hot.probability > 0.9 > quiet.probability
    quiet.update(1, "pir", True)
    assert quiet.probability > 0.9


def test_redundancy_down_weights_correlated_reports():
    a, b = EvidenceFuser(prior=0.1), EvidenceFuser(prior=0.1)
    a.update(0, "seismic", True, redundancy=1.0)
    b.update(0, "seismic", True, redundancy=0.3)
    assert b.probability < a.probability


@pytest.mark.parametrize("source", [(12.0, -7.0), (-30.0, 25.0), (0.5, 0.5)])
def test_tdoa_recovers_source_with_noise(source):
    rng = np.random.default_rng(1)
    sensors = np.array([[-40, -40], [40, -35], [45, 40], [-35, 45], [0, 60], [5, -60]], dtype=float)
    v = 300.0
    true_t0 = 2.0
    d = np.hypot(sensors[:, 0] - source[0], sensors[:, 1] - source[1])
    arrivals = true_t0 + d / v + rng.normal(0, 2e-4, len(sensors))
    fix = multilaterate(sensors, arrivals, velocity=v, sigma_t=2e-4)
    assert fix.converged
    assert np.hypot(fix.x - source[0], fix.y - source[1]) < 1.5
    a, b, _ = fix.ellipse
    assert 0 < b <= a < 5


def test_tdoa_requires_three_sensors():
    with pytest.raises(ValueError):
        multilaterate(np.zeros((2, 2)), np.zeros(2))
