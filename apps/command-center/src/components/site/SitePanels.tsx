import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Camera, Eye, EyeOff, Layers, Pause, Play, RotateCcw } from 'lucide-react';
import { MODEL_CARD } from '@/data/registry';
import { fmtClock, fmtDuration, pct } from '@/lib/format';
import { SCENARIOS } from '@/sim/scenarios';
import { useSim, type CameraPreset } from '@/store/sim';
import type { Mine } from '@/types';
import { Panel, Stat } from '../ui';

export function ScenarioPanel({ mine, sites, onSite }: { mine: Mine; sites: Mine[]; onSite: (id: string) => void }) {
  const s = useSim();
  const scenario = SCENARIOS.find((x) => x.id === s.scenarioId)!;
  return (
    <Panel title="Scenario control" className="w-80 overflow-y-auto">
      <label className="block text-xs">
        <span className="hud-label">Site</span>
        <select
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
          value={mine.id}
          onChange={(e) => onSite(e.target.value)}
        >
          {sites.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} — RAI {m.risk.rai.toFixed(0)}
            </option>
          ))}
        </select>
      </label>
      <div className="hud-label mb-1 mt-3">Scenario</div>
      <div className="space-y-1" role="radiogroup" aria-label="Scenario">
        {SCENARIOS.map((sc) => (
          <button
            key={sc.id}
            role="radio"
            aria-checked={sc.id === s.scenarioId}
            onClick={() => s.setScenario(sc.id)}
            className={clsx(
              'w-full rounded-md border px-2.5 py-1.5 text-left text-xs transition',
              sc.id === s.scenarioId ? 'border-cyan-300/70 bg-cyan-400/10 text-white' : 'border-slate-700/70 text-slate-300 hover:border-slate-500',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{sc.name}</span>
              <span className={clsx('text-[9px] uppercase', sc.hasThreat ? 'text-red-300' : 'text-emerald-300')}>{sc.hasThreat ? 'threat' : 'benign'}</span>
            </div>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{scenario.summary}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-cyan-200/80">
        <span className="font-semibold">What to watch: </span>
        {scenario.learning}
      </p>

      <div className="mt-3 flex items-center gap-1.5">
        <button className="hud-btn" onClick={() => s.setPlaying(!s.playing)} aria-label={s.playing ? 'Pause' : 'Play'}>
          {s.playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button className="hud-btn" onClick={s.restart} aria-label="Restart scenario">
          <RotateCcw size={14} />
        </button>
        {[1, 8, 30, 90].map((v) => (
          <button key={v} className={clsx('hud-btn !px-2 font-mono', s.speed === v && 'hud-btn-active')} onClick={() => s.setSpeed(v)} aria-pressed={s.speed === v}>
            {v}×
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <button className={clsx('hud-btn justify-center', s.reveal && 'hud-btn-active')} onClick={() => s.setReveal(!s.reveal)} aria-pressed={s.reveal}>
          {s.reveal ? <Eye size={14} /> : <EyeOff size={14} />} {s.reveal ? 'Sensors revealed' : 'Plain sight'}
        </button>
        <button className={clsx('hud-btn justify-center', s.xray && 'hud-btn-active')} onClick={() => s.setXray(!s.xray)} aria-pressed={s.xray}>
          <Layers size={14} /> Underground
        </button>
      </div>
      <div className="hud-label mb-1 mt-3 flex items-center gap-1">
        <Camera size={11} /> Camera
      </div>
      <div className="grid grid-cols-4 gap-1">
        {(['overview', 'collar', 'approach', 'underground'] as CameraPreset[]).map((c) => (
          <button key={c} className={clsx('hud-btn justify-center !px-1 text-[10px] capitalize', s.camera === c && 'hud-btn-active')} onClick={() => s.setCamera(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="mt-3 rounded-md border border-slate-700/60 p-2">
        <div className="hud-label">Edge model profile</div>
        <div className="mt-1 grid grid-cols-2 gap-1">
          {(['calibrated', 'uncalibrated'] as const).map((p) => (
            <button key={p} className={clsx('hud-btn justify-center text-[10px] capitalize', s.profile === p && 'hud-btn-active')} onClick={() => s.setProfile(p)}>
              {p}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-slate-500">
          Calibrated = in-distribution test metrics (FAR {pct(MODEL_CARD.evaluation.mlp_edge.test.false_alarm_rate)}); uncalibrated = unseen-soil metrics (FAR{' '}
          {pct(MODEL_CARD.evaluation.mlp_edge.test_shift.false_alarm_rate)}). Shows why site commissioning matters.
        </p>
      </div>
    </Panel>
  );
}

const STEPS = ['raised', 'acknowledged', 'dispatched', 'resolved'] as const;

export function ThreatPanel() {
  const snap = useSim((s) => s.snapshot);
  if (!snap) return null;
  const p = snap.posterior;
  const color = p >= 0.9 ? '#ef4444' : p >= 0.5 ? '#f59e0b' : '#22d3ee';
  const C = 2 * Math.PI * 42;
  const alert = snap.alert ?? snap.alertHistory.at(-1) ?? null;
  const m = snap.metrics;
  const pdr = m.packetsGenerated ? m.packetsDelivered / m.packetsGenerated : 1;
  return (
    <Panel title="Threat assessment" className="w-80">
      <div className="flex items-center gap-3">
        <svg width="104" height="104" viewBox="0 0 104 104" role="img" aria-label={`Fused intrusion probability ${pct(p)}`}>
          <circle cx="52" cy="52" r="42" fill="none" stroke="#1e293b" strokeWidth="8" />
          <circle
            cx="52"
            cy="52"
            r="42"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${C * p} ${C}`}
            transform="rotate(-90 52 52)"
            style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: 'stroke-dasharray 0.3s' }}
          />
          <text x="52" y="50" textAnchor="middle" className="fill-slate-100 font-mono" fontSize="18" fontWeight="700">
            {(p * 100).toFixed(1)}
          </text>
          <text x="52" y="66" textAnchor="middle" className="fill-slate-400" fontSize="9">
            P(intrusion) %
          </text>
        </svg>
        <div className="flex-1 space-y-1.5">
          <div className="hud-label">Site clock</div>
          <div className="font-mono text-xl text-cyan-100">{fmtClock(snap.clock)}</div>
          <div className="text-[10px] text-slate-500">T+{fmtDuration(snap.t)} · noise {snap.noiseRms.toFixed(0)} counts</div>
        </div>
      </div>
      {alert ? (
        <div className={clsx('mt-3 rounded-lg border p-2.5', alert.status === 'resolved' ? 'border-emerald-400/40 bg-emerald-400/5' : 'border-red-500/50 bg-red-500/10')} role="status">
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono font-bold text-red-200">{alert.id}</span>
            <span className={clsx('hud-chip', alert.level === 'critical' ? 'border-red-400 text-red-300' : 'border-amber-400 text-amber-300')}>{alert.level}</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-300">Evidence: {alert.reason}</div>
          {(alert.tamper || alert.jamming) && (
            <div className="mt-1 text-[11px] text-fuchsia-300">
              {alert.tamper && '⚠ sensor tamper '} {alert.jamming && '⚠ RF jamming'}
            </div>
          )}
          <ol className="mt-2 grid grid-cols-4 gap-1 text-center text-[9px] uppercase tracking-wider">
            {STEPS.map((st, i) => {
              const done = STEPS.indexOf(alert.status) >= i;
              return (
                <li key={st} className={clsx('rounded border px-1 py-0.5', done ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-100' : 'border-slate-700 text-slate-500')}>
                  {st}
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-slate-700/60 p-2.5 text-[11px] text-slate-400">No active alert. Alert threshold: P ≥ 90 % (critical ≥ 97 %).</div>
      )}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="Detect latency" value={m.detectionLatency !== null ? fmtDuration(m.detectionLatency) : '—'} tone={m.detectionLatency !== null ? 'green' : 'slate'} />
        <Stat label="False alarms" value={m.falseAlarms} tone={m.falseAlarms ? 'red' : 'green'} />
        <Stat label="Packet delivery" value={pct(pdr)} tone={pdr > 0.9 ? 'green' : 'amber'} />
        <Stat label="TDOA fixes" value={m.fixes} />
        <Stat label="Mean hops" value={m.packetsDelivered ? (m.hopSum / m.packetsDelivered).toFixed(2) : '—'} />
        <Stat label="Re-routes" value={m.rerouted} tone={m.rerouted ? 'amber' : 'slate'} />
      </div>
    </Panel>
  );
}

const LEVEL_COLOR: Record<string, string> = {
  info: 'text-slate-400',
  net: 'text-sky-300',
  detect: 'text-amber-200',
  warn: 'text-fuchsia-300',
  alert: 'text-red-300',
  ok: 'text-emerald-300',
};

export function EventLog() {
  const snap = useSim((s) => s.snapshot);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [snap?.log.length]);
  if (!snap) return null;
  return (
    <Panel title="SOC event stream" className="flex min-h-0 w-80 flex-1 flex-col">
      <div ref={ref} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto font-mono text-[10.5px] leading-snug" role="log" aria-live="off">
        {snap.log.map((l) => (
          <div key={l.id} className={LEVEL_COLOR[l.level]}>
            <span className="text-slate-600">{fmtClock(snap.clock - snap.t + l.t)} </span>
            {l.msg}
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function PosteriorChart() {
  const snap = useSim((s) => s.snapshot);
  if (!snap) return null;
  const data = snap.history.map((h) => ({ t: Math.round(h.t), p: +(h.p * 100).toFixed(2), r: h.reports }));
  return (
    <div className="hud-panel pointer-events-auto h-36 p-2">
      <div className="hud-title mb-1 px-1">Fused intrusion probability (Bayesian log-odds, decay T½ = 120 s)</div>
      <ResponsiveContainer width="100%" height="85%">
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.6} />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <XAxis dataKey="t" tick={{ fill: '#64748b', fontSize: 9 }} tickFormatter={(v) => fmtClock(snap.clock - snap.t + v).slice(0, 5)} minTickGap={40} />
          <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 9 }} />
          <ReferenceLine y={90} stroke="#ef4444" strokeDasharray="4 3" label={{ value: 'alert', fill: '#f87171', fontSize: 9, position: 'insideTopRight' }} />
          <Tooltip contentStyle={{ background: '#0b1220', border: '1px solid #164e63', fontSize: 11 }} labelFormatter={(v) => fmtClock(snap.clock - snap.t + Number(v))} formatter={(v: number) => [`${v}%`, 'P(intrusion)']} />
          <Area type="monotone" dataKey="p" stroke="#f87171" strokeWidth={1.5} fill="url(#pg)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function NodeStrip() {
  const snap = useSim((s) => s.snapshot);
  if (!snap) return null;
  return (
    <div className="hud-panel pointer-events-auto flex items-center gap-2 p-2">
      <span className="hud-title shrink-0">S.P.I.D.E.R.</span>
      <div className="flex flex-wrap gap-1" role="list" aria-label="Sensor node status">
        {snap.nodes.map((n) => {
          const threat = n.status === 'triggered' && snap.t < n.flashUntil && n.lastPThreat >= 0.6;
          const c = n.status === 'tampered' ? '#e879f9' : threat ? '#ef4444' : n.status === 'triggered' ? '#f59e0b' : n.parent ? '#22d3ee' : '#475569';
          return (
            <div
              key={n.id}
              role="listitem"
              title={`${n.id} (${n.mount}) · ${n.status} · last: ${n.lastClass} · via ${n.parent ?? 'no route'} · ${n.hops} hop(s) · RSSI ${n.rssi.toFixed(0)} dBm · battery ${n.battery.toFixed(0)}%`}
              className="grid h-6 w-9 place-items-center rounded border font-mono text-[9px]"
              style={{ borderColor: `${c}99`, color: c, background: `${c}18` }}
            >
              {n.id}
            </div>
          );
        })}
      </div>
    </div>
  );
}
