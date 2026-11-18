"""Spectral indices for Sentinel-2 L2A surface reflectance (and a Sentinel-1 SAR ratio).

Band mapping (Sentinel-2 MSI): B2 blue, B4 red, B8 NIR (10 m), B11 SWIR-1 (20 m).

NDVI  = (NIR − Red) / (NIR + Red)                              vegetation; drops when ground is stripped
BSI   = ((SWIR1 + Red) − (NIR + Blue)) / ((SWIR1 + Red) + (NIR + Blue))   bare-soil index; rises with fresh disturbance
NDBI  = (SWIR1 − NIR) / (SWIR1 + NIR)                          built-up index; rises with informal structures
ΔσVV  = 10·log10(σ⁰_t / σ⁰_baseline)  [dB]    Sentinel-1 C-band backscatter change; works through cloud & at night
"""

from __future__ import annotations

import numpy as np

EPS = 1e-9


def _nd(a, b):
    a, b = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    return (a - b) / (a + b + EPS)


def ndvi(nir, red):
    return _nd(nir, red)


def ndbi(swir1, nir):
    return _nd(swir1, nir)


def bsi(blue, red, nir, swir1):
    blue, red, nir, swir1 = (np.asarray(v, dtype=float) for v in (blue, red, nir, swir1))
    return ((swir1 + red) - (nir + blue)) / ((swir1 + red) + (nir + blue) + EPS)


def s1_change_db(sigma0_t, sigma0_baseline):
    return 10.0 * np.log10((np.asarray(sigma0_t, dtype=float) + EPS) / (np.asarray(sigma0_baseline, dtype=float) + EPS))
