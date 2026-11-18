import { MINES } from '@/data/registry';
import { generalise, project } from '@/lib/geo';
import { statusAt } from '@/lib/timeline';
import type { Commodity, Mine, MineStatus } from '@/types';

export interface VisibleMine {
  mine: Mine;
  status: MineStatus;
  x: number;
  z: number;
  height: number;
}

/** Pillar height ∝ log production, normalised within each commodity so units never mix. */
const maxLog = new Map<string, number>();
for (const m of MINES) {
  if (!m.production) continue;
  const v = Math.log10(1 + (m.production.low + m.production.high) / 2);
  maxLog.set(m.commodity, Math.max(maxLog.get(m.commodity) ?? 0, v));
}

export function pillarHeight(m: Mine): number {
  if (!m.production) return 0.35;
  const v = Math.log10(1 + (m.production.low + m.production.high) / 2);
  return 0.25 + 1.65 * (v / (maxLog.get(m.commodity) || 1));
}

export function visibleMines(opts: {
  year: number;
  commodities: Set<Commodity>;
  statuses: Set<MineStatus>;
  minRai: number;
  generalised: boolean;
}): VisibleMine[] {
  const out: VisibleMine[] = [];
  for (const m of MINES) {
    const st = statusAt(m, opts.year);
    if (!st) continue;
    if (opts.commodities.size && !opts.commodities.has(m.commodity)) continue;
    if (opts.statuses.size && !opts.statuses.has(st)) continue;
    if (m.risk.rai < opts.minRai) continue;
    const [lat, lon] = opts.generalised ? generalise(m.lat, m.lon) : [m.lat, m.lon];
    const [x, z] = project(lon, lat);
    out.push({ mine: m, status: st, x, z, height: pillarHeight(m) });
  }
  return out;
}
