import math

import numpy as np
import pytest

from sentinel_ml.netsim import MeshConfig, link_budget, sensitivity_dbm, simulate_mesh, time_on_air_s
from sentinel_ml.risk import MineRecord, Town
from sentinel_ml.risk.rai import score_register
from sentinel_ml.satellite import bsi, detect_disturbance, ndvi
from sentinel_ml.satellite.change import synthetic_site_series

# ---------------- satellite ----------------


def test_indices_known_values():
    assert ndvi(0.5, 0.1) == pytest.approx(0.6667, abs=1e-3)
    assert bsi(0.1, 0.2, 0.3, 0.4) == pytest.approx(0.2, abs=1e-9)


def test_cusum_detects_injected_disturbance_without_false_alarm_before_onset():
    s = synthetic_site_series(onset=54, seed=4)
    res = detect_disturbance(s["ndvi"], s["bsi"], s["ndbi"])
    assert res.first_alarm is not None and 54 <= res.first_alarm <= 62
    quiet = synthetic_site_series(onset=None, seed=4)
    assert detect_disturbance(quiet["ndvi"], quiet["bsi"], quiet["ndbi"]).first_alarm is None


# ---------------- LoRa / mesh ----------------


def test_time_on_air_matches_semtech_reference():
    # Semtech LoRa calculator: SF7 / 125 kHz / CR 4/5 / 10-byte payload / 8-symbol preamble = 41.216 ms
    assert time_on_air_s(10, sf=7) * 1e3 == pytest.approx(41.216, abs=0.01)
    # SF12 enables low-data-rate optimisation automatically (T_sym = 32.768 ms > 16 ms)
    assert time_on_air_s(10, sf=12) > 0.9


def test_sensitivity_formula():
    assert sensitivity_dbm(12) == pytest.approx(-174 + 10 * math.log10(125e3) + 6 - 20, abs=1e-9)


def test_link_budget_margin_shrinks_with_distance():
    near, far = link_budget(100), link_budget(2000)
    assert near.margin_db > far.margin_db
    assert near.closes


def test_mesh_delivers_and_survives_gateway_loss():
    base = simulate_mesh(MeshConfig(sim_hours=6, seed=2))
    assert base.pdr > 0.9
    jammed = simulate_mesh(MeshConfig(sim_hours=6, seed=2, jam_gateway_at_h=3))
    assert jammed.pdr > 0.8           # second anchor keeps the field alive
    assert base.battery_days > 365


# ---------------- risk ----------------


def test_rai_orders_derelict_gold_hotspot_above_rehabilitated_site():
    towns = [Town("Stilfontein", -26.84, 26.77, 80_000), Town("Kimberley", -28.73, 24.75, 270_000)]
    hot = MineRecord("A", "gold hotspot", "gold", -26.89, 26.80, "underground", "derelict", 1957, 2013, 2500,
                     600, 1200, "t", True, 2025, "partial", False)
    rehab = MineRecord("B", "rehab", "diamonds", -28.74, 24.76, "both", "rehabilitated", 1871, 1914, 1097,
                       14.5, 14.5, "Mct", False, None, "yes", True)
    scores = {s.mine_id: s for s in score_register([hot, rehab], towns, 2026)}
    assert scores["A"].score > 60 > scores["B"].score
    assert set(scores["A"].contributions) == {"commodity", "residual", "access", "pressure", "history"}
    assert np.isclose(sum(scores["A"].contributions.values()) - 6.0, scores["A"].z, atol=1e-3)
