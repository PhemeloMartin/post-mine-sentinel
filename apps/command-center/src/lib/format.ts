import type { Range } from '@/types';

export function fmtNumber(v: number, digits = 0): string {
  return v.toLocaleString('en-ZA', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtRange(r: Range | null): string {
  if (!r) return 'Unknown';
  const d = r.high < 10 ? 1 : 0;
  const body = r.low === r.high ? fmtNumber(r.low, d) : `${fmtNumber(r.low, d)}–${fmtNumber(r.high, d)}`;
  return `${body} ${r.unit}`;
}

export function fmtYears(opened: number | null, closed: number | null): string {
  return `${opened ?? '?'} → ${closed ?? 'present'}`;
}

/** Simulation clock: seconds since midnight → HH:MM:SS (wraps past 24 h). */
export function fmtClock(secondsOfDay: number): string {
  const s = ((Math.floor(secondsOfDay) % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':');
}

export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const m = Math.floor(seconds / 60);
  return `${m} min ${Math.round(seconds % 60)} s`;
}

export function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}
