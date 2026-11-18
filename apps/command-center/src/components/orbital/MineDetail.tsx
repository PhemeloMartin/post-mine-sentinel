import { useNavigate } from 'react-router-dom';
import { AlertOctagon, Compass, Lock, MapPin, Radar, Route, X } from 'lucide-react';
import { DEPLOYMENT_BY_MINE, HUB_BY_ID } from '@/data/registry';
import { fmtNumber, fmtRange, fmtYears } from '@/lib/format';
import { BAND_COLOR, COMMODITY_LABEL, FACTOR_COLOR, FACTOR_LABEL, STATUS_COLOR, STATUS_GLYPH, STATUS_LABEL } from '@/lib/theme';
import { statusAt } from '@/lib/timeline';
import { useOrbital } from '@/store/orbital';
import type { Mine } from '@/types';
import { Chip, Panel } from '../ui';

export function MineDetail({ mine, restricted }: { mine: Mine; restricted: boolean }) {
  const navigate = useNavigate();
  const { year, select } = useOrbital();
  const st = statusAt(mine, year) ?? mine.status;
  const dep = DEPLOYMENT_BY_MINE.get(mine.id);
  const contribTotal = Object.values(mine.risk.contributions).reduce((a, b) => a + b, 0);

  return (
    <Panel
      title="Site dossier"
      className="max-h-full overflow-y-auto"
      actions={
        <button className="text-slate-500 hover:text-slate-200" onClick={() => select(null)} aria-label="Close dossier">
          <X size={16} />
        </button>
      }
    >
      <h3 className="text-base font-semibold leading-tight text-slate-50">{mine.name}</h3>
      <div className="mt-0.5 font-mono text-[10px] text-slate-500">{mine.id}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Chip color={STATUS_COLOR[st]}>
          {STATUS_GLYPH[st]} {STATUS_LABEL[st]}
        </Chip>
        <Chip color="#94a3b8">{COMMODITY_LABEL[mine.commodity]}</Chip>
        {!restricted && <Chip color={BAND_COLOR[mine.risk.band]}>{mine.risk.band} risk</Chip>}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="hud-label">Locality</dt>
          <dd className="text-slate-200">{mine.locality}</dd>
        </div>
        <div>
          <dt className="hud-label">Province</dt>
          <dd className="text-slate-200">{mine.provinceName}</dd>
        </div>
        <div className="col-span-2">
          <dt className="hud-label">Field / method</dt>
          <dd className="text-slate-200">
            {mine.field} · {mine.method.replace('_', ' ')}
            {mine.maxDepthM ? ` · ~${fmtNumber(mine.maxDepthM)} m deep` : ''}
          </dd>
        </div>
        <div>
          <dt className="hud-label">Operated</dt>
          <dd className="font-mono text-slate-200">{fmtYears(mine.opened, mine.closed)}</dd>
          <dd className="text-[10px] text-slate-500">dates: {mine.datesConfidence} confidence</dd>
        </div>
        <div>
          <dt className="hud-label">Coordinates</dt>
          {restricted ? (
            <dd className="flex items-center gap-1 text-amber-300">
              <Lock size={11} /> generalised (~5 km)
            </dd>
          ) : (
            <dd className="font-mono text-slate-200">
              {mine.lat.toFixed(3)}, {mine.lon.toFixed(3)}
              <div className="text-[10px] text-slate-500">± {fmtNumber(mine.precisionM)} m</div>
            </dd>
          )}
        </div>
        <div>
          <dt className="hud-label">Historic production</dt>
          <dd className="font-mono text-slate-100">{fmtRange(mine.production)}</dd>
          <dd className="text-[10px] text-slate-500">{mine.production ? `${mine.production.confidence} confidence` : 'no estimate'}</dd>
        </div>
        <div>
          <dt className="hud-label">Residual remnant</dt>
          <dd className="font-mono text-amber-200">{fmtRange(mine.residual)}</dd>
          <dd className="text-[10px] text-slate-500">modelled: pillars & remnants</dd>
        </div>
      </dl>

      {!restricted ? (
        <div className="mt-3 rounded-lg border border-slate-700/60 bg-slate-950/40 p-2.5">
          <div className="flex items-end justify-between">
            <div>
              <div className="hud-label">Residual Attraction Index</div>
              <div className="font-mono text-2xl font-bold" style={{ color: BAND_COLOR[mine.risk.band] }}>
                {mine.risk.rai.toFixed(1)}
                <span className="text-xs text-slate-500"> / 100</span>
              </div>
            </div>
            <div className="text-right font-mono text-[10px] text-slate-500">logit z = {mine.risk.logit.toFixed(2)}</div>
          </div>
          <div className="mt-2 text-[10px] text-slate-400">Why this score (contribution to the log-odds):</div>
          <div className="mt-1 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
            {Object.entries(mine.risk.contributions).map(([k, v]) => (
              <div key={k} style={{ width: `${(v / contribTotal) * 100}%`, background: FACTOR_COLOR[k] }} title={`${FACTOR_LABEL[k]}: ${v.toFixed(2)}`} />
            ))}
          </div>
          <ul className="mt-2 space-y-1">
            {Object.entries(mine.risk.factors).map(([k, v]) => (
              <li key={k} className="flex items-center gap-2 text-[11px]">
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: FACTOR_COLOR[k] }} />
                <span className="flex-1 text-slate-300">{FACTOR_LABEL[k]}</span>
                <span className="font-mono text-slate-400">x={v.toFixed(2)}</span>
                <span className="w-12 text-right font-mono text-slate-200">+{mine.risk.contributions[k as keyof typeof mine.risk.contributions].toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 flex items-start gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/5 p-2 text-[11px] text-amber-200">
          <Lock size={13} className="mt-0.5 shrink-0" /> Risk scores and incident intelligence are restricted for your role (need-to-know, POPIA s19).
        </p>
      )}

      {!restricted && mine.illegalActivity.reported && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-[11px] text-red-200">
          <AlertOctagon size={14} className="mt-0.5 shrink-0 text-red-400" />
          <div>
            Illegal activity publicly reported{mine.illegalActivity.lastReportedYear ? ` (latest ${mine.illegalActivity.lastReportedYear})` : ''}.
          </div>
        </div>
      )}
      {mine.notes && <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{mine.notes}</p>}

      {dep && !restricted && (
        <div className="mt-3 rounded-md border border-cyan-400/25 bg-cyan-400/5 p-2 text-[11px] text-cyan-100">
          <div className="hud-label !text-cyan-300">Sentinel deployment · phase {dep.phase}</div>
          <div className="mt-1 flex gap-3 font-mono">
            <span>{dep.spiders} spiders</span>
            <span>{dep.anchors} anchors</span>
            <span>{dep.backhaul.replace('_', ' ')}</span>
          </div>
          <div className="text-slate-400">Reports to {HUB_BY_ID.get(dep.hub)?.name}</div>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="hud-btn justify-center" onClick={() => navigate(`/site/${mine.id}`)} disabled={restricted}>
          <Radar size={14} /> Site twin
        </button>
        <button className="hud-btn justify-center" onClick={() => navigate(`/intel?site=${mine.id}`)} disabled={restricted}>
          <Route size={14} /> Plan inspection
        </button>
      </div>
      <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-500">
        {restricted ? <Compass size={11} /> : <MapPin size={11} />} Figures are estimates for prototyping; verify against SAMINDABA / DMPR records.
      </div>
    </Panel>
  );
}
