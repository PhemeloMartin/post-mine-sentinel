import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Bar as RBar, BarChart, CartesianGrid, Legend, Line as RLine, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Radio, ShieldCheck, Zap } from 'lucide-react';
import { Panel, Stat } from '@/components/ui';
import { NETWORK } from '@/data/registry';
import netsim from '@/data/netsim_results.json';
import { priorFromRai, SiteSimulation, type NodeState } from '@/sim/engine';
import { GATEWAYS } from '@/sim/layout';
import { linkBudget } from '@/sim/lora';
import { profileFromModelCard } from '@/sim/profile';
import { SCENARIO_BY_ID } from '@/sim/scenarios';
import { fmtNumber } from '@/lib/format';

/** Build the routing tree in a normal state and after anchor A1 is jammed. */
function computeTrees(): { normal: NodeState[]; jammed: NodeState[] } {
  const profile = profileFromModelCard('calibrated');
  const normal = new SiteSimulation({ scenario: SCENARIO_BY_ID.get('quiet-night')!, prior: priorFromRai(80), profile });
  const jam = new SiteSimulation({ scenario: SCENARIO_BY_ID.get('gateway-jam')!, prior: priorFromRai(80), profile });
  jam.step(70);
  return { normal: normal.state.nodes, jammed: jam.state.nodes };
}

const W = 520;
const H = 440;
const SCALE = 1.35;
const toSvg = (x: number, z: number) => [W / 2 + x * SCALE, H / 2 + z * SCALE] as const;

function Topology({ nodes, jammed }: { nodes: NodeState[]; jammed: boolean }) {
  const pos = new Map<string, readonly [number, number]>([...nodes.map((n) => [n.id, toSvg(n.pos.x, n.pos.z)] as const), ...GATEWAYS.map((g) => [g.id, toSvg(g.pos.x, g.pos.z)] as const)]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="SilkNet routing tree">
      <defs>
        <radialGradient id="bg" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#0c2a3d" />
          <stop offset="100%" stopColor="#03060d" />
        </radialGradient>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#67e8f9" />
        </marker>
      </defs>
      <rect width={W} height={H} fill="url(#bg)" rx="10" />
      {[55, 100, 150].map((r) => (
        <circle key={r} cx={W / 2} cy={H / 2} r={r * SCALE} fill="none" stroke="#164e63" strokeDasharray="3 5" />
      ))}
      <text x={W / 2 + 55 * SCALE + 3} y={H / 2 - 3} fill="#155e75" fontSize="9">
        fence 55 m
      </text>
      {nodes
        .filter((n) => n.parent)
        .map((n) => {
          const a = pos.get(n.id)!;
          const b = pos.get(n.parent!)!;
          const c = n.linkPrr > 0.9 ? '#22d3ee' : n.linkPrr > 0.6 ? '#facc15' : '#f97316';
          return <line key={n.id} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={c} strokeWidth={1.3} strokeOpacity={0.75} markerEnd="url(#arrow)" />;
        })}
      {GATEWAYS.map((g) => {
        const [x, y] = pos.get(g.id)!;
        const dead = jammed && g.id === 'A1';
        return (
          <g key={g.id}>
            <rect x={x - 9} y={y - 9} width={18} height={18} rx={3} fill={dead ? '#3b0a1a' : '#0e7490'} stroke={dead ? '#f43f5e' : '#67e8f9'} strokeWidth={1.5} />
            <text x={x} y={y + 3.5} textAnchor="middle" fill="#ecfeff" fontSize="9" fontWeight="700">
              {g.id}
            </text>
            {dead && (
              <text x={x} y={y - 13} textAnchor="middle" fill="#fb7185" fontSize="9">
                JAMMED
              </text>
            )}
          </g>
        );
      })}
      {nodes.map((n) => {
        const [x, y] = pos.get(n.id)!;
        const orphan = !n.parent;
        return (
          <g key={n.id}>
            <circle cx={x} cy={y} r={6} fill={orphan ? '#334155' : '#082f49'} stroke={orphan ? '#64748b' : n.hops > 1 ? '#facc15' : '#22d3ee'} strokeWidth={1.5} />
            <text x={x} y={y - 9} textAnchor="middle" fill="#94a3b8" fontSize="8">
              {n.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LinkBudgetCalculator() {
  const [sf, setSf] = useState(9);
  const [tx, setTx] = useState(14);
  const [gain, setGain] = useState(-8);
  const [exp, setExp] = useState(3.6);
  const [dist, setDist] = useState(120);
  const [payload, setPayload] = useState(32);
  const [duty, setDuty] = useState(0.01);
  const r = linkBudget({ distanceM: dist, sf, txDbm: tx, gainDbi: gain, exponent: exp, payloadBytes: payload, dutyCycle: duty, fadeMarginDb: 10 });
  const slider = (label: string, v: number, set: (n: number) => void, min: number, max: number, step: number, unit: string) => (
    <label className="block">
      <span className="hud-label flex justify-between">
        <span>{label}</span>
        <span className="font-mono text-cyan-200">
          {v}
          {unit}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(Number(e.target.value))} className="w-full" />
    </label>
  );
  return (
    <Panel title="Link budget calculator (LoRa 868 MHz)">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {slider('Spreading factor', sf, setSf, 7, 12, 1, '')}
        {slider('TX power', tx, setTx, 2, 22, 1, ' dBm')}
        {slider('Antenna gain (each end)', gain, setGain, -10, 6, 1, ' dBi')}
        {slider('Path-loss exponent n', exp, setExp, 2, 4.5, 0.1, '')}
        {slider('Distance', dist, setDist, 10, 2000, 10, ' m')}
        {slider('Payload', payload, setPayload, 8, 64, 1, ' B')}
      </div>
      <div className="mt-2 flex gap-1.5">
        {[0.01, 0.1].map((d) => (
          <button key={d} className={clsx('hud-btn', duty === d && 'hud-btn-active')} onClick={() => setDuty(d)}>
            {d * 100}% duty cycle
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat label="Path loss" value={`${r.pathLossDb.toFixed(1)} dB`} />
        <Stat label="RX power" value={`${r.rxDbm.toFixed(1)} dBm`} />
        <Stat label="Sensitivity" value={`${r.sensitivityDbm.toFixed(1)} dBm`} />
        <Stat label="Link margin" value={`${r.marginDb.toFixed(1)} dB`} tone={r.marginDb >= 10 ? 'green' : r.marginDb >= 0 ? 'amber' : 'red'} />
        <Stat label="Time on air" value={`${r.toaMs.toFixed(1)} ms`} />
        <Stat label="Max packets / h" value={fmtNumber(r.maxPacketsPerHour)} />
      </div>
      <div className="mt-2 text-[11px] text-slate-400">
        Range with 10 dB fade margin: <span className="font-mono text-cyan-200">{fmtNumber(r.maxRangeM)} m</span> (no near-ground excess loss).
      </div>
      <pre className="mt-2 overflow-x-auto rounded-md bg-slate-950/70 p-2 font-mono text-[10px] leading-relaxed text-slate-400">
        {`ToA  = (n_pre + 4.25)·T_sym + n_pay·T_sym,  T_sym = 2^SF / BW
S    = −174 + 10·log10(BW) + NF + SNR_min(SF)
PL(d)= FSPL(1 m) + 10·n·log10(d)
M    = P_tx + G_tx + G_rx − PL(d) − S`}
      </pre>
    </Panel>
  );
}

export function NetworkPage() {
  const trees = useMemo(computeTrees, []);
  const [jammed, setJammed] = useState(false);
  const nodes = jammed ? trees.jammed : trees.normal;
  const routed = nodes.filter((n) => n.parent).length;
  const maxHops = Math.max(...nodes.map((n) => n.hops));
  const e1 = netsim.e1_scalability.map((r) => ({ nodes: r.nodes, pdr: +(r.packet_delivery_ratio * 100).toFixed(2), p95: r.latency_p95_s, battery: r.battery_life_days }));
  const e3 = netsim.e3_resilience.map((r) => ({ name: `${r.gateways} anchor${r.gateways > 1 ? 's' : ''}`, pdr: +(r.packet_delivery_ratio * 100).toFixed(1) }));

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="grid gap-3 xl:grid-cols-[1.1fr_1fr]">
        <Panel
          title="SilkNet site mesh: ETX routing tree"
          actions={
            <button className={clsx('hud-btn', jammed && 'hud-btn-active')} onClick={() => setJammed(!jammed)} aria-pressed={jammed}>
              <Zap size={14} /> {jammed ? 'A1 jammed' : 'Simulate jamming of A1'}
            </button>
          }
        >
          <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
            <div className="aspect-[52/44]">
              <Topology nodes={nodes} jammed={jammed} />
            </div>
            <div className="space-y-3">
              <Stat label="Nodes routed" value={`${routed}/${nodes.length}`} tone={routed === nodes.length ? 'green' : 'amber'} />
              <Stat label="Max hop count" value={maxHops} />
              <Stat label="Via A2" value={nodes.filter((n) => n.parent === 'A2').length} />
              <p className="text-[11px] leading-relaxed text-slate-400">
                Parents are chosen to minimise expected transmissions (ETX = Σ 1/PRR). Link colour: <span className="text-cyan-300">PRR &gt; 0.9</span>,{' '}
                <span className="text-yellow-300">0.6–0.9</span>, <span className="text-orange-400">&lt; 0.6</span>. When A1 is jammed, nodes detect missing ACKs, mark the link dead and re-parent.
              </p>
            </div>
          </div>
        </Panel>
        <LinkBudgetCalculator />
        <Panel title="Python discrete-event simulator: scalability (E1)">
          <div className="h-56">
            <ResponsiveContainer>
              <LineChart data={e1} margin={{ top: 8, right: 16, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#1e293b" />
                <XAxis dataKey="nodes" tick={{ fill: '#94a3b8', fontSize: 10 }} label={{ value: 'nodes per site', fill: '#64748b', fontSize: 10, position: 'insideBottom', dy: 8 }} />
                <YAxis yAxisId="l" domain={[95, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis yAxisId="r" orientation="right" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: '#0b1220', border: '1px solid #164e63', fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <RLine yAxisId="l" dataKey="pdr" name="delivery %" stroke="#22d3ee" strokeWidth={2} isAnimationActive={false} />
                <RLine yAxisId="r" dataKey="battery" name="battery life (days)" stroke="#34d399" strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Resilience under jamming (E3)">
          <div className="grid grid-cols-[1fr_14rem] gap-3">
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={e3} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="#1e293b" />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: '#0b1220', border: '1px solid #164e63', fontSize: 11 }} />
                  <RBar dataKey="pdr" name="delivery % (12 h, jammed at 6 h)" fill="#22d3ee" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 text-[11px] text-slate-400">
              <p>
                <ShieldCheck size={13} className="mr-1 inline text-emerald-300" />
                Design decision (ADR-0004): every site gets <b className="text-slate-200">two physically separated anchors</b>. With one anchor, jamming halves delivery; with two, the mesh
                self-heals.
              </p>
              <p>
                <Radio size={13} className="mr-1 inline text-cyan-300" />
                Detection frames: 32 B (≈ 247 ms at SF9), AES-128-CCM (8-byte MIC), 32-bit frame counter with replay window; tamper & evidence frames additionally Ed25519-signed.
              </p>
            </div>
          </div>
        </Panel>
        <Panel title="National backbone (Sentinel's own network)" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Hub</th>
                  <th className="pr-3 font-medium">Tier</th>
                  <th className="pr-3 font-medium">Role</th>
                  <th className="pr-3 font-medium">Sites</th>
                  <th className="font-medium">Spiders</th>
                </tr>
              </thead>
              <tbody>
                {NETWORK.hubs.map((h) => {
                  const deps = NETWORK.deployments.filter((d) => d.hub === h.id);
                  return (
                    <tr key={h.id} className="border-t border-slate-800">
                      <td className="py-1.5 pr-3 font-mono text-cyan-200">{h.name}</td>
                      <td className="pr-3">{h.tier}</td>
                      <td className="pr-3 text-slate-400">{h.role}</td>
                      <td className="pr-3 font-mono">{deps.length}</td>
                      <td className="font-mono">{deps.reduce((s, d) => s + d.spiders, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Backbone: {NETWORK.backbone.map((b) => `${b.from}↔${b.to} (${b.medium.replace('_', ' ')}, ${b.capacityMbps} Mb/s)`).join(' · ')}
          </p>
        </Panel>
      </div>
    </div>
  );
}
