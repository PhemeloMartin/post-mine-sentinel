import numpy as np

from sentinel_ml.planning import (
    Site,
    build_selection_qubo,
    qaoa_statevector,
    simulated_annealing,
    solve_exact,
    solve_heuristic,
    travel_matrix,
)
from sentinel_ml.planning.qubo import brute_force

KOSH_SITES = [
    Site("ZA-NW-002", -26.890, 26.805, 9.0, 1.5),
    Site("ZA-NW-003", -26.875, 26.815, 7.5, 1.0),
    Site("ZA-NW-001", -26.835, 26.790, 8.0, 1.5),
    Site("ZA-NW-004", -26.815, 26.720, 6.0, 1.0),
    Site("ZA-NW-009", -26.970, 26.665, 5.5, 1.0),
    Site("ZA-FS-021", -27.000, 26.735, 3.0, 1.0),
    Site("ZA-NW-005", -26.990, 26.700, 2.5, 1.0),
    Site("ZA-FS-002", -27.985, 26.750, 8.5, 1.5),   # Welkom: far away, should rarely fit
]
DEPOT = (-26.8521, 26.6667)  # Klerksdorp SOC


def test_heuristic_matches_exact_on_small_instance():
    t = travel_matrix(DEPOT, KOSH_SITES)
    exact = solve_exact(KOSH_SITES, t, budget_h=7.0)
    heur = solve_heuristic(KOSH_SITES, t, budget_h=7.0, iterations=150)
    assert exact.duration_h <= 7.0 + 1e-9
    assert heur.duration_h <= 7.0 + 1e-9
    assert heur.value >= 0.95 * exact.value


def test_exact_excludes_unreachable_far_site():
    t = travel_matrix(DEPOT, KOSH_SITES)
    plan = solve_exact(KOSH_SITES, t, budget_h=4.0)
    assert "ZA-FS-002" not in plan.ids(KOSH_SITES)


def test_qubo_ground_state_is_optimal_knapsack():
    values = np.array([9.0, 7.5, 8.0, 6.0, 5.5, 3.0])
    costs = np.array([2.0, 1.5, 2.5, 1.5, 2.0, 1.0])
    prob = build_selection_qubo(values, costs, budget=5.0)
    chosen, val, cost, feasible = prob.decode(brute_force(prob))
    # enumerate knapsack directly
    best = max(
        (sum(values[i] for i in range(6) if m >> i & 1), m)
        for m in range(64) if sum(costs[i] for i in range(6) if m >> i & 1) <= 5.0
    )
    assert feasible and cost <= 5.0
    assert val == best[0]


def test_annealing_and_qaoa_find_feasible_high_value_selection():
    values = np.array([9.0, 7.5, 8.0, 6.0, 5.5])
    costs = np.array([2.0, 1.5, 2.5, 1.5, 2.0])
    prob = build_selection_qubo(values, costs, budget=4.0)
    opt = prob.decode(brute_force(prob))[1]
    sa = prob.decode(simulated_annealing(prob, sweeps=1500, seed=3))
    assert sa[3] and sa[1] >= 0.9 * opt
    q = qaoa_statevector(prob, p=2, restarts=2, seed=1)
    assert q["bitstring"] is not None
    assert q["approximation_ratio"] >= 0.7
