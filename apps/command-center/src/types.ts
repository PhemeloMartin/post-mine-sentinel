export type Commodity =
  | 'gold'
  | 'diamonds'
  | 'pgm'
  | 'coal'
  | 'iron'
  | 'manganese'
  | 'copper'
  | 'zinc'
  | 'asbestos'
  | 'tin'
  | 'chrome';

export type MineStatus = 'operating' | 'restarted' | 'care_maintenance' | 'closed' | 'derelict' | 'rehabilitated';
export type RiskBand = 'low' | 'elevated' | 'high' | 'critical';
export type Confidence = 'high' | 'medium' | 'low' | 'modelled';

export interface Range {
  low: number;
  high: number;
  unit: string;
  confidence: Confidence;
}

export interface RiskFactors {
  commodity: number;
  residual: number;
  access: number;
  pressure: number;
  history: number;
}

export interface Mine {
  id: string;
  name: string;
  commodity: Commodity;
  secondary: string[];
  province: string;
  provinceName: string;
  locality: string;
  lat: number;
  lon: number;
  precisionM: number;
  field: string;
  method: string;
  opened: number | null;
  closed: number | null;
  status: MineStatus;
  datesConfidence: Confidence;
  maxDepthM: number | null;
  production: Range | null;
  residual: Range | null;
  illegalActivity: { reported: boolean; lastReportedYear: number | null };
  flooded: string | null;
  sealed: boolean;
  notes: string | null;
  risk: { rai: number; band: RiskBand; logit: number; factors: RiskFactors; contributions: RiskFactors };
}

export interface Hub {
  id: string;
  name: string;
  tier: number;
  lat: number;
  lon: number;
  role: string;
}

export interface Deployment {
  mineId: string;
  hub: string;
  spiders: number;
  anchors: number;
  backhaul: 'lte' | 'fibre' | 'leo_satellite';
  phase: number;
}

export interface SentinelNetwork {
  hubs: Hub[];
  backbone: { from: string; to: string; medium: string; capacityMbps: number }[];
  deployments: Deployment[];
}

export interface ProvinceShape {
  code: string;
  name: string;
  rings: [number, number][][];
}

export type Role = 'admin' | 'analyst' | 'field_officer' | 'auditor' | 'community_liaison';

export interface Session {
  username: string;
  displayName: string;
  role: Role;
  mode: 'demo' | 'live';
  token?: string;
}
