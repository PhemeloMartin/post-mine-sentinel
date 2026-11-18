import { useEffect, useMemo } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { MineDetail } from '@/components/orbital/MineDetail';
import { OrbitalScene } from '@/components/orbital/OrbitalScene';
import { FilterPanel, KpiPanel, TimelineBar, TopRisk } from '@/components/orbital/Panels';
import { visibleMines } from '@/components/orbital/visibility';
import { GEO_ATTRIBUTION, MINE_BY_ID, YEAR_NOW } from '@/data/registry';
import { hasWebGL } from '@/lib/webgl';
import { can, useSession } from '@/store/session';
import { useOrbital } from '@/store/orbital';

export function OrbitalPage() {
  const role = useSession((s) => s.session?.role);
  const restricted = !can(role, 'precise_location');
  const { year, playing, speed, commodities, statuses, minRai, selectedId, showNetwork, setYear, setPlaying } = useOrbital();

  // Timeline playback loop (frame-rate independent).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = useOrbital.getState().year + speed * dt;
      if (next >= YEAR_NOW) {
        setYear(YEAR_NOW);
        setPlaying(false);
        return;
      }
      setYear(next);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, setYear, setPlaying]);

  const items = useMemo(
    () => visibleMines({ year: Math.floor(year), commodities, statuses, minRai: restricted ? 0 : minRai, generalised: restricted }),
    [year, commodities, statuses, minRai, restricted],
  );
  const selected = selectedId ? MINE_BY_ID.get(selectedId) : undefined;
  const webgl = useMemo(hasWebGL, []);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="absolute inset-0">
        {webgl ? (
          <ErrorBoundary region="Orbital 3D view">
            <OrbitalScene items={items} restricted={restricted} showNetwork={showNetwork} />
          </ErrorBoundary>
        ) : (
          <div className="grid h-full place-items-center text-sm text-slate-400">WebGL is unavailable on this device; the 3D view is disabled. Tables in Intel remain available.</div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col gap-3 p-3">
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="flex flex-col gap-3">
            <KpiPanel items={items} />
            <FilterPanel restricted={restricted} />
          </div>
          <div className="flex-1" />
          <div className="flex w-[22rem] min-h-0 flex-col">{selected ? <MineDetail mine={selected} restricted={restricted} /> : <TopRisk items={items} />}</div>
        </div>
        <TimelineBar />
        <div className="text-[9px] text-slate-600">Boundaries: {GEO_ATTRIBUTION}. Mine register: prototype compilation, see data/mines/README.md.</div>
      </div>
    </div>
  );
}
