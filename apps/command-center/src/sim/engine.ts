/**
 * Site digital-twin simulation engine (pure TypeScript, no rendering).
 *
 * Pipeline per 4-second window, exactly as deployed:
 *   agents → seismic impacts → propagation to each S.P.I.D.E.R. node → STA/LTA trigger →
 *   edge classifier (sampled from the trained model's confusion matrix) → SilkNet packet →
 *   multi-hop ETX routing with ACK/retry → anchor gateway → SOC Bayesian fusion + TDOA → alert.
 *
 * The renderer reads `state` every frame; UI panels read `snapshot()` a few times a second.
 */
import { EvidenceFuser } from './fusion';
import {
  dist2,
  dist3,
  FACES,
  GATEWAYS,
  LEVELS,
  NODES,
  PATHS,
  ROAD,
  v3,
  type Mount,
  type Vec3,
} from './layout';
import { pathLossDb, phi, sensitivityDbm, timeOnAir } from './lora';
import type { ClassifierProfile } from './profile';
import { hash32, Rng } from './rng';
import type { Scenario, ScenarioEvent } from './scenarios';
import { multilaterate } from './tdoa';

export const WINDOW_S = 4;
const TRIGGER_DB = 12;
const BASE_NOISE = 18;
const SF = 9;
const PAYLOAD_BYTES = 32; // SilkNet v1 detection frame (protocol/SILKNET.md)
const TOA = timeOnAir(PAYLOAD_BYTES, SF);
const SENS = sensitivityDbm(SF);
const TX_DBM = 14;
const NODE_ANT_DBI = -8; // concealed spiral "web" antenna is inefficient
const EXCESS_LOSS_DB = 22; // near-ground Fresnel obstruction + vegetation
const PL_EXP = 3.6;
const MAX_RETRIES = 3;
const DUTY_CYCLE = 0.01;
const HEARTBEAT_S = 300;
const ALERT_P = 0.9;
const CRITICAL_P = 0.97;
/** Consecutive fused windows above threshold required before an alert (k-of-k persistence). */
const PERSISTENCE_WINDOWS = 2;
/** Radius around the collar covered by the sensor field (outermost spiders sit ~145 m out). */
const MONITORED_RADIUS = 200;

export type SeismicClass = 'background' | 'footsteps' | 'digging' | 'machinery' | 'vehicle' | 'animal' | 'blast';
export type AgentKind = 'intruder' | 'crew' | 'jackal' | 'cattle' | 'vehicle' | 'responder';
type AgentMode = 'walk' | 'detour' | 'tamper' | 'descend' | 'tunnel' | 'work' | 'egress' | 'ascend' | 'park' | 'leave' | 'gone';

export interface NodeState {
  id: string;
  mount: Mount;
  pos: Vec3;
  pir: boolean;
  status: 'ok' | 'triggered' | 'tampered';
  battery: number;
  parent: string | null;
  hops: number;
  etx: number;
  linkPrr: number;
  rssi: number;
  snrDb: number;
  lastClass: string;
  lastPThreat: number;
  detections: number;
  airtimeHour: number;
  hourStart: number;
  flashUntil: number;
}

export interface GatewayState {
  id: string;
  name: string;
  disguise: string;
  pos: Vec3;
  heightGainDb: number;
  jammed: boolean;
  received: number;
}

export interface AgentState {
  id: string;
  kind: AgentKind;
  pos: Vec3;
  heading: number;
  mode: AgentMode;
  underground: boolean;
  friendly: boolean;
}

interface Agent extends AgentState {
  route: Vec3[];
  idx: number;
  speed: number;
  stepEvery: number;
  stepAcc: number;
  a0: number;
  f0: number;
  cls: SeismicClass;
  workAcc: number;
  workEvery: number;
  face: Vec3[] | null;
  tamperNode: string | null;
  waitUntil: number;
  lastRipple: number;
}

interface Impact {
  t: number;
  pos: Vec3;
  a0: number;
  f0: number;
  cls: SeismicClass;
  underground: boolean;
  friendly: boolean;
}

export interface RippleEvent {
  id: number;
  t: number;
  pos: Vec3;
  strength: number;
  cls: SeismicClass;
  underground: boolean;
}

export interface HopEvent {
  id: number;
  t: number;
  from: string;
  to: string;
  kind: Report['kind'];
  ok: boolean;
}

export interface Report {
  id: number;
  kind: 'seismic' | 'benign' | 'pir' | 'tamper' | 'heartbeat' | 'jam';
  node: string;
  window: number;
  cls: string;
  pThreat: number;
  arrival: number;
  snrDb: number;
  friendly: boolean;
  born: number;
  hops: number;
}

interface InFlight {
  report: Report;
  at: string;
  tries: number;
  doneAt: number;
  to: string;
}

export interface Fix {
  id: number;
  t: number;
  x: number;
  z: number;
  semiMajor: number;
  semiMinor: number;
  angle: number;
  n: number;
  cls: string;
  underground: boolean;
}

export interface LogEntry {
  id: number;
  t: number;
  level: 'info' | 'net' | 'detect' | 'warn' | 'alert' | 'ok';
  msg: string;
}

export interface AlertInfo {
  id: string;
  status: 'raised' | 'acknowledged' | 'dispatched' | 'resolved';
  level: 'high' | 'critical';
  raisedAt: number;
  ackAt: number | null;
  dispatchedAt: number | null;
  resolvedAt: number | null;
  peak: number;
  reason: string;
  tamper: boolean;
  jamming: boolean;
}

export interface Metrics {
  packetsGenerated: number;
  packetsDelivered: number;
  packetsLost: number;
  hopSum: number;
  latencySum: number;
  reports: number;
  threatReports: number;
  benignReports: number;
  falseAlarms: number;
  alertsRaised: number;
  onset: number | null;
  detectionLatency: number | null;
  fixes: number;
  suppressedFriendly: number;
  rerouted: number;
}

export interface SimOptions {
  scenario: Scenario;
  prior: number;
  profile: ClassifierProfile;
  seed?: number;
}

export interface SimState {
  t: number;
  clock: number;
  nodes: NodeState[];
  gateways: GatewayState[];
  agents: AgentState[];
  ripples: RippleEvent[];
  hops: HopEvent[];
  fixes: Fix[];
  posterior: number;
  history: { t: number; p: number; reports: number }[];
  alert: AlertInfo | null;
  alertHistory: AlertInfo[];
  log: LogEntry[];
  metrics: Metrics;
  noiseRms: number;
  finished: boolean;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export class SiteSimulation {
  readonly scenario: Scenario;
  readonly profile: ClassifierProfile;
  readonly prior: number;
  state: SimState;

  private rng: Rng;
  private agents: Agent[] = [];
  private impacts: Impact[] = [];
  private inflight: InFlight[] = [];
  private queue: ScenarioEvent[];
  private fuser: EvidenceFuser;
  private seq = 1;
  private nextWindow = WINDOW_S;
  private nextHistory = 0;
  private nextHeartbeat = new Map<string, number>();
  private windowReports = new Map<number, Report[]>();
  private evaluatedWindows = new Set<number>();
  private consecutiveHigh = 0;
  private forceRaise = false;
  private generatorOn = false;
  private wind = { until: -1, strength: 0 };
  private deadLinks = new Set<string>();
  private reportsSinceHistory = 0;
  private lowSince: number | null = null;
  private respondersArrived = false;
  private jamLogged = new Set<string>();

  constructor(opts: SimOptions) {
    this.scenario = opts.scenario;
    this.profile = opts.profile;
    this.prior = opts.prior;
    this.rng = new Rng(opts.seed ?? 20260717);
    this.queue = [...opts.scenario.events].sort((a, b) => a.at - b.at);
    this.fuser = new EvidenceFuser(opts.prior, {
      seismic: { detectionRate: opts.profile.detectionRate, falseAlarmRate: opts.profile.falseAlarmRate },
      pir: { detectionRate: 0.7, falseAlarmRate: 0.05 },
      acoustic: { detectionRate: 0.75, falseAlarmRate: 0.04 },
      tamper: { detectionRate: 0.9, falseAlarmRate: 0.005 },
      satellite: { detectionRate: 0.55, falseAlarmRate: 0.08 },
    });

    const nodes: NodeState[] = NODES.map((n) => ({
      id: n.id,
      mount: n.mount,
      pos: n.pos,
      pir: n.pir,
      status: 'ok',
      battery: 78 + (hash32(n.id) % 22),
      parent: null,
      hops: 0,
      etx: Infinity,
      linkPrr: 0,
      rssi: -140,
      snrDb: 0,
      lastClass: '—',
      lastPThreat: 0,
      detections: 0,
      airtimeHour: 0,
      hourStart: 0,
      flashUntil: 0,
    }));
    for (const n of nodes) this.nextHeartbeat.set(n.id, this.rng.uniform(5, HEARTBEAT_S));

    this.state = {
      t: 0,
      clock: opts.scenario.clockStart,
      nodes,
      gateways: GATEWAYS.map((g) => ({ ...g, jammed: false, received: 0 })),
      agents: [],
      ripples: [],
      hops: [],
      fixes: [],
      posterior: opts.prior,
      history: [],
      alert: null,
      alertHistory: [],
      log: [],
      metrics: {
        packetsGenerated: 0,
        packetsDelivered: 0,
        packetsLost: 0,
        hopSum: 0,
        latencySum: 0,
        reports: 0,
        threatReports: 0,
        benignReports: 0,
        falseAlarms: 0,
        alertsRaised: 0,
        onset: null,
        detectionLatency: null,
        fixes: 0,
        suppressedFriendly: 0,
        rerouted: 0,
      },
      noiseRms: BASE_NOISE,
      finished: false,
    };
    this.rebuildTree();
    this.log('info', `Scenario "${opts.scenario.name}" loaded. Site prior P(intrusion) = ${(opts.prior * 100).toFixed(1)}%.`);
    const parents = nodes.filter((n) => n.parent).length;
    this.log('net', `SilkNet formed: ${parents}/${nodes.length} nodes routed, SF${SF}, ToA ${(TOA * 1000).toFixed(0)} ms.`);
  }

  // ------------------------------------------------------------------ public API

  step(dt: number): void {
    if (this.state.finished) return;
    const maxStep = 0.1;
    let remaining = dt;
    while (remaining > 1e-9) {
      const h = Math.min(maxStep, remaining);
      this.tick(h);
      remaining -= h;
      if (this.state.finished) break;
    }
  }

  snapshot(): SimState {
    const s = this.state;
    return {
      ...s,
      nodes: s.nodes.map((n) => ({ ...n })),
      gateways: s.gateways.map((g) => ({ ...g })),
      agents: s.agents.map((a) => ({ ...a, pos: { ...a.pos } })),
      history: s.history.slice(),
      log: s.log.slice(-120),
      alert: s.alert ? { ...s.alert } : null,
      alertHistory: s.alertHistory.slice(),
      metrics: { ...s.metrics },
      fixes: s.fixes.slice(-12),
    };
  }

  // ------------------------------------------------------------------ core loop

  private tick(dt: number): void {
    const s = this.state;
    s.t += dt;
    s.clock = this.scenario.clockStart + s.t;

    while (this.queue.length && this.queue[0].at <= s.t) this.apply(this.queue.shift()!);

    s.noiseRms = this.noiseAt(s.t);
    this.updateAgents(dt);
    this.updateMesh();
    this.flushWindows();

    while (s.t >= this.nextWindow) {
      this.senseWindow(this.nextWindow);
      this.nextWindow += WINDOW_S;
    }
    for (const n of s.nodes) {
      if (n.status === 'tampered') continue;
      if (s.t >= (this.nextHeartbeat.get(n.id) ?? Infinity)) {
        this.nextHeartbeat.set(n.id, s.t + HEARTBEAT_S);
        this.send(this.makeReport('heartbeat', n.id, 0, 'heartbeat', 0, 0, 0, false));
      }
    }

    const p = this.fuser.probabilityAt(s.t);
    s.posterior = p;
    this.updateAlert(p);

    if (s.t >= this.nextHistory) {
      s.history.push({ t: s.t, p, reports: this.reportsSinceHistory });
      if (s.history.length > 900) s.history.shift();
      this.reportsSinceHistory = 0;
      this.nextHistory = s.t + 2;
    }
    // Bound visual queues.
    const cutoff = s.t - 30;
    if (s.ripples.length > 400) s.ripples = s.ripples.filter((r) => r.t > cutoff).slice(-250);
    if (s.hops.length > 400) s.hops = s.hops.filter((h) => h.t > cutoff).slice(-250);
    if (this.impacts.length > 600) this.impacts = this.impacts.filter((i) => i.t > s.t - 2 * WINDOW_S);

    if (s.t >= this.scenario.durationS) {
      s.finished = true;
      this.log('info', 'Scenario complete.');
    }
  }

  // ------------------------------------------------------------------ scenario events

  private apply(ev: ScenarioEvent): void {
    switch (ev.type) {
      case 'intruders':
        // Staggered group: each person starts walking `spacing` seconds after the previous one.
        for (let i = 0; i < ev.count; i++) {
          this.spawnIntruder(ev.path, ev.at + i * ev.spacing, i === 0 ? ev.tamperNode ?? null : null);
        }
        break;
      case 'undergroundCrew':
        for (let i = 0; i < ev.count; i++) this.spawnCrew(i);
        if (this.state.metrics.onset === null) this.state.metrics.onset = this.state.t;
        break;
      case 'jackals':
        for (let i = 0; i < ev.count; i++) this.spawnWanderer('jackal');
        break;
      case 'cattle':
        for (let i = 0; i < ev.count; i++) this.spawnWanderer('cattle');
        break;
      case 'vehicle':
        this.spawnVehicle(false);
        break;
      case 'generator':
        this.generatorOn = ev.on;
        break;
      case 'blast': {
        const face = FACES.find((f) => f.level === ev.level) ?? FACES[0];
        const pos = face.route[face.route.length - 1];
        this.addImpact({ t: this.state.t, pos, a0: 900_000, f0: 14, cls: 'blast', underground: true, friendly: false });
        this.ripple(pos, 1, 'blast', true);
        if (this.state.metrics.onset === null) this.state.metrics.onset = this.state.t;
        break;
      }
      case 'jam': {
        const g = this.state.gateways.find((x) => x.id === ev.gateway);
        if (g) g.jammed = ev.on;
        break;
      }
      case 'wind':
        this.wind = { until: this.state.t + ev.duration, strength: ev.strength };
        this.log('info', `Wind gusts rising (×${ev.strength.toFixed(1)} noise floor).`);
        break;
      case 'note':
        if (ev.text) this.log('info', ev.text);
        break;
    }
  }

  // ------------------------------------------------------------------ agents

  private baseAgent(kind: AgentKind, pos: Vec3): Agent {
    return {
      id: `${kind}-${this.seq++}`,
      kind,
      pos: { ...pos },
      heading: 0,
      mode: 'walk',
      underground: false,
      friendly: kind === 'responder',
      route: [],
      idx: 0,
      speed: 1.2,
      stepEvery: 0.5,
      stepAcc: this.rng.uniform(0, 0.5),
      a0: 1200,
      f0: 30,
      cls: 'footsteps',
      workAcc: 0,
      workEvery: 1.3,
      face: null,
      tamperNode: null,
      waitUntil: 0,
      lastRipple: -10,
    };
  }

  private spawnIntruder(path: 'P1' | 'P2', at: number, tamperNode: string | null): void {
    const route = PATHS[path].map((p) => ({ ...p, x: p.x + this.rng.normal(0, 1.2), z: p.z + this.rng.normal(0, 1.2) }));
    const a = this.baseAgent('intruder', route[0]);
    a.route = route;
    a.speed = this.rng.uniform(1.1, 1.5);
    a.stepEvery = 1 / this.rng.uniform(1.7, 2.2);
    a.a0 = this.rng.uniform(1000, 1500);
    a.f0 = this.rng.uniform(22, 40);
    a.face = FACES[this.rng.int(0, 1)].route;
    a.tamperNode = tamperNode;
    a.waitUntil = at; // delayed start for staggered groups
    a.mode = 'walk';
    this.agents.push(a);
  }

  private spawnCrew(i: number): void {
    const face = FACES[2 + (i % 2)].route;
    const end = face[face.length - 1];
    const a = this.baseAgent('crew', v3(end.x + this.rng.normal(0, 2), end.y, end.z + this.rng.normal(0, 2)));
    a.mode = 'work';
    a.underground = true;
    a.face = face;
    a.cls = 'digging';
    a.a0 = 4500;
    a.f0 = 90;
    a.workEvery = this.rng.uniform(1.0, 1.6);
    this.agents.push(a);
  }

  private spawnWanderer(kind: 'jackal' | 'cattle'): void {
    const start =
      kind === 'jackal'
        ? v3(this.rng.uniform(-150, 150), 0, this.rng.uniform(-150, 150))
        : v3(this.rng.uniform(60, 110), 0, this.rng.uniform(20, 90));
    const a = this.baseAgent(kind, start);
    a.cls = 'animal';
    if (kind === 'jackal') {
      a.speed = 2.6;
      a.stepEvery = 0.25;
      a.a0 = 250;
      a.f0 = 60;
    } else {
      a.speed = 0.5;
      a.stepEvery = 0.5;
      a.a0 = 2000;
      a.f0 = 18;
    }
    a.route = [start, this.wanderTarget(kind)];
    a.idx = 1;
    this.agents.push(a);
  }

  private wanderTarget(kind: 'jackal' | 'cattle'): Vec3 {
    return kind === 'jackal'
      ? v3(this.rng.uniform(-160, 160), 0, this.rng.uniform(-160, 160))
      : v3(this.rng.uniform(50, 115), 0, this.rng.uniform(10, 95));
  }

  private spawnVehicle(responder: boolean): void {
    const a = this.baseAgent(responder ? 'responder' : 'vehicle', ROAD[0]);
    a.route = responder ? [...ROAD, v3(10, 0, -14)] : [...ROAD];
    a.idx = 1;
    a.speed = responder ? 11 : 7;
    a.stepEvery = 0.25;
    a.a0 = 1600;
    a.f0 = 20;
    a.cls = 'vehicle';
    this.agents.push(a);
    this.log(responder ? 'ok' : 'info', responder ? 'Response vehicle entering site (blue-force beacon active).' : 'Unidentified vehicle approaching on the access road.');
  }

  private updateAgents(dt: number): void {
    const s = this.state;
    for (const a of this.agents) {
      if (a.mode === 'gone') continue;
      if (s.t < a.waitUntil) {
        // Waiting: staggered start, grazing pause, idling vehicle, or tampering with a node.
        this.emitIdle(a, dt);
        continue;
      }
      switch (a.mode) {
        case 'walk':
        case 'detour':
        case 'egress':
        case 'leave':
        case 'tunnel':
          this.moveAlong(a, dt);
          break;
        case 'tamper':
          this.finishTamper(a);
          break;
        case 'descend':
        case 'ascend': {
          const target = a.mode === 'descend' ? a.face?.[0].y ?? LEVELS[0] : 0;
          const dir = Math.sign(target - a.pos.y);
          a.pos.y += dir * Math.min(Math.abs(target - a.pos.y), 1.6 * dt);
          a.underground = a.pos.y < -1;
          if (Math.abs(a.pos.y - target) < 0.05) {
            if (a.mode === 'descend' && a.face) {
              a.mode = 'tunnel';
              a.route = a.face;
              a.idx = 1;
              a.speed = 0.9;
            } else {
              a.mode = 'leave';
              a.route = [v3(0, 0, -2), v3(8, 0, -12)];
              a.idx = 0;
              a.speed = 1.2;
            }
          }
          break;
        }
        case 'work':
          a.workAcc += dt;
          if (a.workAcc >= a.workEvery) {
            a.workAcc = 0;
            a.workEvery = this.rng.uniform(1.0, 1.6);
            this.addImpact({ t: s.t, pos: { ...a.pos }, a0: 4500 * this.rng.uniform(0.7, 1.3), f0: 90, cls: 'digging', underground: true, friendly: false });
            if (s.t - a.lastRipple > 3) {
              this.ripple(a.pos, 0.35, 'digging', true);
              a.lastRipple = s.t;
            }
          }
          if (this.generatorOn && this.rng.next() < dt * 2) {
            this.addImpact({ t: s.t, pos: v3(0, LEVELS[0], 0), a0: 2500, f0: 35, cls: 'machinery', underground: true, friendly: false });
          }
          break;
        case 'park':
          this.emitIdle(a, dt);
          if (s.t >= a.waitUntil) {
            if (a.kind === 'responder') {
              a.waitUntil = Infinity;
            } else {
              a.mode = 'leave';
              a.route = [...ROAD].reverse();
              a.idx = 0;
            }
          }
          break;
      }
    }
    this.agents = this.agents.filter((a) => a.mode !== 'gone');
    s.agents = this.agents;
    if (s.metrics.onset === null) {
      // Ground truth "intrusion onset": a person has started moving inside the monitored footprint.
      const inside = this.agents.find(
        (a) => a.kind === 'intruder' && s.t >= a.waitUntil && dist2(a.pos, v3(0, 0, 0)) < MONITORED_RADIUS,
      );
      if (inside) s.metrics.onset = s.t;
    }
  }

  private emitIdle(a: Agent, dt: number): void {
    if (a.kind !== 'vehicle' && a.kind !== 'responder') return;
    a.stepAcc += dt;
    if (a.stepAcc >= 0.6) {
      a.stepAcc = 0;
      this.addImpact({ t: this.state.t, pos: { ...a.pos }, a0: 500, f0: 22, cls: 'vehicle', underground: false, friendly: a.friendly });
    }
  }

  private moveAlong(a: Agent, dt: number): void {
    const target = a.route[a.idx];
    if (!target) {
      this.arrive(a);
      return;
    }
    const dx = target.x - a.pos.x;
    const dy = target.y - a.pos.y;
    const dz = target.z - a.pos.z;
    const d = Math.hypot(dx, dy, dz);
    const stepLen = a.speed * dt;
    if (d <= stepLen) {
      a.pos = { ...target };
      a.idx += 1;
      if (a.idx >= a.route.length) this.arrive(a);
    } else {
      a.pos.x += (dx / d) * stepLen;
      a.pos.y += (dy / d) * stepLen;
      a.pos.z += (dz / d) * stepLen;
      a.heading = Math.atan2(dx, dz);
    }
    if (a.mode === 'walk' && a.tamperNode && a.kind === 'intruder') {
      const node = this.state.nodes.find((n) => n.id === a.tamperNode);
      if (node && node.status !== 'tampered' && dist2(a.pos, node.pos) < 30) {
        a.mode = 'detour';
        a.route = [{ ...node.pos, y: 0 }, ...a.route.slice(a.idx)];
        a.idx = 0;
      }
    }
    if (a.mode === 'detour' && a.tamperNode) {
      const node = this.state.nodes.find((n) => n.id === a.tamperNode);
      if (node && dist2(a.pos, node.pos) < 1.5) {
        a.mode = 'tamper';
        a.waitUntil = this.state.t + 6;
      }
    }
    // Footsteps / wheels.
    if (!a.underground) {
      a.stepAcc += dt;
      if (a.stepAcc >= a.stepEvery) {
        a.stepAcc -= a.stepEvery;
        this.addImpact({
          t: this.state.t,
          pos: { ...a.pos, y: 0 },
          a0: a.a0 * this.rng.uniform(0.8, 1.2),
          f0: a.f0,
          cls: a.cls,
          underground: false,
          friendly: a.friendly,
        });
        if (this.state.t - a.lastRipple > (a.kind === 'vehicle' || a.kind === 'responder' ? 1.2 : 1.8)) {
          this.ripple(a.pos, a.kind === 'jackal' ? 0.15 : a.kind === 'cattle' ? 0.45 : 0.3, a.cls, false);
          a.lastRipple = this.state.t;
        }
      }
    }
  }

  private finishTamper(a: Agent): void {
    if (this.state.t < a.waitUntil) return;
    const node = this.state.nodes.find((n) => n.id === a.tamperNode);
    if (node && node.status !== 'tampered') {
      // Accelerometer detects removal → signed last-gasp frame, then the node is gone.
      this.send(this.makeReport('tamper', node.id, this.state.t, 'tamper', 1, this.state.t, 40, false));
      node.status = 'tampered';
      node.flashUntil = this.state.t + 4;
      this.log('warn', `${node.id}: accelerometer tamper event — last-gasp frame signed and sent.`);
      this.deadLinks.add(node.id);
    }
    a.tamperNode = null;
    a.mode = 'walk';
    a.waitUntil = 0;
  }

  private arrive(a: Agent): void {
    switch (a.kind) {
      case 'intruder':
      case 'crew':
        if (a.mode === 'walk' || a.mode === 'detour') {
          a.mode = 'descend';
          this.log('detect', 'Ground truth: a person has reached the shaft collar and is descending.');
        } else if (a.mode === 'tunnel') {
          a.mode = 'work';
          a.underground = true;
        } else if (a.mode === 'egress') {
          a.mode = 'ascend';
        } else if (a.mode === 'leave') {
          a.mode = 'gone';
        }
        break;
      case 'jackal':
      case 'cattle':
        a.route = [{ ...a.pos }, this.wanderTarget(a.kind)];
        a.idx = 1;
        if (a.kind === 'cattle') a.waitUntil = this.state.t + this.rng.uniform(5, 30);
        break;
      case 'vehicle':
        if (a.mode === 'leave') a.mode = 'gone';
        else {
          a.mode = 'park';
          a.waitUntil = this.state.t + 120;
          this.log('info', 'Vehicle stopped near the winder-house ruin, engine idling.');
        }
        break;
      case 'responder':
        a.mode = 'park';
        a.waitUntil = Infinity;
        if (!this.respondersArrived) {
          this.respondersArrived = true;
          this.log('ok', 'Responders on site. Safe-egress protocol: Mine Rescue Services manage the shaft; nobody is pursued underground.');
          for (const x of this.agents) {
            if ((x.kind === 'intruder' || x.kind === 'crew') && x.mode !== 'gone') {
              if (x.underground) {
                const station = x.face?.[0] ?? v3(0, LEVELS[0], 0);
                x.mode = 'egress';
                x.route = [station];
                x.idx = 0;
                x.speed = 0.8;
              } else {
                x.mode = 'leave';
                x.route = [v3(8, 0, -12)];
                x.idx = 0;
              }
            }
          }
          this.generatorOn = false;
        }
        break;
      default:
        a.mode = 'gone';
    }
    if ((a.kind === 'intruder' || a.kind === 'crew') && a.mode === 'gone') {
      this.log('ok', 'Person brought safely to surface and handed to SAPS.');
    }
  }

  // ------------------------------------------------------------------ physics

  private addImpact(i: Impact): void {
    this.impacts.push(i);
  }

  private ripple(pos: Vec3, strength: number, cls: SeismicClass, underground: boolean): void {
    this.state.ripples.push({ id: this.seq++, t: this.state.t, pos: { ...pos }, strength, cls, underground });
  }

  private noiseAt(t: number): number {
    const gust = t < this.wind.until ? this.wind.strength * (0.6 + 0.4 * Math.sin(t / 3.1)) : 1 + 0.15 * Math.sin(t / 41);
    return BASE_NOISE * gust;
  }

  /** Received peak amplitude (ADC counts) and first-arrival time at a node. */
  private received(imp: Impact, node: NodeState): { amp: number; arrival: number } {
    const r = Math.max(dist3(imp.pos, node.pos), 1);
    let amp: number;
    let v: number;
    if (imp.underground) {
      // Body wave through competent rock: spherical spreading 1/r, Q≈60, v≈2500 m/s.
      const alpha = (Math.PI * imp.f0) / (60 * 2500);
      amp = (imp.a0 / r) * Math.exp(-alpha * r);
      v = 2500;
      if (node.mount === 'headframe' || node.mount === 'collar') amp *= 2.0; // steel headframe & collar couple to the shaft
    } else {
      // Surface Rayleigh wave in soil: cylindrical spreading r^-½, Q≈20, v≈300 m/s.
      const alpha = (Math.PI * imp.f0) / (20 * 300);
      amp = (imp.a0 / Math.sqrt(r)) * Math.exp(-alpha * r);
      v = 300;
      if (node.mount === 'headframe') amp *= 0.4; // elevated on steel, poorly coupled to the ground
    }
    return { amp, arrival: imp.t + r / v };
  }

  private senseWindow(tEnd: number): void {
    const s = this.state;
    const tStart = tEnd - WINDOW_S;
    const win = this.impacts.filter((i) => i.t >= tStart && i.t < tEnd);
    const noise = this.noiseAt(tEnd);
    const thr = this.profile.threshold;

    for (const node of s.nodes) {
      if (node.status === 'tampered') continue;
      if (node.status === 'triggered' && s.t > node.flashUntil) node.status = 'ok';
      let best: { amp: number; arrival: number; cls: SeismicClass; friendly: boolean } | null = null;
      for (const imp of win) {
        const r = this.received(imp, node);
        if (!best || r.amp > best.amp) best = { ...r, cls: imp.cls, friendly: imp.friendly };
      }
      let snr = best ? 20 * Math.log10(Math.max(best.amp, 1e-6) / noise) : -40;
      let trueIdx: number | null = null;
      if (best && snr >= TRIGGER_DB) {
        // Weak triggers often look like background to the classifier.
        const pClear = 1 / (1 + Math.exp(-(snr - 16) / 3));
        trueIdx = this.rng.next() < pClear ? this.profile.classes.indexOf(best.cls) : 0;
      } else if (this.rng.next() < 0.004 * (noise / BASE_NOISE) ** 2) {
        // Spurious STA/LTA trigger on a noise burst (wind, settling grit): just above threshold.
        trueIdx = 0;
        best = { amp: noise * 10 ** (TRIGGER_DB / 20) * this.rng.uniform(1, 1.3), arrival: tEnd - this.rng.uniform(0, WINDOW_S), cls: 'background', friendly: false };
        snr = 20 * Math.log10(best.amp / noise);
      }
      node.snrDb = snr;
      if (trueIdx === null || !best) continue;

      const pred = this.rng.categorical(this.profile.confusion[Math.max(trueIdx, 0)]);
      const isThreat = this.profile.threat.has(pred);
      const strength = Math.min(1, Math.max(0, (snr - 6) / 24));
      const pThreat = isThreat ? thr + (1 - thr) * Math.min(0.99, 0.3 + 0.7 * strength * this.rng.uniform(0.7, 1)) : this.rng.uniform(0.01, thr * 0.8);
      node.lastClass = this.profile.classes[pred];
      node.lastPThreat = pThreat;
      node.status = 'triggered';
      node.flashUntil = s.t + 1.5;
      // Blue-force tracking: responders carry a beacon, so their vibrations are tagged friendly.
      const friendly = best.friendly;
      const arrival = best.arrival + this.rng.normal(0, 0.0008); // GPS-PPS disciplined timestamp ±0.8 ms
      if (isThreat) {
        node.detections += 1;
      }
      this.send(this.makeReport(isThreat ? 'seismic' : 'benign', node.id, tEnd, node.lastClass, pThreat, arrival, snr, friendly));
    }

    // PIR: dual-element, pet-immune optics (ignore animals < ~25 kg). Fires on people, cattle and
    // vehicles within ~12 m; jackals only rarely (it still cannot tell cattle from people).
    for (const node of s.nodes) {
      if (!node.pir || node.status === 'tampered') continue;
      for (const a of this.agents) {
        if (a.underground || a.mode === 'gone') continue;
        const d = dist2(a.pos, node.pos);
        const p = a.kind === 'jackal' ? 0.03 : 0.7;
        if (d < 12 && this.rng.next() < p) {
          this.send(this.makeReport('pir', node.id, tEnd, 'pir', 1, tEnd, 0, a.friendly));
          break;
        }
      }
    }

    this.impacts = this.impacts.filter((i) => i.t >= tEnd);

    // Jamming: nodes parented to a jammed anchor see the noise floor jump.
    for (const g of s.gateways) {
      if (g.jammed && !this.jamLogged.has(g.id)) {
        this.jamLogged.add(g.id);
        this.log('warn', `RF noise floor +27 dB around ${g.id} on 868 MHz — suspected deliberate jamming.`);
        this.deadLinks.add(g.id);
        this.rebuildTree(true);
        this.fuser.update(s.t, 'tamper', true, 0.35);
        if (s.alert) s.alert.jamming = true;
      }
    }
  }

  // ------------------------------------------------------------------ SilkNet mesh

  private linkRx(a: { pos: Vec3 }, b: { pos: Vec3; heightGainDb?: number }, keyA: string, keyB: string): number {
    const d = Math.max(dist3(a.pos, b.pos), 1);
    const key = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
    const h = hash32(key);
    const shadow = ((h % 1000) / 1000 - 0.5) * 10; // deterministic ±5 dB shadowing per link
    return TX_DBM + 2 * NODE_ANT_DBI + (b.heightGainDb ?? 0) - pathLossDb(d, PL_EXP) - EXCESS_LOSS_DB - shadow;
  }

  private prr(rx: number): number {
    return phi((rx - SENS - 4) / 3);
  }

  private rebuildTree(announce = false): void {
    const s = this.state;
    const nodes = s.nodes.filter((n) => n.status !== 'tampered');
    const etx = new Map<string, number>();
    const hops = new Map<string, number>();
    for (const g of s.gateways) if (!g.jammed && !this.deadLinks.has(g.id)) {
      etx.set(g.id, 0);
      hops.set(g.id, 0);
    }
    const parent = new Map<string, string | null>();
    const prrOf = new Map<string, number>();
    for (const n of nodes) {
      etx.set(n.id, Infinity);
      parent.set(n.id, null);
    }
    for (let iter = 0; iter < nodes.length + 2; iter++) {
      let changed = false;
      for (const n of nodes) {
        const candidates: { id: string; rx: number }[] = [
          ...s.gateways
            .filter((g) => !g.jammed && !this.deadLinks.has(g.id))
            .map((g) => ({ id: g.id, rx: this.linkRx(n, g, n.id, g.id) })),
          ...nodes.filter((m) => m.id !== n.id).map((m) => ({ id: m.id, rx: this.linkRx(n, m, n.id, m.id) })),
        ];
        for (const c of candidates) {
          const base = etx.get(c.id) ?? Infinity;
          if (!Number.isFinite(base)) continue;
          const p = this.prr(c.rx);
          if (p < 0.2) continue;
          const cand = base + 1 / p;
          if (cand < (etx.get(n.id) ?? Infinity) - 1e-9) {
            etx.set(n.id, cand);
            parent.set(n.id, c.id);
            hops.set(n.id, (hops.get(c.id) ?? 0) + 1);
            prrOf.set(n.id, p);
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
    let rerouted = 0;
    for (const n of nodes) {
      const np = parent.get(n.id) ?? null;
      if (n.parent && np !== n.parent) rerouted += 1;
      n.parent = np;
      n.etx = etx.get(n.id) ?? Infinity;
      n.hops = hops.get(n.id) ?? 0;
      n.linkPrr = prrOf.get(n.id) ?? 0;
      const target = np ? s.gateways.find((g) => g.id === np) ?? s.nodes.find((m) => m.id === np) : null;
      n.rssi = target ? this.linkRx(n, target as { pos: Vec3; heightGainDb?: number }, n.id, target.id) : -140;
    }
    if (announce && rerouted) {
      s.metrics.rerouted += rerouted;
      const viaA2 = nodes.filter((n) => n.parent === 'A2').length;
      this.log('net', `SilkNet self-healed: ${rerouted} nodes re-parented (${viaA2} now via A2, max ${Math.max(...nodes.map((n) => n.hops))} hops).`);
    }
  }

  private makeReport(kind: Report['kind'], node: string, window: number, cls: string, pThreat: number, arrival: number, snrDb: number, friendly: boolean): Report {
    return { id: this.seq++, kind, node, window, cls, pThreat, arrival, snrDb, friendly, born: this.state.t, hops: 0 };
  }

  private send(report: Report): void {
    const node = this.state.nodes.find((n) => n.id === report.node);
    if (!node) return;
    this.state.metrics.packetsGenerated += 1;
    this.forward(report, node.id, 0);
  }

  private forward(report: Report, at: string, tries: number): void {
    const s = this.state;
    const node = s.nodes.find((n) => n.id === at);
    if (!node || !node.parent || (node.status === 'tampered' && report.kind !== 'tamper')) {
      s.metrics.packetsLost += 1;
      return;
    }
    // Duty-cycle accounting (rolling hour).
    if (s.t - node.hourStart >= 3600) {
      node.hourStart = s.t;
      node.airtimeHour = 0;
    }
    if (node.airtimeHour + TOA > DUTY_CYCLE * 3600 && report.kind === 'heartbeat') {
      s.metrics.packetsLost += 1;
      return; // heartbeats are shed first under duty-cycle pressure
    }
    node.airtimeHour += TOA;
    node.battery = Math.max(0, node.battery - 0.00002);
    const doneAt = s.t + TOA + this.rng.uniform(0.02, 0.15) + (tries > 0 ? this.rng.uniform(0.2, 1) * 2 ** tries : 0);
    this.inflight.push({ report, at, tries, doneAt, to: node.parent });
  }

  private updateMesh(): void {
    const s = this.state;
    const due = this.inflight.filter((f) => f.doneAt <= s.t);
    if (!due.length) return;
    this.inflight = this.inflight.filter((f) => f.doneAt > s.t);
    for (const f of due) {
      const from = s.nodes.find((n) => n.id === f.at)!;
      const gw = s.gateways.find((g) => g.id === f.to);
      const toNode = s.nodes.find((n) => n.id === f.to);
      const target = gw ?? toNode;
      let ok = false;
      if (target && !(gw && gw.jammed) && !(toNode && toNode.status === 'tampered')) {
        ok = this.rng.next() < this.prr(this.linkRx(from, target as { pos: Vec3; heightGainDb?: number }, from.id, target.id));
      }
      s.hops.push({ id: this.seq++, t: s.t, from: f.at, to: f.to, kind: f.report.kind, ok });
      if (ok) {
        f.report.hops += 1;
        if (gw) this.deliver(f.report, gw);
        else this.forward(f.report, f.to, 0);
      } else if (f.tries < MAX_RETRIES) {
        this.forward(f.report, f.at, f.tries + 1);
      } else {
        s.metrics.packetsLost += 1;
        if (gw?.jammed || toNode?.status === 'tampered') {
          this.deadLinks.add(f.to);
          this.rebuildTree(true);
        }
      }
    }
  }

  // ------------------------------------------------------------------ SOC fusion

  private deliver(r: Report, gw: GatewayState): void {
    const s = this.state;
    gw.received += 1;
    s.metrics.packetsDelivered += 1;
    s.metrics.hopSum += r.hops;
    s.metrics.latencySum += s.t - r.born + 0.18; // + LTE backhaul
    if (r.kind === 'heartbeat') return;
    s.metrics.reports += 1;
    this.reportsSinceHistory += 1;
    if (r.friendly) {
      s.metrics.suppressedFriendly += 1; // blue-force beacon: responders never raise alerts
      return;
    }
    if (r.kind === 'tamper') {
      // Tamper is unambiguous and signed: fused immediately and allowed to bypass persistence.
      this.fuser.update(s.t, 'tamper', true, 1);
      this.forceRaise = true;
      this.log('alert', `${r.node} ▸ TAMPER frame verified (Ed25519 signature OK). Node removed from mesh.`);
      this.rebuildTree(true);
      if (s.alert) s.alert.tamper = true;
      return;
    }
    if (r.kind === 'seismic') {
      s.metrics.threatReports += 1;
      this.log('detect', `${r.node} ▸ ${r.cls.toUpperCase()} p=${r.pThreat.toFixed(2)} SNR ${r.snrDb.toFixed(1)} dB (${r.hops} hop${r.hops > 1 ? 's' : ''})`);
    } else if (r.kind === 'benign') {
      s.metrics.benignReports += 1;
    }
    if (this.evaluatedWindows.has(r.window)) {
      // Straggler that arrived after its window was fused: applied alone, heavily discounted.
      this.fuser.addLogOdds(s.t, 0.3 * this.voteLlr(r, false));
      return;
    }
    const buf = this.windowReports.get(r.window) ?? [];
    buf.push(r);
    this.windowReports.set(r.window, buf);
  }

  /** Log-likelihood ratio contributed by one node's vote (Chair–Varshney weights). */
  private voteLlr(r: Report, corroborated: boolean): number {
    const m = this.fuser.models;
    const thr = this.profile.threshold;
    switch (r.kind) {
      case 'seismic': {
        const conf = 0.4 + 0.6 * Math.min(1, (r.pThreat - thr) / (1 - thr));
        return conf * Math.log(m.seismic.detectionRate / m.seismic.falseAlarmRate);
      }
      case 'benign':
        return Math.log((1 - m.seismic.detectionRate) / (1 - m.seismic.falseAlarmRate));
      case 'pir':
        // PIR cannot tell cattle from people: weak alone, strong when the same node's
        // seismic classifier also voted "threat" in the same window.
        return (corroborated ? 1 : 0.25) * Math.log(m.pir.detectionRate / m.pir.falseAlarmRate);
      default:
        return 0;
    }
  }

  /**
   * Decision fusion once per 4-second window (after a 2.5 s grace period for multi-hop
   * stragglers). Votes from nodes hearing the same source are correlated, so the summed
   * LLR is discounted by √n instead of being treated as n independent observations.
   */
  private flushWindows(): void {
    const s = this.state;
    for (const [w, reps] of this.windowReports) {
      if (s.t < w + 2.5) continue;
      this.windowReports.delete(w);
      this.evaluatedWindows.add(w);
      if (this.evaluatedWindows.size > 128) this.evaluatedWindows.delete(Math.min(...this.evaluatedWindows));

      // PIR sees warm bodies at the surface, so it can only corroborate a *gait* (footsteps) vote.
      const threatNodes = new Set(reps.filter((r) => r.kind === 'seismic' && r.cls === 'footsteps').map((r) => r.node));
      const seismic = reps.filter((r) => r.kind === 'seismic' || r.kind === 'benign');
      const pir = reps.filter((r) => r.kind === 'pir');
      let total = 0;
      if (seismic.length) total += seismic.reduce((acc, r) => acc + this.voteLlr(r, false), 0) / Math.sqrt(seismic.length);
      if (pir.length) total += pir.reduce((acc, r) => acc + this.voteLlr(r, threatNodes.has(r.node)), 0) / Math.sqrt(pir.length);
      if (total !== 0) this.fuser.addLogOdds(s.t, total);
      const corroborating = pir.filter((r) => threatNodes.has(r.node)).map((r) => r.node);
      if (corroborating.length) this.log('detect', `${corroborating.join(', ')} ▸ PIR corroborates seismic threat.`);

      // Persistence gate: an alert needs the posterior above threshold on consecutive windows.
      const p = this.fuser.probabilityAt(s.t);
      this.consecutiveHigh = p >= ALERT_P ? this.consecutiveHigh + 1 : 0;

      this.locate(reps.filter((r) => r.kind === 'seismic'));
    }
  }

  private locate(reps: Report[]): void {
    const s = this.state;
    const byNode = new Map<string, Report>();
    for (const r of reps) if (!byNode.has(r.node)) byNode.set(r.node, r);
    const list = [...byNode.values()];
    if (list.length < 3) return;
    const underground = list.some((r) => r.cls === 'digging' || r.cls === 'blast' || r.cls === 'machinery');
    const v = underground ? 2500 : 300;
    // Association: keep the largest cluster of mutually consistent arrival times.
    list.sort((a, b) => a.arrival - b.arrival);
    const span = underground ? 0.12 : 0.8;
    let bestSet: Report[] = [];
    for (let i = 0; i < list.length; i++) {
      const set = list.filter((r) => r.arrival >= list[i].arrival && r.arrival <= list[i].arrival + span);
      if (set.length > bestSet.length) bestSet = set;
    }
    if (bestSet.length < 3) return;
    const obs = bestSet.map((r) => {
      const n = s.nodes.find((x) => x.id === r.node)!;
      return { x: n.pos.x, z: n.pos.z, t: r.arrival };
    });
    const fix = multilaterate(obs, v, underground ? 0.0004 : 0.0015);
    if (!fix || !fix.converged || fix.rmsS > (underground ? 0.01 : 0.03) || Math.hypot(fix.x, fix.z) > 400) return;
    s.metrics.fixes += 1;
    s.fixes.push({
      id: this.seq++,
      t: s.t,
      x: fix.x,
      z: fix.z,
      semiMajor: Math.min(fix.semiMajor, 40),
      semiMinor: Math.min(fix.semiMinor, 40),
      angle: fix.angle,
      n: bestSet.length,
      cls: bestSet[0].cls,
      underground,
    });
    if (s.fixes.length > 40) s.fixes.shift();
    this.log('detect', `TDOA fix (${bestSet.length} nodes): ${underground ? 'epicentre' : 'source'} at E${fix.x.toFixed(0)} m, S${fix.z.toFixed(0)} m ±${fix.semiMajor.toFixed(1)} m`);
  }

  // ------------------------------------------------------------------ alerting

  private updateAlert(p: number): void {
    const s = this.state;
    const a = s.alert;
    if (!a && p >= ALERT_P && (this.consecutiveHigh >= PERSISTENCE_WINDOWS || this.forceRaise)) {
      this.forceRaise = false;
      const latest = s.log.filter((l) => l.level === 'detect').slice(-3).map((l) => l.msg.split('▸')[1]?.trim().split(' ')[0] ?? '');
      s.alert = {
        id: `ALR-${String(s.metrics.alertsRaised + 1).padStart(4, '0')}`,
        status: 'raised',
        level: p >= CRITICAL_P ? 'critical' : 'high',
        raisedAt: s.t,
        ackAt: null,
        dispatchedAt: null,
        resolvedAt: null,
        peak: p,
        reason: [...new Set(latest.filter(Boolean))].join(', ') || 'fused evidence',
        tamper: this.state.nodes.some((n) => n.status === 'tampered'),
        jamming: s.gateways.some((g) => g.jammed),
      };
      s.metrics.alertsRaised += 1;
      const isFalse = !this.scenario.hasThreat || s.metrics.onset === null;
      if (isFalse) s.metrics.falseAlarms += 1;
      else if (s.metrics.detectionLatency === null && s.metrics.onset !== null) s.metrics.detectionLatency = s.t - s.metrics.onset;
      this.log('alert', `${s.alert.id} RAISED — P(intrusion) ${(p * 100).toFixed(1)}%. Evidence signed and queued for the case service.`);
      return;
    }
    if (!a) return;
    a.peak = Math.max(a.peak, p);
    if (p >= CRITICAL_P) a.level = 'critical';
    if (a.status === 'raised' && s.t - a.raisedAt >= 20) {
      a.status = 'acknowledged';
      a.ackAt = s.t;
      this.log('ok', `${a.id} acknowledged by the duty analyst (SOC-KOSH).`);
    }
    if (a.status === 'acknowledged' && s.t - a.raisedAt >= 45) {
      a.status = 'dispatched';
      a.dispatchedAt = s.t;
      this.log('ok', `${a.id} dispatched: SAPS Vala Umgodi unit + Mine Rescue Services. ETA ~2 min (simulated).`);
      if (this.scenario.hasThreat) this.spawnVehicle(true);
    }
    if (p < 0.3) {
      this.lowSince ??= s.t;
      if (s.t - this.lowSince >= 120 && a.status !== 'raised') {
        a.status = 'resolved';
        a.resolvedAt = s.t;
        this.log('ok', `${a.id} resolved. Site recommended for shaft sealing (priority from RAI).`);
        s.alertHistory.push({ ...a });
        s.alert = null;
        this.lowSince = null;
      }
    } else {
      this.lowSince = null;
    }
  }

  private log(level: LogEntry['level'], msg: string): void {
    const s = this.state;
    s.log.push({ id: this.seq++, t: s.t, level, msg });
    if (s.log.length > 400) s.log.splice(0, s.log.length - 300);
  }
}

/** Map a mine's Residual Attraction Index to a prior intrusion probability for one night. */
export function priorFromRai(rai: number): number {
  return Math.min(0.35, Math.max(0.02, 0.02 + 0.33 * (rai / 100) ** 2));
}

export const SIM_CONSTANTS = { WINDOW_S, TRIGGER_DB, TOA, SENS, ALERT_P, lerp };
