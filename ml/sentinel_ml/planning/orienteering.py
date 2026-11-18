"""Inspection / patrol planning as an Orienteering Problem (OP).

Given a depot (team base) and candidate sites i with value r_i (expected risk reduced by
an inspection, e.g. RAI × posterior intrusion probability) and on-site time s_i, choose
and order a subset so the round trip fits the shift budget B:

    maximise   Σ_i r_i · y_i
    subject to Σ_(i,j) t_ij · x_ij + Σ_i s_i · y_i ≤ B
               route is a single tour from and back to the depot

The OP is NP-hard (it generalises the TSP), so we provide:

* ``solve_exact``     Held–Karp style DP over subsets, O(2ⁿ · n²) — ground truth for n ≤ 15.
* ``solve_heuristic`` greedy ratio insertion + 2-opt + iterated local search (ILS) for the
                      national scale (hundreds of sites, several teams).

Travel times use great-circle distance × a road circuity factor (≈1.3 for SA rural roads)
at an average speed, which is adequate for planning; the API can swap in an OSRM matrix.
"""

from __future__ import annotations

import itertools
import random
from dataclasses import dataclass

import numpy as np

from ..geo import haversine_m


@dataclass(frozen=True)
class Site:
    id: str
    lat: float
    lon: float
    value: float          # risk value of inspecting this site
    service_h: float = 1.0


@dataclass
class Plan:
    route: list[int]       # indices into the site list (depot excluded)
    value: float
    duration_h: float

    def ids(self, sites: list[Site]) -> list[str]:
        return [sites[i].id for i in self.route]


def travel_matrix(depot: tuple[float, float], sites: list[Site], speed_kmh: float = 60.0,
                  circuity: float = 1.3) -> np.ndarray:
    """(n+1)×(n+1) travel-time matrix in hours; index 0 is the depot."""
    pts = [depot] + [(s.lat, s.lon) for s in sites]
    n = len(pts)
    t = np.zeros((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            km = haversine_m(*pts[i], *pts[j]) / 1000 * circuity
            t[i, j] = t[j, i] = km / speed_kmh
    return t


def route_duration(route: list[int], t: np.ndarray, sites: list[Site]) -> float:
    if not route:
        return 0.0
    path = [0] + [i + 1 for i in route] + [0]
    return float(sum(t[a, b] for a, b in itertools.pairwise(path)) + sum(sites[i].service_h for i in route))


def solve_exact(sites: list[Site], t: np.ndarray, budget_h: float) -> Plan:
    """Exact OP by DP over (subset, last) holding the minimum elapsed time."""
    n = len(sites)
    if n > 16:
        raise ValueError("exact solver limited to 16 sites; use solve_heuristic")
    inf = float("inf")
    full = 1 << n
    dp = np.full((full, n), inf)
    parent = np.full((full, n), -1, dtype=np.int32)
    for j in range(n):
        dp[1 << j, j] = t[0, j + 1] + sites[j].service_h
    for mask in range(1, full):
        for j in range(n):
            cur = dp[mask, j]
            if cur == inf or cur > budget_h:
                continue
            for k in range(n):
                if mask & (1 << k):
                    continue
                nxt = cur + t[j + 1, k + 1] + sites[k].service_h
                nm = mask | (1 << k)
                if nxt < dp[nm, k]:
                    dp[nm, k] = nxt
                    parent[nm, k] = j
    best = Plan([], 0.0, 0.0)
    values = np.array([s.value for s in sites])
    for mask in range(1, full):
        for j in range(n):
            if dp[mask, j] == inf:
                continue
            total = dp[mask, j] + t[j + 1, 0]
            if total <= budget_h:
                v = float(values[[b for b in range(n) if mask >> b & 1]].sum())
                if v > best.value + 1e-12 or (abs(v - best.value) <= 1e-12 and total < best.duration_h):
                    route, m, cur = [], mask, j
                    while cur != -1:
                        route.append(cur)
                        prev = int(parent[m, cur])
                        m ^= 1 << cur
                        cur = prev
                    best = Plan(route[::-1], v, float(total))
    return best


def _two_opt(route: list[int], t: np.ndarray, sites: list[Site]) -> list[int]:
    improved = True
    best = route[:]
    while improved:
        improved = False
        for i in range(len(best) - 1):
            for j in range(i + 1, len(best)):
                cand = best[:i] + best[i:j + 1][::-1] + best[j + 1:]
                if route_duration(cand, t, sites) + 1e-12 < route_duration(best, t, sites):
                    best, improved = cand, True
    return best


def _greedy_fill(route: list[int], candidates: set[int], t: np.ndarray, sites: list[Site],
                 budget_h: float) -> list[int]:
    route = route[:]
    while True:
        base = route_duration(route, t, sites)
        best = None
        for k in candidates - set(route):
            for pos in range(len(route) + 1):
                cand = route[:pos] + [k] + route[pos:]
                dur = route_duration(cand, t, sites)
                if dur <= budget_h:
                    ratio = sites[k].value / (dur - base + 1e-9)
                    if best is None or ratio > best[0]:
                        best = (ratio, cand)
        if best is None:
            return route
        route = _two_opt(best[1], t, sites)


def solve_heuristic(sites: list[Site], t: np.ndarray, budget_h: float, iterations: int = 200,
                    seed: int = 0) -> Plan:
    """Greedy insertion → 2-opt → iterated local search with random removals."""
    rng = random.Random(seed)
    all_idx = set(range(len(sites)))
    route = _greedy_fill([], all_idx, t, sites, budget_h)

    def value(r: list[int]) -> float:
        return float(sum(sites[i].value for i in r))

    best = route[:]
    for _ in range(iterations):
        if not route:
            break
        cand = route[:]
        for _ in range(rng.randint(1, max(1, len(cand) // 3))):
            if cand:
                cand.pop(rng.randrange(len(cand)))
        cand = _greedy_fill(_two_opt(cand, t, sites), all_idx, t, sites, budget_h)
        if value(cand) > value(route) or (value(cand) == value(route)
                                          and route_duration(cand, t, sites) < route_duration(route, t, sites)):
            route = cand
            if value(route) > value(best):
                best = route[:]
    return Plan(best, value(best), route_duration(best, t, sites))
