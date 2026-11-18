import { useMemo } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SiteScene } from '@/components/site/SiteScene';
import { EventLog, NodeStrip, PosteriorChart, ScenarioPanel, ThreatPanel } from '@/components/site/SitePanels';
import { DEPLOYMENT_BY_MINE, MINE_BY_ID, MINES } from '@/data/registry';
import { useSiteSim } from '@/sim/useSiteSim';
import { hasWebGL } from '@/lib/webgl';
import { can, useSession } from '@/store/session';

const DEFAULT_SITE = 'ZA-NW-002'; // Buffelsfontein Shaft 11 (Stilfontein)

export function SitePage() {
  const { mineId } = useParams();
  const navigate = useNavigate();
  const role = useSession((s) => s.session?.role);
  const mine = MINE_BY_ID.get(mineId ?? DEFAULT_SITE);
  const sites = useMemo(
    () => MINES.filter((m) => DEPLOYMENT_BY_MINE.has(m.id) || (m.risk.rai >= 50 && m.status !== 'operating')).sort((a, b) => b.risk.rai - a.risk.rai),
    [],
  );
  useSiteSim(mine?.risk.rai ?? 50);
  const webgl = useMemo(hasWebGL, []);

  if (!can(role, 'live_alerts')) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-slate-400">
        <div className="hud-panel max-w-md p-5">
          <div className="hud-title mb-2 !text-amber-300">Restricted</div>
          Live site monitoring is limited to SOC analysts, field officers and administrators. Your role sees the national, generalised picture only.
        </div>
      </div>
    );
  }
  if (!mine) return <Navigate to={`/site/${DEFAULT_SITE}`} replace />;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="absolute inset-0">
        {webgl ? (
          <ErrorBoundary region="Site digital twin">
            <SiteScene />
          </ErrorBoundary>
        ) : (
          <div className="grid h-full place-items-center text-slate-400">WebGL unavailable: the simulation still runs; see the panels.</div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col gap-3 p-3">
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="flex min-h-0 flex-col">
            <ScenarioPanel mine={mine} sites={sites} onSite={(id) => navigate(`/site/${id}`)} />
          </div>
          <div className="flex flex-1 flex-col items-center">
            <div className="hud-panel pointer-events-auto px-4 py-1.5 text-center">
              <div className="font-display text-sm font-bold tracking-[0.2em] text-cyan-100">{mine.name.toUpperCase()}</div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500">
                {mine.locality} · digital twin · S.P.I.D.E.R. field: 24 nodes, 2 anchors · not to scale (nodes ×12)
              </div>
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-3">
            <ThreatPanel />
            <EventLog />
          </div>
        </div>
        <NodeStrip />
        <PosteriorChart />
      </div>
    </div>
  );
}
