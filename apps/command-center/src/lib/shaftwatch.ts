/**
 * ShaftWatch change detection (TypeScript port of ml/sentinel_ml/satellite/change.py) and a
 * clearly-labelled synthetic demo series. Live series come from the Earth Engine job.
 */
import { Rng, hash32 } from '@/sim/rng';

export interface MonthPoint {
  month: number;
  label: string;
  ndvi: number;
  bsi: number;
  disturbance: number;
  cusum: number;
  alarm: boolean;
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
}

export function robustSeasonalZ(values: number[], period = 12, minHistory = 2): number[] {
  return values.map((v, t) => {
    const hist: number[] = [];
    for (let k = t - period; k >= 0; k -= period) hist.push(values[k]);
    if (hist.length < minHistory) return 0;
    const med = median(hist);
    const mad = median(hist.map((h) => Math.abs(h - med)));
    return (v - med) / (1.4826 * mad + 0.01);
  });
}

export function shaftwatchSeries(siteId: string, disturbed: boolean, startYear = 2020, months = 72): MonthPoint[] {
  const rng = new Rng(hash32(siteId));
  const onset = disturbed ? 40 + Math.floor(rng.next() * 20) : -1;
  const ndvi: number[] = [];
  const bsi: number[] = [];
  for (let t = 0; t < months; t++) {
    const season = Math.cos((2 * Math.PI * (t - 1)) / 12);
    const ramp = onset >= 0 ? Math.min(1, Math.max(0, (t - onset) / 6)) : 0;
    ndvi.push(0.42 + 0.16 * season + rng.normal(0, 0.025) - 0.12 * ramp);
    bsi.push(0.05 - 0.07 * season + rng.normal(0, 0.02) + 0.1 * ramp);
  }
  const zv = robustSeasonalZ(ndvi);
  const zb = robustSeasonalZ(bsi);
  let acc = 0;
  return ndvi.map((v, t) => {
    const d = Math.max(-6, Math.min(6, 0.45 * -zv[t] + 0.4 * zb[t]));
    acc = Math.max(0, acc + d - 0.5);
    const y = startYear + Math.floor(t / 12);
    const m = (t % 12) + 1;
    return { month: t, label: `${y}-${String(m).padStart(2, '0')}`, ndvi: +v.toFixed(3), bsi: +bsi[t].toFixed(3), disturbance: +d.toFixed(2), cusum: +acc.toFixed(2), alarm: acc > 4 };
  });
}
