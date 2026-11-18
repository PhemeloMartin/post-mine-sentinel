import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Area } from 'recharts';
import { ArrowDownUp, Route, Satellite, Search } from 'lucide-react';
import { Chip, Panel, Stat } from '@/components/ui';
import { MINE_BY_ID, MINES, NETWORK } from '@/data/registry';
import { haversineKm } from '@/lib/geo';
import { planRoute, type PlanSite } from '@/lib/planning';
import { shaftwatchSeries } from '@/lib/shaftwatch';
import { BAND_COLOR, COMMODITY_LABEL, FACTOR_COLOR, FACTOR_LABEL, STATUS_COLOR, STATUS_GLYPH, STATUS_LABEL } from '@/lib/theme';
import { useOrbital } from '@/store/orbital';
import { can, useSession } from '@/store/session';
import type { Mine, RiskBand } from '@/types';

type SortKey = 'rai' | 'name' | 'province' | 'opened';

function RiskTable({ onPick }: { onPick: (m: Mine) => void }) {
  const [q, setQ] = useState('');
  const [band, setBand] = useState<RiskBand | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'rai', dir: -1 });
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return MINES.filter((m) => (!band || m.risk.band === band) && (!needle || `${m.name} ${m.locality} ${m.provinceName} ${m.commodity}`.toLowerCase().includes(needle))).sort((a, b) => {
      const va = sort.key === 'rai' ? a.risk.rai : sort.key === 'opened' ? a.opened ?? 0 : sort.key === 'name' ? a.name : a.province;
      const vb = sort.key === 'rai' ? b.risk.rai : sort.key === 'opened' ? b.opened ?? 0 : sort.key === 'name' ? b.name : b.province;
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [q, band, sort]);
  const th = (key: SortKey, label: string) => (
    <th className="py-1.5 pr-3 font-medium">
      <button className="inline-flex items-center gap-1 hover:text-slate-200" onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : -1 }))} aria-label={`Sort by ${label}`}>
        {label} <ArrowDownUp size={10} />
      </button>
    </th>
  );
  return (
    <Panel
      title={`Risk register: ${rows.length} sites`}
      className="flex min-h-0 flex-col"
      actions={
        <div className="flex items-center gap-1.5">
          {(['critical', 'high', 'elevated', 'low'] as RiskBand[]).map((b) => (
            <Chip key={b} color={BAND_COLOR[b]} active={!band || band === b} onClick={() => setBand(band === b ? null : b)}>
              {b}
            </Chip>
          ))}
          <label className="relative">
            <Search size={12} className="absolute left-2 top-1.5 text-slate-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              aria-label="Search mines"
              className="w-40 rounded-md border border-slate-700 bg-slate-900 py-1 pl-6 pr-2 text-xs outline-none focus:border-cyan-400"
            />
          </label>
        </div>
      }
    >
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-950/95 text-slate-500">
            <tr>
              {th('name', 'Site')}
              {th('province', 'Prov.')}
              <th className="pr-3 font-medium">Commodity</th>
              <th className="pr-3 font-medium">Status</th>
              {th('opened', 'Opened')}
              {th('rai', 'RAI')}
              <th className="w-44 font-medium">Why (log-odds contributions)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const total = Object.values(m.risk.contributions).reduce((a, b) => a + b, 0);
              return (
                <tr key={m.id} className="cursor-pointer border-t border-slate-800/80 hover:bg-slate-800/40" onClick={() => onPick(m)}>
                  <td className="py-1.5 pr-3">
                    <div className="text-slate-100">{m.name}</div>
                    <div className="text-[10px] text-slate-500">{m.locality}</div>
                  </td>
                  <td className="pr-3 font-mono text-slate-400">{m.province}</td>
                  <td className="pr-3 text-slate-300">{COMMODITY_LABEL[m.commodity]}</td>
                  <td className="pr-3" style={{ color: STATUS_COLOR[m.status] }}>
                    {STATUS_GLYPH[m.status]} {STATUS_LABEL[m.status]}
                  </td>
                  <td className="pr-3 font-mono text-slate-400">{m.opened ?? '?'}</td>
                  <td className="pr-3 font-mono font-semibold" style={{ color: BAND_COLOR[m.risk.band] }}>
                    {m.risk.rai.toFixed(1)}
                  </td>
                  <td>
                    <div className="flex h-2 w-40 overflow-hidden rounded-full bg-slate-800">
                      {Object.entries(m.risk.contributions).map(([k, v]) => (
                        <div key={k} style={{ width: `${(v / total) * 100}%`, background: FACTOR_COLOR[k] }} title={`${FACTOR_LABEL[k]} +${v.toFixed(2)}`} />
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-slate-400">
        {Object.keys(FACTOR_LABEL).map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: FACTOR_COLOR[k] }} /> {FACTOR_LABEL[k]}
          </span>
        ))}
      </div>
    </Panel>
  );
}

function Planner({ focusId }: { focusId: string | null }) {
  const [hubId, setHubId] = useState(() => {
    const dep = NETWORK.deployments.find((d) => d.mineId === focusId);
    return dep?.hub ?? 'SOC-KOSH';
  });
  const [budget, setBudget] = useState(8);
  const hub = NETWORK.hubs.find((h) => h.id === hubId)!;
  const plan = useMemo(() => {
    const candidates: PlanSite[] = MINES.filter((m) => m.status !== 'operating' && m.status !== 'rehabilitated' && haversineKm(hub.lat, hub.lon, m.lat, m.lon) < 160).map((m) => ({
      id: m.id,
      name: m.name,
      lat: m.lat,
      lon: m.lon,
      value: m.risk.rai / 10,
      serviceH: m.method === 'underground' ? 1.5 : 1,
    }));
    return { candidates, result: planRoute(hub, candidates, budget) };
  }, [hub, budget]);
  return (
    <Panel title="Inspection planner (orienteering problem)">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <span className="hud-label">Depot</span>
          <select value={hubId} onChange={(e) => setHubId(e.target.value)} className="mt-1 block rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs">
            {NETWORK.hubs
              .filter((h) => h.tier > 0)
              .map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
          </select>
        </label>
        <label className="flex-1 text-xs">
          <span className="hud-label flex justify-between">
            <span>Shift budget</span>
            <span className="font-mono text-cyan-200">{budget} h</span>
          </span>
          <input type="range" min={3} max={12} step={0.5} value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="w-full" />
        </label>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat label="Candidates (<160 km)" value={plan.candidates.length} />
        <Stat label="Sites in route" value={plan.result.route.length} tone="green" />
        <Stat label="Route time" value={`${plan.result.durationH.toFixed(1)} h`} />
      </div>
      <ol className="mt-3 space-y-1 text-xs">
        {plan.result.legs.map((l, i) => {
          const m = MINE_BY_ID.get(l.to);
          return (
            <li key={i} className="flex items-center gap-2">
              <span className="w-5 font-mono text-[10px] text-slate-500">{i + 1}</span>
              <Route size={12} className="text-cyan-400" />
              <span className="flex-1 truncate text-slate-200">{m ? m.name : `Return to ${l.to}`}</span>
              <span className="font-mono text-[10px] text-slate-500">{(l.hours * 60).toFixed(0)} min drive</span>
              {m && (
                <span className="w-10 text-right font-mono text-[11px]" style={{ color: BAND_COLOR[m.risk.band] }}>
                  {m.risk.rai.toFixed(0)}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[10px] text-slate-500">
        Heuristic: greedy ratio insertion → 2-opt → iterated local search. The API also solves small instances exactly (Held–Karp DP) and as a QUBO with simulated annealing and
        statevector QAOA (quantum-ready).
      </p>
    </Panel>
  );
}

function ShaftWatchPanel({ mine }: { mine: Mine }) {
  const data = useMemo(() => shaftwatchSeries(mine.id, mine.illegalActivity.reported), [mine]);
  const first = data.find((d) => d.alarm);
  return (
    <Panel title={`ShaftWatch satellite layer: ${mine.name}`}>
      <div className="mb-1 flex items-center gap-2 text-[11px] text-amber-300">
        <Satellite size={13} /> Synthetic demonstration series. Connect the Earth Engine job (Sentinel-2 NDVI/BSI, 400 m buffer) for live data.
      </div>
      <div className="h-48">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 9 }} minTickGap={36} />
            <YAxis yAxisId="i" domain={[-0.2, 0.7]} tick={{ fill: '#64748b', fontSize: 9 }} />
            <YAxis yAxisId="c" orientation="right" tick={{ fill: '#64748b', fontSize: 9 }} />
            <Tooltip contentStyle={{ background: '#0b1220', border: '1px solid #164e63', fontSize: 11 }} />
            <Area yAxisId="c" dataKey="cusum" name="CUSUM" fill="#ef444433" stroke="#ef4444" isAnimationActive={false} />
            <Line yAxisId="i" dataKey="ndvi" name="NDVI" stroke="#34d399" dot={false} strokeWidth={1.5} isAnimationActive={false} />
            <Line yAxisId="i" dataKey="bsi" name="Bare-soil index" stroke="#f59e0b" dot={false} strokeWidth={1.5} isAnimationActive={false} />
            <ReferenceLine yAxisId="c" y={4} stroke="#ef4444" strokeDasharray="4 3" />
            {first && <ReferenceLine yAxisId="i" x={first.label} stroke="#f87171" label={{ value: 'alarm', fill: '#f87171', fontSize: 9 }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-slate-500">
        Each shaft is compared with its own seasonal history (robust z-scores, no look-ahead). CUSUM S_t = max(0, S_t−1 + D_t − k) with k = 0.5, h = 4.
      </p>
    </Panel>
  );
}

export function IntelPage() {
  const role = useSession((s) => s.session?.role);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const select = useOrbital((s) => s.select);
  const [picked, setPicked] = useState<Mine>(() => MINE_BY_ID.get(params.get('site') ?? '') ?? MINES[0]);
  if (!can(role, 'view_all') && !can(role, 'plan_inspections')) {
    return <div className="grid h-full place-items-center text-sm text-slate-400">Intelligence products are restricted for your role.</div>;
  }
  return (
    <div className="grid h-full gap-3 overflow-hidden p-3 xl:grid-cols-[1.35fr_1fr]">
      <RiskTable onPick={setPicked} />
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <div className={clsx('hud-panel flex items-center justify-between gap-2 p-3')}>
          <div>
            <div className="hud-label">Selected</div>
            <div className="text-sm font-semibold text-slate-100">{picked.name}</div>
          </div>
          <div className="flex gap-1.5">
            <button
              className="hud-btn"
              onClick={() => {
                select(picked.id);
                navigate('/');
              }}
            >
              Show on map
            </button>
            <button className="hud-btn" onClick={() => navigate(`/site/${picked.id}`)} disabled={!can(role, 'live_alerts')}>
              Site twin
            </button>
          </div>
        </div>
        <ShaftWatchPanel mine={picked} />
        {can(role, 'plan_inspections') && <Planner focusId={picked.id} />}
      </div>
    </div>
  );
}
