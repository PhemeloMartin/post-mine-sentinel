"""Physics-informed synthetic geophone signals for bootstrapping the edge classifier.

Why synthetic?
    No public, labelled dataset of surface seismic signatures at South African
    derelict shafts exists. Collecting one requires a field pilot (Phase 1 of the
    roadmap). Until then we generate signals from first-principles models whose
    parameter ranges come from the unattended-ground-sensor (UGS) literature, and we
    evaluate under *domain shift* (soil parameters outside the training range) so we do
    not fool ourselves. Field recordings later fine-tune the same pipeline.

Signal model
    Each impact is the ground/geophone impulse response, a damped sinusoid

        h(t) = e^(−t/τ) · sin(2π f₀ t),    t ≥ 0

    scaled by surface-wave (Rayleigh) attenuation over source distance r:

        A(r) = A₀ · r^(−½) · e^(−α r),     α = π f₀ / (Q · v_R)

    where r^(−½) is cylindrical geometric spreading, Q the soil quality factor and
    v_R the Rayleigh-wave velocity. Arrival delay is r / v_R.

Classes
    0 background   ambient + wind gusts + micro-spikes
    1 footsteps    1-3 walkers, cadence 1.6-2.4 steps/s, heel-toe double impact
    2 digging      pick / hammer strikes, irregular 0.5-1.4 Hz, high-frequency transients
    3 machinery    hand-held rock drill / generator: harmonic series with operator AM
    4 vehicle      pass-by rumble, closest-approach envelope
    5 animal       small canid (fast, light) or cattle (slow, heavy, low-frequency)
    6 blast        single large impulse with long scattered coda
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

FS_HZ = 500                    # geophone ADC sample rate
WINDOW_S = 4.0
WINDOW_N = int(FS_HZ * WINDOW_S)   # 2000 samples per inference window
INT16_MAX = 32767

CLASSES: tuple[str, ...] = ("background", "footsteps", "digging", "machinery", "vehicle", "animal", "blast")
THREAT_CLASSES: frozenset[int] = frozenset({1, 2, 3, 6})


@dataclass(frozen=True)
class SiteConditions:
    """Near-surface propagation parameters (ranges are sampled per window)."""

    q_range: tuple[float, float] = (12.0, 35.0)          # soil quality factor Q
    vr_range: tuple[float, float] = (200.0, 450.0)       # Rayleigh velocity m/s
    noise_range: tuple[float, float] = (8.0, 30.0)       # ambient noise σ (ADC counts)
    resonance_scale: float = 1.0                         # multiplies source f₀ (soil stiffness proxy)


TRAIN_CONDITIONS = SiteConditions()
#: Out-of-distribution test conditions: harder soil, noisier site.
SHIFTED_CONDITIONS = SiteConditions(q_range=(8.0, 14.0), vr_range=(420.0, 600.0),
                                    noise_range=(25.0, 55.0), resonance_scale=1.25)


def _t() -> np.ndarray:
    return np.arange(WINDOW_N) / FS_HZ


def _impulse(sig: np.ndarray, t0: float, amp: float, f0: float, tau: float) -> None:
    """Add a damped-sinusoid impact starting at t0 (in-place)."""
    i0 = int(round(t0 * FS_HZ))
    if i0 >= WINDOW_N or amp == 0:
        return
    length = min(WINDOW_N - max(i0, 0), int(6 * tau * FS_HZ) + 2)
    if length <= 0:
        return
    tt = np.arange(length) / FS_HZ
    burst = amp * np.exp(-tt / tau) * np.sin(2 * np.pi * f0 * tt)
    start = max(i0, 0)
    sig[start:start + length] += burst[: WINDOW_N - start]


def _attenuation(r: float, f0: float, q: float, vr: float) -> float:
    alpha = np.pi * f0 / (q * vr)
    return float(r ** -0.5 * np.exp(-alpha * r))


def _pink_noise(rng: np.random.Generator, sigma: float) -> np.ndarray:
    """1/f-ish noise via spectral shaping of white noise."""
    white = rng.standard_normal(WINDOW_N)
    spec = np.fft.rfft(white)
    f = np.fft.rfftfreq(WINDOW_N, 1 / FS_HZ)
    spec[1:] /= np.sqrt(np.maximum(f[1:], 1.0))
    spec[0] = 0
    pink = np.fft.irfft(spec, n=WINDOW_N)
    return sigma * pink / (pink.std() + 1e-9)


def _background(rng: np.random.Generator, cond: SiteConditions) -> np.ndarray:
    sigma = rng.uniform(*cond.noise_range)
    sig = _pink_noise(rng, sigma)
    if rng.random() < 0.6:  # wind gusts: slow AM of broadband noise
        gust_f = rng.uniform(0.1, 0.6)
        env = 1 + rng.uniform(0.3, 1.5) * np.clip(np.sin(2 * np.pi * gust_f * _t() + rng.uniform(0, 6.28)), 0, None)
        sig += env * rng.normal(0, sigma * 0.6, WINDOW_N)
    for _ in range(rng.poisson(1.5)):  # insects, rain drops, settling grit
        _impulse(sig, rng.uniform(0, WINDOW_S), rng.uniform(1.5, 4) * sigma, rng.uniform(80, 200), 0.004)
    return sig


def _footsteps(rng, cond, q, vr) -> np.ndarray:
    sig = np.zeros(WINDOW_N)
    for _ in range(rng.choice([1, 1, 2, 3])):
        cadence = rng.uniform(1.6, 2.4)                 # steps / second
        r0, r1 = rng.uniform(3, 40), rng.uniform(3, 40)  # approaching or receding walker
        f0 = rng.uniform(15, 60) * cond.resonance_scale
        a0 = rng.uniform(800, 1600)
        t = rng.uniform(0, 1 / cadence)
        while t < WINDOW_S:
            r = r0 + (r1 - r0) * t / WINDOW_S
            amp = a0 * _attenuation(r, f0, q, vr) * rng.uniform(0.8, 1.2)
            _impulse(sig, t + r / vr, amp, f0, rng.uniform(0.012, 0.035))
            _impulse(sig, t + r / vr + rng.uniform(0.04, 0.08), 0.5 * amp, f0 * 1.1, 0.01)  # toe-off
            t += (1 / cadence) * rng.normal(1.0, 0.04)   # ~4 % gait variability
    return sig


def _digging(rng, cond, q, vr) -> np.ndarray:
    sig = np.zeros(WINDOW_N)
    interval = rng.uniform(0.7, 2.0)
    r = rng.uniform(2, 35)
    f0 = rng.uniform(60, 120) * cond.resonance_scale
    a0 = rng.uniform(1500, 4000)
    t = rng.uniform(0, interval)
    while t < WINDOW_S:
        amp = a0 * _attenuation(r, f0, q, vr) * rng.uniform(0.6, 1.3)
        _impulse(sig, t, amp, f0, rng.uniform(0.005, 0.015))
        _impulse(sig, t + 0.003, 0.4 * amp, f0 * 0.45, 0.03)          # low-frequency body thud
        if rng.random() < 0.5:                                        # shovel scrape
            i0 = int((t + rng.uniform(0.15, 0.4)) * FS_HZ)
            n = int(rng.uniform(0.1, 0.3) * FS_HZ)
            if i0 < WINDOW_N:
                seg = rng.normal(0, 0.15 * amp, min(n, WINDOW_N - i0))
                sig[i0:i0 + len(seg)] += seg
        t += interval * rng.normal(1.0, 0.18)
    return sig


def _machinery(rng, cond, q, vr) -> np.ndarray:
    t = _t()
    f_d = rng.uniform(18, 45) * cond.resonance_scale
    r = rng.uniform(5, 60)
    a0 = rng.uniform(200, 900) * _attenuation(r, f_d, q, vr) * 6
    am = 1 + 0.4 * np.sin(2 * np.pi * rng.uniform(0.5, 2.0) * t + rng.uniform(0, 6.28))
    sig = sum((a0 / k) * np.sin(2 * np.pi * k * f_d * t + rng.uniform(0, 6.28)) for k in range(1, 5))
    gate = np.ones(WINDOW_N)
    if rng.random() < 0.4:                       # drill stops / restarts inside the window
        a, b = sorted(rng.uniform(0, WINDOW_S, 2))
        gate[int(a * FS_HZ):int(b * FS_HZ)] = 0.05
    return sig * am * gate + rng.normal(0, a0 * 0.2, WINDOW_N)


def _vehicle(rng, cond, q, vr) -> np.ndarray:
    t = _t()
    speed = rng.uniform(3, 15)                   # m/s
    d_min = rng.uniform(10, 80)
    t0 = rng.uniform(-1, WINDOW_S + 1)           # time of closest approach
    r = np.sqrt(d_min ** 2 + (speed * (t - t0)) ** 2)
    f_e = rng.uniform(12, 30) * cond.resonance_scale
    a0 = rng.uniform(2000, 6000)
    alpha = np.pi * 20 / (q * vr)
    env = a0 * r ** -0.5 * np.exp(-alpha * r)
    noise = rng.standard_normal(WINDOW_N)
    spec = np.fft.rfft(noise)
    f = np.fft.rfftfreq(WINDOW_N, 1 / FS_HZ)
    spec[(f < 5) | (f > 40)] *= 0.05             # band-limited tyre/road rumble
    rumble = np.fft.irfft(spec, n=WINDOW_N)
    rumble /= rumble.std() + 1e-9
    engine = 0.6 * np.sin(2 * np.pi * f_e * t) + 0.3 * np.sin(4 * np.pi * f_e * t)
    return env * (rumble + engine)


def _animal(rng, cond, q, vr) -> np.ndarray:
    sig = np.zeros(WINDOW_N)
    if rng.random() < 0.5:   # small canid (jackal / dog): fast, light, high-frequency
        cadence, a0, f0, jit = rng.uniform(3.0, 5.0), rng.uniform(150, 400), rng.uniform(40, 80), 0.12
    else:                    # cattle / donkey: slow, heavy, low-frequency, irregular four-beat gait
        cadence, a0, f0, jit = rng.uniform(0.9, 1.4) * 2, rng.uniform(1200, 2500), rng.uniform(10, 25), 0.25
    f0 *= cond.resonance_scale
    r = rng.uniform(3, 40)
    t = rng.uniform(0, 1 / cadence)
    while t < WINDOW_S:
        amp = a0 * _attenuation(r, f0, q, vr) * rng.uniform(0.6, 1.4)
        _impulse(sig, t, amp, f0, rng.uniform(0.015, 0.05))
        t += (1 / cadence) * rng.normal(1.0, jit)
    return sig


def _blast(rng, cond, q, vr) -> np.ndarray:
    """Underground blast: energy travels as body waves through competent rock (Q ≈ 50–150,
    v_P ≈ 3–5 km/s), so it attenuates far less than surface footstep energy in soil."""
    sig = np.zeros(WINDOW_N)
    r = rng.uniform(50, 800)
    f0 = rng.uniform(8, 30) * cond.resonance_scale
    a0 = rng.uniform(150_000, 1_200_000)
    t0 = rng.uniform(0.2, 2.5)
    q_rock = q * rng.uniform(4.0, 6.0)
    v_rock = vr * rng.uniform(8.0, 12.0)
    amp = a0 * _attenuation(r, f0, q_rock, v_rock)
    _impulse(sig, t0, amp, f0, rng.uniform(0.08, 0.2))
    i0 = int(t0 * FS_HZ)
    n = WINDOW_N - i0
    coda_tau = rng.uniform(0.2, 0.6)
    tt = np.arange(n) / FS_HZ
    sig[i0:] += 0.35 * amp * np.exp(-tt / coda_tau) * rng.standard_normal(n)  # scattered coda
    return sig


_GENERATORS = {1: _footsteps, 2: _digging, 3: _machinery, 4: _vehicle, 5: _animal, 6: _blast}


def generate_window(label: int, rng: np.random.Generator, cond: SiteConditions = TRAIN_CONDITIONS) -> np.ndarray:
    """Return one 4-second window of int16 ADC counts for the given class label."""
    sig = _background(rng, cond)
    if label != 0:
        q, vr = rng.uniform(*cond.q_range), rng.uniform(*cond.vr_range)
        sig = sig + _GENERATORS[label](rng, cond, q, vr)
    sig += rng.uniform(-50, 50)                   # ADC DC offset (removed by feature extraction)
    return np.clip(np.round(sig), -INT16_MAX - 1, INT16_MAX).astype(np.int16)


def generate_dataset(
    n_per_class: int, seed: int, cond: SiteConditions = TRAIN_CONDITIONS
) -> tuple[np.ndarray, np.ndarray]:
    """Balanced dataset: X int16 [n_classes·n_per_class, WINDOW_N], y int labels."""
    rng = np.random.default_rng(seed)
    xs, ys = [], []
    for label in range(len(CLASSES)):
        for _ in range(n_per_class):
            xs.append(generate_window(label, rng, cond))
            ys.append(label)
    return np.stack(xs), np.asarray(ys, dtype=np.int64)
