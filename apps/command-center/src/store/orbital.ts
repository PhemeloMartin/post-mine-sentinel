import { create } from 'zustand';
import { YEAR_NOW } from '@/data/registry';
import type { Commodity, MineStatus } from '@/types';

interface OrbitalStore {
  year: number;
  playing: boolean;
  speed: number; // years per second
  selectedId: string | null;
  hoveredId: string | null;
  commodities: Set<Commodity>;
  statuses: Set<MineStatus>;
  minRai: number;
  showNetwork: boolean;
  autoRotate: boolean;
  setYear: (y: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  toggleCommodity: (c: Commodity) => void;
  toggleStatus: (s: MineStatus) => void;
  setMinRai: (v: number) => void;
  setShowNetwork: (v: boolean) => void;
  setAutoRotate: (v: boolean) => void;
}

const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
  const n = new Set(set);
  if (n.has(v)) n.delete(v);
  else n.add(v);
  return n;
};

export const useOrbital = create<OrbitalStore>((set) => ({
  year: YEAR_NOW,
  playing: false,
  speed: 6,
  selectedId: null,
  hoveredId: null,
  commodities: new Set(),
  statuses: new Set(),
  minRai: 0,
  showNetwork: true,
  autoRotate: true,
  setYear: (year) => set({ year }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  select: (selectedId) => set({ selectedId }),
  hover: (hoveredId) => set({ hoveredId }),
  toggleCommodity: (c) => set((s) => ({ commodities: toggle(s.commodities, c) })),
  toggleStatus: (st) => set((s) => ({ statuses: toggle(s.statuses, st) })),
  setMinRai: (minRai) => set({ minRai }),
  setShowNetwork: (showNetwork) => set({ showNetwork }),
  setAutoRotate: (autoRotate) => set({ autoRotate }),
}));
