import { create } from 'zustand';
import type { SiteSimulation, SimState } from '@/sim/engine';

/** The live engine instance is held outside React so 3D components can read it every frame. */
export const simHolder: { current: SiteSimulation | null } = { current: null };

export type CameraPreset = 'overview' | 'collar' | 'underground' | 'approach';

interface SimStore {
  snapshot: SimState | null;
  playing: boolean;
  speed: number;
  reveal: boolean;
  xray: boolean;
  scenarioId: string;
  profile: 'calibrated' | 'uncalibrated';
  runId: number;
  camera: CameraPreset;
  setSnapshot: (s: SimState) => void;
  setPlaying: (v: boolean) => void;
  setSpeed: (v: number) => void;
  setReveal: (v: boolean) => void;
  setXray: (v: boolean) => void;
  setScenario: (id: string) => void;
  setProfile: (p: 'calibrated' | 'uncalibrated') => void;
  restart: () => void;
  setCamera: (c: CameraPreset) => void;
}

export const useSim = create<SimStore>((set) => ({
  snapshot: null,
  playing: true,
  speed: 8,
  reveal: false,
  xray: false,
  scenarioId: 'night-incursion',
  profile: 'calibrated',
  runId: 0,
  camera: 'overview',
  setSnapshot: (snapshot) => set({ snapshot }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setReveal: (reveal) => set({ reveal }),
  setXray: (xray) => set({ xray }),
  setScenario: (scenarioId) => set((s) => ({ scenarioId, runId: s.runId + 1, playing: true })),
  setProfile: (profile) => set((s) => ({ profile, runId: s.runId + 1 })),
  restart: () => set((s) => ({ runId: s.runId + 1, playing: true })),
  setCamera: (camera) => set((s) => ({ camera, xray: camera === 'underground' ? true : s.xray })),
}));
