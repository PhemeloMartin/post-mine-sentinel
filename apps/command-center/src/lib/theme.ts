import type { Commodity, MineStatus, RiskBand } from '@/types';

export const STATUS_COLOR: Record<MineStatus, string> = {
  operating: '#22d3ee',
  restarted: '#38bdf8',
  care_maintenance: '#f59e0b',
  closed: '#fb923c',
  derelict: '#ef4444',
  rehabilitated: '#34d399',
};

export const STATUS_LABEL: Record<MineStatus, string> = {
  operating: 'Operating',
  restarted: 'Restarted',
  care_maintenance: 'Care & maintenance',
  closed: 'Closed',
  derelict: 'Derelict / ownerless',
  rehabilitated: 'Rehabilitated',
};

export const BAND_COLOR: Record<RiskBand, string> = {
  low: '#34d399',
  elevated: '#facc15',
  high: '#fb923c',
  critical: '#ef4444',
};

export const COMMODITY_LABEL: Record<Commodity, string> = {
  gold: 'Gold',
  diamonds: 'Diamonds',
  pgm: 'PGMs',
  coal: 'Coal',
  iron: 'Iron ore',
  manganese: 'Manganese',
  copper: 'Copper',
  zinc: 'Zinc',
  asbestos: 'Asbestos',
  tin: 'Tin',
  chrome: 'Chrome',
};

/** Shape glyphs so status is never encoded by colour alone (WCAG 1.4.1). */
export const STATUS_GLYPH: Record<MineStatus, string> = {
  operating: '●',
  restarted: '◐',
  care_maintenance: '◆',
  closed: '▲',
  derelict: '✖',
  rehabilitated: '✚',
};

export const FACTOR_LABEL: Record<string, string> = {
  commodity: 'Commodity attraction',
  residual: 'Residual value',
  access: 'Physical access',
  pressure: 'Socio-economic pressure',
  history: 'Incident history',
};

export const FACTOR_COLOR: Record<string, string> = {
  commodity: '#facc15',
  residual: '#f59e0b',
  access: '#ef4444',
  pressure: '#a78bfa',
  history: '#22d3ee',
};
