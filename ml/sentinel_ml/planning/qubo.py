"""Quantum-ready site selection: QUBO formulation, simulated annealing and QAOA.

The selection core of the inspection problem (which sites to visit when each costs c_i
hours and the team has B hours) is a 0/1 knapsack. In QUBO form, with binary slack
variables y_k encoding the unused budget:

    minimise  E(x, y) = −Σ_i r_i x_i  +  P · ( Σ_i c_i x_i + Σ_k 2^k·u·y_k − B )²

where u is the slack resolution and P > max_i r_i makes any constraint violation more
expensive than the best possible gain. Expanding the square gives E = zᵀ Q z (+ const)
over z = (x, y), which is exactly the input format of quantum annealers and of QAOA.

QAOA (Farhi et al., 2014) with depth p prepares

    |γ, β⟩ = Π_{l=1..p} e^(−iβ_l H_M) e^(−iγ_l H_C) |+⟩^⊗n,    H_M = Σ_j X_j

and minimises ⟨γ, β| H_C |γ, β⟩ classically. Because our pilot instances need ≤ 14
qubits we simulate the statevector *exactly* in NumPy (2¹⁴ amplitudes). That keeps the
pipeline honest: classical exact and annealing answers are reported alongside, and the
same QUBO can be submitted unchanged to real quantum hardware later.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy.optimize import minimize


@dataclass
class QuboProblem:
    Q: np.ndarray            # upper-triangular QUBO matrix over z = (x, slack)
    offset: float
    n_items: int
    n_slack: int
    values: np.ndarray
    costs: np.ndarray
    budget: float

    @property
    def n(self) -> int:
        return self.n_items + self.n_slack

    def energy(self, z: np.ndarray) -> float:
        return float(z @ self.Q @ z + self.offset)

    def decode(self, z: np.ndarray) -> tuple[list[int], float, float, bool]:
        x = z[: self.n_items]
        chosen = [i for i in range(self.n_items) if x[i] > 0.5]
        cost = float(self.costs[chosen].sum()) if chosen else 0.0
        return chosen, float(self.values[chosen].sum()) if chosen else 0.0, cost, cost <= self.budget + 1e-9


def build_selection_qubo(values, costs, budget: float, slack_resolution: float = 0.5,
                         penalty: float | None = None) -> QuboProblem:
    """Exact knapsack QUBO.

    Costs are rounded *up* and the budget *down* to integer multiples of the slack
    resolution u, so every integer-feasible selection is truly feasible and can drive
    the residual (a·z − B) to exactly 0 with some slack setting, while any violation
    has |residual| ≥ 1. Choosing P = Σ r_i + 1 therefore guarantees that no infeasible
    state can ever have lower energy than the empty (feasible) selection.
    """
    values = np.asarray(values, dtype=float)
    costs = np.asarray(costs, dtype=float)
    u = slack_resolution
    c_int = np.ceil(costs / u - 1e-9)
    b_int = math.floor(budget / u + 1e-9)
    n_slack = max(1, math.ceil(math.log2(b_int + 1)))
    coef = np.concatenate([c_int, 2.0 ** np.arange(n_slack)])
    lin = np.concatenate([-values, np.zeros(n_slack)])
    p = penalty if penalty is not None else float(values.sum()) + 1.0
    n = len(coef)
    Q = np.zeros((n, n))
    # P (a·z − B)² = P Σ a_i² z_i + 2P Σ_{i<j} a_i a_j z_i z_j − 2PB Σ a_i z_i + P B²   (z_i² = z_i)
    for i in range(n):
        Q[i, i] = lin[i] + p * coef[i] ** 2 - 2 * p * b_int * coef[i]
        for j in range(i + 1, n):
            Q[i, j] = 2 * p * coef[i] * coef[j]
    return QuboProblem(Q, p * b_int ** 2, len(values), n_slack, values, c_int * u, b_int * u)


def brute_force(problem: QuboProblem) -> np.ndarray:
    """Exact minimiser by enumeration (n ≤ 20)."""
    energies = _all_energies(problem)
    best = int(np.argmin(energies))
    return _bits(best, problem.n)


def simulated_annealing(problem: QuboProblem, sweeps: int = 4000, t_start: float | None = None,
                        t_end: float = 1e-3, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = problem.n
    Qs = problem.Q + problem.Q.T - np.diag(np.diag(problem.Q))   # symmetric view
    z = rng.integers(0, 2, n).astype(float)
    t0 = t_start or float(np.abs(problem.Q).max())
    best, best_e = z.copy(), problem.energy(z)
    e = best_e
    for s in range(sweeps):
        temp = t0 * (t_end / t0) ** (s / max(1, sweeps - 1))
        for i in rng.permutation(n):
            # ΔE for flipping bit i: (1−2z_i)·(Q_ii + Σ_{j≠i} Qs_ij z_j)
            delta = (1 - 2 * z[i]) * (problem.Q[i, i] + Qs[i] @ z - Qs[i, i] * z[i])
            if delta < 0 or rng.random() < math.exp(-delta / max(temp, 1e-12)):
                z[i] = 1 - z[i]
                e += delta
                if e < best_e:
                    best, best_e = z.copy(), e
    return best


def _bits(index: int, n: int) -> np.ndarray:
    return np.array([(index >> (n - 1 - k)) & 1 for k in range(n)], dtype=float)


def _all_energies(problem: QuboProblem) -> np.ndarray:
    n = problem.n
    idx = np.arange(2 ** n)
    z = ((idx[:, None] >> (n - 1 - np.arange(n))[None, :]) & 1).astype(float)
    return np.einsum("bi,ij,bj->b", z, problem.Q, z) + problem.offset


def _apply_mixer(state: np.ndarray, beta: float, n: int) -> np.ndarray:
    """Apply Π_j RX(2β) = Π_j (cos β·I − i sin β·X_j) to an n-qubit statevector."""
    c, s = math.cos(beta), -1j * math.sin(beta)
    psi = state.reshape([2] * n)
    for q in range(n):
        a = np.take(psi, 0, axis=q)
        b = np.take(psi, 1, axis=q)
        psi = np.stack([c * a + s * b, s * a + c * b], axis=q)
    return psi.reshape(-1)


def qaoa_statevector(problem: QuboProblem, p: int = 2, restarts: int = 4, seed: int = 0) -> dict:
    """Exact-statevector QAOA. Returns the best feasible bitstring among the top samples."""
    n = problem.n
    if n > 16:
        raise ValueError("statevector QAOA limited to 16 qubits in this prototype")
    energies = _all_energies(problem)
    scale = float(np.abs(energies).max()) or 1.0
    h_c = energies / scale                     # normalised diagonal cost Hamiltonian
    plus = np.full(2 ** n, 1 / math.sqrt(2 ** n), dtype=complex)

    def state(params: np.ndarray) -> np.ndarray:
        psi = plus.copy()
        for layer in range(p):
            psi = psi * np.exp(-1j * params[layer] * h_c)
            psi = _apply_mixer(psi, params[p + layer], n)
        return psi

    def expectation(params: np.ndarray) -> float:
        psi = state(params)
        return float(np.real(np.vdot(psi, h_c * psi)))

    rng = np.random.default_rng(seed)
    best_res = None
    for _ in range(restarts):
        x0 = np.concatenate([rng.uniform(0, math.pi, p), rng.uniform(0, math.pi / 2, p)])
        res = minimize(expectation, x0, method="COBYLA", options={"maxiter": 400})
        if best_res is None or res.fun < best_res.fun:
            best_res = res
    probs = np.abs(state(best_res.x)) ** 2
    order = np.argsort(-probs)[:64]
    best_z, best_val = None, -1.0
    for idx in order:
        z = _bits(int(idx), n)
        _, val, _, feasible = problem.decode(z)
        if feasible and val > best_val:
            best_z, best_val = z, val
    ground = int(np.argmin(energies))
    return {
        "bitstring": best_z,
        "expected_energy": float(best_res.fun * scale),
        "params": best_res.x.tolist(),
        "p_ground_state": float(probs[ground]),
        "approximation_ratio": float(best_val / max(problem.decode(_bits(ground, n))[1], 1e-12)),
    }
