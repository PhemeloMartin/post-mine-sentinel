/**
 * Digital-twin layout of a representative derelict Witwatersrand shaft site.
 * Units are metres; three.js axes: x = east, y = up, z = south. Shaft collar at the origin.
 * Underground depths are shown at true scale for the first three levels of shallow
 * outcrop workings (deep levels are omitted for clarity).
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Mount = 'headframe' | 'collar' | 'fence' | 'ruin' | 'rock' | 'path' | 'tailings' | 'road';

export interface NodeSpec {
  id: string;
  mount: Mount;
  pos: Vec3;
  /** Plane the web is spun in: 'v' vertical (between structure members) or 'h' horizontal (rock crevice). */
  web: 'v' | 'h';
  webYaw: number;
  pir: boolean;
}

export interface GatewaySpec {
  id: string;
  name: string;
  disguise: string;
  pos: Vec3;
  heightGainDb: number;
}

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const dist2 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);

export const FENCE_RADIUS = 55;
export const FENCE_GAPS_DEG = [225, 90];
export const HEADFRAME_HEIGHT = 30;
export const LEVELS = [-40, -80, -120];

const fenceNode = (id: string, deg: number): NodeSpec => {
  const a = (deg * Math.PI) / 180;
  return {
    id,
    mount: 'fence',
    pos: v3(FENCE_RADIUS * Math.cos(a), 1.3, FENCE_RADIUS * Math.sin(a)),
    web: 'v',
    webYaw: a + Math.PI / 2,
    pir: true,
  };
};

export const NODES: NodeSpec[] = [
  { id: 'S01', mount: 'headframe', pos: v3(4.2, 7, -4.2), web: 'v', webYaw: Math.PI / 4, pir: false },
  { id: 'S02', mount: 'headframe', pos: v3(-4.2, 4, 4.2), web: 'v', webYaw: Math.PI / 4, pir: false },
  { id: 'S03', mount: 'collar', pos: v3(0.5, 0.35, -6.5), web: 'h', webYaw: 0, pir: true },
  { id: 'S04', mount: 'collar', pos: v3(2.5, 0.35, 6.5), web: 'h', webYaw: 0, pir: true },
  fenceNode('S05', 0),
  fenceNode('S06', 45),
  fenceNode('S07', 75),
  fenceNode('S08', 135),
  fenceNode('S09', 180),
  fenceNode('S10', 210),
  fenceNode('S11', 270),
  fenceNode('S12', 315),
  { id: 'S13', mount: 'ruin', pos: v3(15.2, 2.6, 6), web: 'v', webYaw: 0, pir: true },
  { id: 'S14', mount: 'ruin', pos: v3(-24, 2.1, 20.5), web: 'v', webYaw: Math.PI / 2, pir: true },
  { id: 'S15', mount: 'rock', pos: v3(-70, 0.7, -70), web: 'h', webYaw: 0.3, pir: true },
  { id: 'S16', mount: 'rock', pos: v3(62, 0.6, 42), web: 'h', webYaw: 1.1, pir: true },
  { id: 'S17', mount: 'rock', pos: v3(-50, 0.6, 82), web: 'h', webYaw: 2.0, pir: true },
  { id: 'S18', mount: 'rock', pos: v3(96, 0.7, -22), web: 'h', webYaw: 0.7, pir: true },
  { id: 'S19', mount: 'rock', pos: v3(-122, 0.7, -60), web: 'h', webYaw: 2.6, pir: true },
  { id: 'S20', mount: 'rock', pos: v3(22, 0.6, -96), web: 'h', webYaw: 1.7, pir: true },
  { id: 'S21', mount: 'path', pos: v3(-97, 0.5, -104), web: 'h', webYaw: 0.4, pir: true },
  { id: 'S22', mount: 'path', pos: v3(-12, 0.5, 112), web: 'h', webYaw: 1.2, pir: true },
  { id: 'S23', mount: 'tailings', pos: v3(-76, 1.2, 66), web: 'h', webYaw: 0.9, pir: true },
  { id: 'S24', mount: 'road', pos: v3(122, 0.6, -28), web: 'h', webYaw: 0.2, pir: true },
];

export const GATEWAYS: GatewaySpec[] = [
  {
    id: 'A1',
    name: 'Anchor A1',
    disguise: 'Rusted sheave-wheel housing on the headframe crown',
    pos: v3(0, HEADFRAME_HEIGHT + 1.5, 0),
    heightGainDb: 12,
  },
  {
    id: 'A2',
    name: 'Anchor A2',
    disguise: 'Solar bird-box on a weathered power pole',
    pos: v3(46, 7, -62),
    heightGainDb: 7,
  },
];

export const PATHS: Record<'P1' | 'P2', Vec3[]> = {
  // From the informal settlement (south-west) through the fence gap at 225°.
  P1: [v3(-172, 0, -152), v3(-122, 0, -120), v3(-96, 0, -101), v3(-63, 0, -63), v3(-39, 0, -39), v3(-12, 0, -10), v3(-2.5, 0, -2.5)],
  // From the south across the veld through the gap at 90°.
  P2: [v3(-22, 0, 182), v3(-9, 0, 112), v3(-3, 0, 56), v3(-1, 0, 9), v3(-1.5, 0, 2.5)],
};

export const ROAD: Vec3[] = [v3(240, 0, -46), v3(160, 0, -40), v3(100, 0, -30), v3(58, 0, -18), v3(34, 0, -8)];

/** Underground routes from the shaft station on each level to its working face. */
export const FACES: { level: number; route: Vec3[] }[] = [
  { level: 0, route: [v3(0, LEVELS[0], 0), v3(30, LEVELS[0], 5), v3(56, LEVELS[0], 9)] },
  { level: 0, route: [v3(0, LEVELS[0], 0), v3(-28, LEVELS[0], -8), v3(-52, LEVELS[0], -13)] },
  { level: 1, route: [v3(0, LEVELS[1], 0), v3(3, LEVELS[1], -36), v3(6, LEVELS[1], -70)] },
  { level: 1, route: [v3(0, LEVELS[1], 0), v3(-6, LEVELS[1], 32), v3(-11, LEVELS[1], 60)] },
  { level: 2, route: [v3(0, LEVELS[2], 0), v3(36, LEVELS[2], -14), v3(70, LEVELS[2], -30)] },
];

export const SETTLEMENT = v3(-178, 0, -160);
export const TAILINGS = { pos: v3(-112, 0, 96), radius: 46, height: 16 };
export const RUINS = [
  { id: 'winder', pos: v3(22, 0, 10), size: v3(14, 10, 8) },
  { id: 'change-house', pos: v3(-30, 0, 25), size: v3(12, 6, 9) },
];
