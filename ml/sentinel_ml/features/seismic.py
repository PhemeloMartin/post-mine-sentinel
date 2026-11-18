"""Reference seismic feature extractor (21 features per 4 s window).

THIS FILE IS A SPECIFICATION. ``firmware/spider-node/lib/sentinel_core/src/features.cpp``
implements the identical algorithm in C++ and is checked against golden vectors
exported by ``sentinel_ml.edge.export``. Any change here must be mirrored there
and the golden vectors regenerated (CI fails otherwise).

Input: N = 2000 int16 samples at 500 Hz. Let x[n] = s[n] − mean(s).

Time domain
    rms        = sqrt(mean(x²))                         log_rms   = log10(rms + 1)
    peak       = max|x|                                 log_peak  = log10(peak + 1)
    crest_log  = log10((peak + 1) / (rms + 1))
    kurt_log   = log10( mean(x⁴) / (mean(x²)² + 1e-12) + 1e-12 )      (Gaussian ≈ 0.477)
    zcr        = #{n : x[n−1]·x[n] < 0} / (N − 1)

Spectral (Hann window w[n] = 0.5 − 0.5·cos(2πn/(N−1)), zero-padded FFT, M = 2048)
    P[k] = |X[k]|², k = 1..1024,  f_k = k·fs/M,  T = ΣP + 1e-12
    centroid   = (Σ f_k P[k] / T) / (fs/2)
    bandwidth  = sqrt(Σ (f_k − c)² P[k] / T) / (fs/2)          c = centroid in Hz
    rolloff85  = f_{k*} / (fs/2),  k* = min{k : Σ_{j≤k} P[j] ≥ 0.85·T}
    flatness   = exp(mean ln(P + 1e-12)) / (mean(P) + 1e-12)    (Wiener entropy)
    band_i     = Σ_{lo_i ≤ f_k < hi_i} P[k] / T, edges 1, 8, 16, 32, 64, 128, 250 Hz (last band closed)

Envelope / rhythm (where human gait lives)
    e[n]   = (1/25) Σ_{j=n−24..n, j≥0} |x[j]|          (causal 50 ms moving average)
    d[m]   = e[5m + 4], m = 0..399                    (decimated to 100 Hz)
    ac[k]  = Σ_m (d[m]−d̄)(d[m+k]−d̄),  k ∈ [17, 200]  (0.5–5.9 Hz)
    cadence_hz       = 100 / argmax_k ac[k]
    cadence_strength = max_k ac[k] / ac[0]
    sta_lta_log      = log10(max_n STA(n)/LTA(n) + 1e-12),  STA 0.1 s, LTA 1.0 s on x², n ≥ 499
    impulses: local maxima of d (d[m] > d[m−1], d[m] ≥ d[m+1]) above thr = med + 4·MAD + 1e-6,
              greedy min-separation 15 samples (keep the larger peak)
    impulse_rate     = count / 4 s
    impulse_cv       = std(Δm) / mean(Δm) of peak spacings (population std; 0 if < 3 peaks)
    active_fraction  = #{d[m] > 2·med} / 400
"""

from __future__ import annotations

import numpy as np

FS = 500
N = 2000
NFFT = 2048
ENV_WIN = 25
DECIM = 5
M_ENV = N // DECIM          # 400
LAG_MIN, LAG_MAX = 17, 200
STA_N, LTA_N = 50, 500
MIN_SEP = 15
BAND_EDGES = (1.0, 8.0, 16.0, 32.0, 64.0, 128.0, 250.0)

FEATURE_NAMES: tuple[str, ...] = (
    "log_rms", "log_peak", "crest_log", "kurt_log", "zcr",
    "centroid", "bandwidth", "rolloff85", "flatness",
    "band_1_8", "band_8_16", "band_16_32", "band_32_64", "band_64_128", "band_128_250",
    "cadence_hz", "cadence_strength", "sta_lta_log",
    "impulse_rate", "impulse_cv", "active_fraction",
)
N_FEATURES = len(FEATURE_NAMES)

_HANN = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N) / (N - 1))).astype(np.float32)
_FREQS = np.arange(1, NFFT // 2 + 1) * FS / NFFT


def _median(v: np.ndarray) -> float:
    s = np.sort(v)
    n = len(s)
    return float(0.5 * (s[n // 2 - 1] + s[n // 2])) if n % 2 == 0 else float(s[n // 2])


def _envelope(x: np.ndarray) -> np.ndarray:
    a = np.abs(x).astype(np.float64)
    c = np.concatenate([[0.0], np.cumsum(a)])
    idx = np.arange(N)
    lo = np.maximum(0, idx - ENV_WIN + 1)
    e = (c[idx + 1] - c[lo]) / ENV_WIN
    return e[DECIM - 1::DECIM].astype(np.float32)          # d[m] = e[5m + 4]


def _peaks(d: np.ndarray) -> list[int]:
    med = _median(d)
    mad = _median(np.abs(d - med))
    thr = med + 4.0 * mad + 1e-6
    peaks: list[int] = []
    for m in range(1, len(d) - 1):
        if d[m] > thr and d[m] > d[m - 1] and d[m] >= d[m + 1]:
            if peaks and m - peaks[-1] < MIN_SEP:
                if d[m] > d[peaks[-1]]:
                    peaks[-1] = m
            else:
                peaks.append(m)
    return peaks


def extract_features(samples: np.ndarray) -> np.ndarray:
    """Compute the 21-feature vector for one int16 window of length 2000."""
    if samples.shape != (N,):
        raise ValueError(f"expected {N} samples, got {samples.shape}")
    s = samples.astype(np.float64)
    x = (s - s.mean()).astype(np.float32)
    x64 = x.astype(np.float64)

    # --- time domain ---
    m2 = float(np.mean(x64 ** 2))
    m4 = float(np.mean(x64 ** 4))
    rms = np.sqrt(m2)
    peak = float(np.max(np.abs(x64)))
    log_rms = np.log10(rms + 1.0)
    log_peak = np.log10(peak + 1.0)
    crest_log = np.log10((peak + 1.0) / (rms + 1.0))
    kurt_log = np.log10(m4 / (m2 * m2 + 1e-12) + 1e-12)
    zcr = np.count_nonzero(x64[:-1] * x64[1:] < 0) / (N - 1)

    # --- spectral ---
    spec = np.fft.rfft((x * _HANN).astype(np.float64), n=NFFT)
    p = (spec.real ** 2 + spec.imag ** 2)[1:]
    total = p.sum() + 1e-12
    c_hz = float((_FREQS * p).sum() / total)
    centroid = c_hz / (FS / 2)
    bandwidth = np.sqrt(((_FREQS - c_hz) ** 2 * p).sum() / total) / (FS / 2)
    k_star = int(np.searchsorted(np.cumsum(p), 0.85 * total))
    rolloff = _FREQS[min(k_star, len(_FREQS) - 1)] / (FS / 2)
    flatness = np.exp(np.mean(np.log(p + 1e-12))) / (np.mean(p) + 1e-12)
    bands = []
    for i in range(len(BAND_EDGES) - 1):
        lo, hi = BAND_EDGES[i], BAND_EDGES[i + 1]
        last = i == len(BAND_EDGES) - 2
        mask = (_FREQS >= lo) & ((_FREQS <= hi) if last else (_FREQS < hi))
        bands.append(p[mask].sum() / total)

    # --- envelope rhythm ---
    d = _envelope(x)
    dc = d.astype(np.float64) - float(np.mean(d, dtype=np.float64))
    ac0 = float(np.dot(dc, dc)) + 1e-12
    best_k, best_v = LAG_MIN, -np.inf
    for k in range(LAG_MIN, LAG_MAX + 1):
        v = float(np.dot(dc[: M_ENV - k], dc[k:]))
        if v > best_v:
            best_k, best_v = k, v
    cadence_hz = 100.0 / best_k
    cadence_strength = best_v / ac0

    c2 = np.concatenate([[0.0], np.cumsum(x64 ** 2)])
    n_idx = np.arange(LTA_N - 1, N)
    sta = (c2[n_idx + 1] - c2[n_idx + 1 - STA_N]) / STA_N
    lta = (c2[n_idx + 1] - c2[n_idx + 1 - LTA_N]) / LTA_N
    sta_lta_log = np.log10(float(np.max(sta / (lta + 1e-12))) + 1e-12)

    pk = _peaks(d)
    impulse_rate = len(pk) / (N / FS)
    if len(pk) >= 3:
        gaps = np.diff(pk).astype(np.float64)
        impulse_cv = float(gaps.std() / gaps.mean())
    else:
        impulse_cv = 0.0
    med = _median(d)
    active_fraction = np.count_nonzero(d > 2.0 * med) / M_ENV

    return np.array(
        [log_rms, log_peak, crest_log, kurt_log, zcr,
         centroid, bandwidth, rolloff, flatness, *bands,
         cadence_hz, cadence_strength, sta_lta_log,
         impulse_rate, impulse_cv, active_fraction],
        dtype=np.float64,
    )


def extract_batch(windows: np.ndarray) -> np.ndarray:
    return np.stack([extract_features(w) for w in windows])
