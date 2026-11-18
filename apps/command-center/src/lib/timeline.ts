import type { Mine, MineStatus } from '@/types';

/** Status of a mine as it would have appeared in a given year. */
export function statusAt(m: Mine, year: number, now = 2026): MineStatus | null {
  if (m.opened !== null && year < m.opened) return null; // not yet opened
  if (m.closed !== null) return year >= m.closed ? m.status : 'operating';
  if (m.opened === null) return m.status; // undated record: only the current status is known
  return year >= now ? m.status : 'operating'; // no closure year: assume producing until today
}

/**
 * Cumulative production up to `year`, assuming a uniform production rate between the
 * opening and closing years (midpoint of the estimated range). Order-of-magnitude only.
 */
export function cumulativeProduction(mines: Mine[], year: number, unit: string, commodity: string): number {
  let total = 0;
  for (const m of mines) {
    if (m.commodity !== commodity || !m.production || m.production.unit !== unit || m.opened === null) continue;
    const end = m.closed ?? 2026;
    const span = Math.max(1, end - m.opened);
    const share = Math.min(1, Math.max(0, (year - m.opened) / span));
    total += ((m.production.low + m.production.high) / 2) * share;
  }
  return total;
}

/** Openings and closures per decade for the timeline histogram. */
export function decadeHistogram(mines: Mine[]): { decade: number; opened: number; closed: number }[] {
  const map = new Map<number, { opened: number; closed: number }>();
  for (let d = 1850; d <= 2020; d += 10) map.set(d, { opened: 0, closed: 0 });
  for (const m of mines) {
    if (m.opened) map.get(Math.floor(m.opened / 10) * 10)!.opened += 1;
    if (m.closed) map.get(Math.floor(m.closed / 10) * 10)!.closed += 1;
  }
  return [...map.entries()].map(([decade, v]) => ({ decade, ...v }));
}
