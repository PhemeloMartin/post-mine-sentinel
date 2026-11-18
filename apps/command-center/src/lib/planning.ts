/**
 * Orienteering-problem heuristic (TypeScript port of ml/sentinel_ml/planning/orienteering.py):
 * greedy ratio insertion → 2-opt → iterated local search. The API offers the exact DP and
 * the QUBO/QAOA solvers for small instances; the browser uses this for instant what-ifs.
 */
import { haversineKm } from './geo';
import { Rng } from '@/sim/rng';

export interface PlanSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
  value: number;
  serviceH: number;
}

export interface PlanResult {
  route: PlanSite[];
  value: number;
  durationH: number;
  legs: { from: string; to: string; hours: number }[];
}

export function travelMatrix(depot: { lat: number; lon: number }, sites: PlanSite[], speedKmh = 60, circuity = 1.3): number[][] {
  const pts = [depot, ...sites];
  return pts.map((a) => pts.map((b) => (haversineKm(a.lat, a.lon, b.lat, b.lon) * circuity) / speedKmh));
}

function duration(route: number[], t: number[][], sites: PlanSite[]): number {
  if (!route.length) return 0;
  const path = [0, ...route.map((i) => i + 1), 0];
  let d = 0;
  for (let k = 0; k < path.length - 1; k++) d += t[path[k]][path[k + 1]];
  return d + route.reduce((s, i) => s + sites[i].serviceH, 0);
}

function twoOpt(route: number[], t: number[][], sites: PlanSite[]): number[] {
  let best = route.slice();
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const cand = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        if (duration(cand, t, sites) + 1e-12 < duration(best, t, sites)) {
          best = cand;
          improved = true;
        }
      }
    }
  }
  return best;
}

function greedyFill(route: number[], t: number[][], sites: PlanSite[], budget: number): number[] {
  let r = route.slice();
  for (;;) {
    const base = duration(r, t, sites);
    let best: { ratio: number; cand: number[] } | null = null;
    for (let k = 0; k < sites.length; k++) {
      if (r.includes(k)) continue;
      for (let pos = 0; pos <= r.length; pos++) {
        const cand = [...r.slice(0, pos), k, ...r.slice(pos)];
        const d = duration(cand, t, sites);
        if (d <= budget) {
          const ratio = sites[k].value / (d - base + 1e-9);
          if (!best || ratio > best.ratio) best = { ratio, cand };
        }
      }
    }
    if (!best) return r;
    r = twoOpt(best.cand, t, sites);
  }
}

export function planRoute(depot: { id: string; lat: number; lon: number }, sites: PlanSite[], budgetH: number, iterations = 60, seed = 1): PlanResult {
  const t = travelMatrix(depot, sites);
  const rng = new Rng(seed);
  const value = (r: number[]) => r.reduce((s, i) => s + sites[i].value, 0);
  let route = greedyFill([], t, sites, budgetH);
  let best = route.slice();
  for (let it = 0; it < iterations && route.length; it++) {
    const cand = route.slice();
    const removals = 1 + Math.floor(rng.next() * Math.max(1, cand.length / 3));
    for (let k = 0; k < removals && cand.length; k++) cand.splice(Math.floor(rng.next() * cand.length), 1);
    const filled = greedyFill(twoOpt(cand, t, sites), t, sites, budgetH);
    if (value(filled) > value(route) || (value(filled) === value(route) && duration(filled, t, sites) < duration(route, t, sites))) {
      route = filled;
      if (value(route) > value(best)) best = route.slice();
    }
  }
  const path = [0, ...best.map((i) => i + 1), 0];
  const names = [depot.id, ...sites.map((s) => s.id)];
  const legs = path.slice(0, -1).map((a, k) => ({ from: names[a], to: names[path[k + 1]], hours: t[a][path[k + 1]] }));
  return { route: best.map((i) => sites[i]), value: value(best), durationH: duration(best, t, sites), legs };
}
