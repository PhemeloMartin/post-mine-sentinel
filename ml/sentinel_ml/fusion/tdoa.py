"""Time-Difference-of-Arrival (TDOA) multilateration of seismic sources.

When ≥ 3 S.P.I.D.E.R. nodes (with GPS-disciplined clocks, ±1 µs PPS) time-stamp the same
footstep or pick strike, the source position p = (x, y) and emission time t₀ solve

    t_i = t₀ + ‖p − s_i‖ / v       for every node i at known position s_i.

We estimate θ = (x, y, t₀) by Gauss–Newton non-linear least squares:

    r_i(θ)   = t_i − t₀ − ‖p − s_i‖ / v
    J_i      = [ −(x − x_i) / (v·d_i),  −(y − y_i) / (v·d_i),  −1 ]
    Δθ       = (JᵀJ)⁻¹ Jᵀ r                (with Levenberg damping μ for robustness)

The position covariance follows from the linearised model,

    Σ_θ = σ_t² · (JᵀJ)⁻¹

whose upper-left 2×2 block gives the 1-σ error ellipse drawn in the command centre.
The geometric dilution of precision GDOP = sqrt(tr Σ_p) / (σ_t · v) explains why nodes
are placed to *surround* a shaft rather than in a line.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class TdoaFix:
    x: float
    y: float
    t0: float
    cov_xy: np.ndarray          # 2×2 covariance (m²)
    residual_rms_s: float
    iterations: int
    converged: bool

    @property
    def ellipse(self) -> tuple[float, float, float]:
        """1-σ ellipse (semi-major m, semi-minor m, orientation rad)."""
        vals, vecs = np.linalg.eigh(self.cov_xy)
        vals = np.clip(vals, 0, None)
        angle = float(np.arctan2(vecs[1, 1], vecs[0, 1]))
        return float(np.sqrt(vals[1])), float(np.sqrt(vals[0])), angle

    @property
    def gdop(self) -> float:
        return float(np.sqrt(np.trace(self.cov_xy)))


def multilaterate(
    sensors: np.ndarray,
    arrivals: np.ndarray,
    velocity: float = 300.0,
    sigma_t: float = 1e-3,
    initial: tuple[float, float] | None = None,
    max_iter: int = 50,
    tol: float = 1e-6,
) -> TdoaFix:
    """Locate a seismic source from arrival times at ≥ 3 sensors (positions in metres)."""
    sensors = np.asarray(sensors, dtype=float)
    arrivals = np.asarray(arrivals, dtype=float)
    if sensors.shape[0] < 3 or sensors.shape[0] != arrivals.shape[0]:
        raise ValueError("need ≥ 3 sensors with one arrival time each")

    if initial is None:
        # Start at the arrival-weighted centroid: earlier arrivals pull the guess closer.
        w = np.exp(-(arrivals - arrivals.min()) * velocity / 20.0)
        initial = tuple((sensors * w[:, None]).sum(0) / w.sum())
    x, y = initial
    d0 = np.hypot(sensors[:, 0] - x, sensors[:, 1] - y)
    t0 = float(np.mean(arrivals - d0 / velocity))
    theta = np.array([x, y, t0])
    mu = 1e-3
    converged = False
    it = 0

    def residuals(th: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        dx, dy = th[0] - sensors[:, 0], th[1] - sensors[:, 1]
        d = np.maximum(np.hypot(dx, dy), 1e-6)
        r = arrivals - th[2] - d / velocity
        jac = np.column_stack([-dx / (velocity * d), -dy / (velocity * d), -np.ones_like(d)])
        return r, jac

    r, jac = residuals(theta)
    cost = float(r @ r)
    for it in range(1, max_iter + 1):  # noqa: B007 - iteration count is reported after the loop
        jtj = jac.T @ jac
        step = np.linalg.solve(jtj + mu * np.diag(np.diag(jtj) + 1e-12), -jac.T @ r)
        cand = theta + step
        r_new, jac_new = residuals(cand)
        cost_new = float(r_new @ r_new)
        if cost_new < cost:           # accept: behave more like Gauss-Newton
            theta, r, jac, cost = cand, r_new, jac_new, cost_new
            mu = max(mu / 3, 1e-9)
            if np.linalg.norm(step[:2]) < tol:
                converged = True
                break
        else:                         # reject: behave more like gradient descent
            mu *= 4
            if mu > 1e8:
                break

    jtj = jac.T @ jac
    try:
        cov = sigma_t ** 2 * np.linalg.inv(jtj)
    except np.linalg.LinAlgError:
        cov = np.full((3, 3), np.inf)
    rms = float(np.sqrt(cost / len(arrivals)))
    return TdoaFix(float(theta[0]), float(theta[1]), float(theta[2]), cov[:2, :2], rms, it,
                   converged or rms < 5 * sigma_t)
