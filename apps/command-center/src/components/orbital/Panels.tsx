import { useMemo } from 'react';
import clsx from 'clsx';
import { FastForward, Pause, Play, RotateCcw } from 'lucide-react';
import { MINES, NETWORK, YEAR_MIN, YEAR_NOW } from '@/data/registry';
import { fmtNumber } from '@/lib/format';
import { BAND_COLOR, COMMODITY_LABEL, STATUS_COLOR, STATUS_GLYPH, STATUS_LABEL } from '@/lib/theme';
import { cumulativeProduction, decadeHistogram } from '@/lib/timeline';
import { useOrbital } from '@/store/orbital';
import type { Commodity, MineStatus } from '@/types';
import { Chip, Panel, Stat } from '../ui';
import type { VisibleMine } from './visibility';

export function KpiPanel({ items }: { items: VisibleMine[] }) {
  const year = useOrbital((s) => s.year);
  const k = useMemo(() => {
    const active = items.filter((i) => i.status === 'operating' || i.status === 'restarted').length;
    const dormant = items.filter((i) => ['closed', 'derelict', 'care_maintenance'].includes(i.status)).length;
    const critical = items.filter((i) => i.mine.risk.band === 'critical' && i.status !== 'operating').length;
    const gold = cumulativeProduction(MINES, year, 't', 'gold');
    return { active, dormant, critical, gold };
  }, [items, year]);
  const spiders = NETWORK.deployments.reduce((s, d) => s + d.spiders, 0);
  return (
    <Panel title="National picture" className="w-72">
      <div className="mb-2 font-display text-3xl font-black tracking-wider text-cyan-100" aria-live="polite">
        {Math.floor(year)}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Mines shown" value={items.length} sub={`of ${MINES.length} in register`} />
        <Stat label="Producing" value={k.active} tone="cyan" />
        <Stat label="Dormant / derelict" value={k.dormant} tone="amber" />
        <Stat label="Critical, unguarded" value={k.critical} tone="red" />
        <Stat label="Gold mined to date" value={`${fmtNumber(k.gold)} t`} sub="register estimate (midpoints)" tone="slate" />
        <Stat label="Sentinel pilots" value={NETWORK.deployments.length} sub={`${spiders} spider nodes`} tone="green" />
      </div>
      <p className="mt-3 border-t border-slate-700/50 pt-2 text-[10px] leading-relaxed text-slate-500">
        National context: ~6,100 derelict & ownerless mines (AGSA 2022); illegal mining costs ≈ R60 bn a year (Minerals Council / PwC estimates).
      </p>
    </Panel>
  );
}

const COMMODITIES: Commodity[] = ['gold', 'diamonds', 'pgm', 'coal', 'copper', 'iron', 'manganese', 'zinc', 'asbestos', 'tin'];
const STATUSES: MineStatus[] = ['operating', 'restarted', 'care_maintenance', 'closed', 'derelict', 'rehabilitated'];

export function FilterPanel({ restricted }: { restricted: boolean }) {
  const s = useOrbital();
  return (
    <Panel title="Filters" className="w-72">
      <div className="hud-label mb-1">Commodity</div>
      <div className="flex flex-wrap gap-1">
        {COMMODITIES.map((c) => (
          <Chip key={c} color="#7dd3fc" active={!s.commodities.size || s.commodities.has(c)} onClick={() => s.toggleCommodity(c)}>
            {COMMODITY_LABEL[c]}
          </Chip>
        ))}
      </div>
      <div className="hud-label mb-1 mt-2.5">Status (at timeline year)</div>
      <div className="flex flex-wrap gap-1">
        {STATUSES.map((st) => (
          <Chip key={st} color={STATUS_COLOR[st]} active={!s.statuses.size || s.statuses.has(st)} onClick={() => s.toggleStatus(st)} title={STATUS_LABEL[st]}>
            {STATUS_GLYPH[st]} {STATUS_LABEL[st]}
          </Chip>
        ))}
      </div>
      {!restricted && (
        <label className="mt-2.5 block">
          <span className="hud-label flex justify-between">
            <span>Minimum RAI</span>
            <span className="font-mono text-cyan-200">{s.minRai}</span>
          </span>
          <input type="range" min={0} max={90} step={5} value={s.minRai} onChange={(e) => s.setMinRai(Number(e.target.value))} className="w-full" />
        </label>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {!restricted && (
          <button className={clsx('hud-btn', s.showNetwork && 'hud-btn-active')} onClick={() => s.setShowNetwork(!s.showNetwork)} aria-pressed={s.showNetwork}>
            Sentinel network
          </button>
        )}
        <button className={clsx('hud-btn', s.autoRotate && 'hud-btn-active')} onClick={() => s.setAutoRotate(!s.autoRotate)} aria-pressed={s.autoRotate}>
          Auto-orbit
        </button>
      </div>
    </Panel>
  );
}

export function TopRisk({ items }: { items: VisibleMine[] }) {
  const select = useOrbital((s) => s.select);
  const top = [...items].filter((i) => i.status !== 'operating').sort((a, b) => b.mine.risk.rai - a.mine.risk.rai).slice(0, 12);
  return (
    <Panel title="Highest-risk dormant sites" className="max-h-full overflow-y-auto">
      <ol className="space-y-1">
        {top.map((i, idx) => (
          <li key={i.mine.id}>
            <button
              className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-slate-800/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300"
              onClick={() => select(i.mine.id)}
            >
              <span className="w-4 font-mono text-[10px] text-slate-500">{idx + 1}</span>
              <span className="flex-1 truncate text-slate-200 group-hover:text-white">{i.mine.name}</span>
              <span className="font-mono text-[11px]" style={{ color: BAND_COLOR[i.mine.risk.band] }}>
                {i.mine.risk.rai.toFixed(0)}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[10px] text-slate-500">Select a site to open its dossier. Risk = Residual Attraction Index (0–100).</p>
    </Panel>
  );
}

const HIST = decadeHistogram(MINES);
const HIST_MAX = Math.max(...HIST.map((h) => Math.max(h.opened, h.closed)));

export function TimelineBar() {
  const { year, playing, speed, setYear, setPlaying, setSpeed } = useOrbital();
  return (
    <div className="hud-panel pointer-events-auto flex items-center gap-3 px-4 py-2.5">
      <button
        className="hud-btn !px-2"
        onClick={() => {
          if (!playing && year >= YEAR_NOW) setYear(YEAR_MIN);
          setPlaying(!playing);
        }}
        aria-label={playing ? 'Pause timeline' : 'Play timeline'}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <button className="hud-btn !px-2" onClick={() => setSpeed(speed === 6 ? 15 : speed === 15 ? 3 : 6)} aria-label={`Playback speed ${speed} years per second`} title="Playback speed">
        <FastForward size={14} /> <span className="font-mono">{speed}y/s</span>
      </button>
      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex h-7 items-end gap-px" aria-hidden>
          {HIST.map((h) => (
            <div key={h.decade} className="flex flex-1 items-end gap-px">
              <div className="flex-1 rounded-t-sm bg-cyan-400/40" style={{ height: `${(h.opened / HIST_MAX) * 100}%` }} />
              <div className="flex-1 rounded-t-sm bg-red-400/40" style={{ height: `${(h.closed / HIST_MAX) * 100}%` }} />
            </div>
          ))}
        </div>
        <input
          type="range"
          min={YEAR_MIN}
          max={YEAR_NOW}
          step={1}
          value={Math.floor(year)}
          onChange={(e) => {
            setPlaying(false);
            setYear(Number(e.target.value));
          }}
          className="relative mt-7 w-full"
          aria-label="Timeline year"
        />
        <div className="flex justify-between font-mono text-[10px] text-slate-500">
          <span>{YEAR_MIN}</span>
          <span>1886 Witwatersrand discovery</span>
          <span>1970 peak gold</span>
          <span>{YEAR_NOW}</span>
        </div>
      </div>
      <button className="hud-btn !px-2" onClick={() => setYear(YEAR_NOW)} title="Jump to today" aria-label="Jump to today">
        <RotateCcw size={14} /> Now
      </button>
      <div className="flex flex-col gap-0.5 text-[10px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-cyan-400/60" /> openings / decade
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-red-400/60" /> closures / decade
        </span>
      </div>
    </div>
  );
}
