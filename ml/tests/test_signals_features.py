import numpy as np
import pytest

from sentinel_ml.features import FEATURE_NAMES, N_FEATURES, extract_features
from sentinel_ml.signals import CLASSES, WINDOW_N, generate_window


def test_feature_vector_shape_and_finiteness():
    rng = np.random.default_rng(0)
    for label in range(len(CLASSES)):
        f = extract_features(generate_window(label, rng))
        assert f.shape == (N_FEATURES,) == (len(FEATURE_NAMES),)
        assert np.all(np.isfinite(f)), CLASSES[label]


def test_rejects_wrong_window_length():
    with pytest.raises(ValueError):
        extract_features(np.zeros(WINDOW_N - 1, dtype=np.int16))


def test_band_fractions_sum_to_one():
    f = extract_features(generate_window(1, np.random.default_rng(3)))
    bands = f[FEATURE_NAMES.index("band_1_8"): FEATURE_NAMES.index("band_128_250") + 1]
    # Bands cover 1–250 Hz; only the sub-1 Hz bins fall outside.
    assert 0.95 < bands.sum() <= 1.0 + 1e-9


def test_footstep_cadence_is_recovered_from_a_pure_gait():
    # Deterministic 2 Hz impulse train: the envelope autocorrelation must lock to 2 Hz.
    x = np.zeros(WINDOW_N)
    t = np.arange(40) / 500
    burst = 1000 * np.exp(-t / 0.02) * np.sin(2 * np.pi * 30 * t)
    for start in range(0, WINDOW_N - 40, 250):     # every 0.5 s
        x[start:start + 40] += burst
    f = extract_features(x.astype(np.int16))
    assert f[FEATURE_NAMES.index("cadence_hz")] == pytest.approx(2.0, abs=0.05)
    assert f[FEATURE_NAMES.index("impulse_rate")] == pytest.approx(2.0, abs=0.3)


def test_blast_is_more_impulsive_than_background():
    rng = np.random.default_rng(11)
    bg = extract_features(generate_window(0, rng))
    blast = extract_features(generate_window(6, rng))
    k = FEATURE_NAMES.index("log_peak")
    assert blast[k] > bg[k] + 1.0


def test_dc_offset_does_not_change_features():
    w = generate_window(2, np.random.default_rng(5)).astype(np.int32)
    a = extract_features(w.astype(np.int16))
    b = extract_features((w + 300).astype(np.int16))
    assert np.allclose(a, b, atol=1e-6)
