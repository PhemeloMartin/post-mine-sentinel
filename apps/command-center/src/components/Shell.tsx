import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Globe2, LogOut, Network, Radar, ScrollText, ShieldCheck } from 'lucide-react';
import { PERMISSIONS, useSession } from '@/store/session';
import { probeBackend } from '@/api/client';
import { notify } from '@/store/toasts';
import { Toaster } from './Toaster';

const NAV = [
  { to: '/', label: 'Orbital', icon: Globe2, hint: 'National mine galaxy & timeline' },
  { to: '/site', label: 'Site twin', icon: Radar, hint: '3D shaft simulation with S.P.I.D.E.R. nodes' },
  { to: '/network', label: 'SilkNet', icon: Network, hint: 'Mesh network & link budget' },
  { to: '/intel', label: 'Intel', icon: ScrollText, hint: 'Risk ranking, patrol planning, satellite' },
  { to: '/governance', label: 'Governance', icon: ShieldCheck, hint: 'Audit, compliance & access control' },
];

function SastClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString('en-ZA', { timeZone: 'Africa/Johannesburg', hour12: false });
  const date = now.toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short', year: 'numeric' });
  return (
    <div className="text-right leading-tight" aria-label={`South African Standard Time ${time}`}>
      <div className="font-mono text-sm text-cyan-100">{time}</div>
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{date} · SAST</div>
    </div>
  );
}

export function Shell() {
  const { session, backendOnline, setBackendOnline, logout } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const ok = await probeBackend();
      if (!alive) return;
      const was = useSession.getState().backendOnline;
      setBackendOnline(ok);
      if (was && !ok) notify({ kind: 'warning', title: 'Lost connection to Sentinel API', detail: 'Falling back to offline demo data. Alerts already raised remain on screen.' });
      if (!was && ok) notify({ kind: 'success', title: 'Connected to Sentinel API' });
    };
    void check();
    const id = setInterval(check, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [setBackendOnline]);

  return (
    <div className="flex h-full w-full flex-col bg-void">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-cyan-600 focus:px-3 focus:py-1">
        Skip to main content
      </a>
      <header className="relative z-20 flex h-14 shrink-0 items-center gap-4 border-b border-cyan-400/15 bg-deck/90 px-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="relative grid h-8 w-8 place-items-center rounded-full border border-cyan-300/50">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_12px_#ef4444]" />
            <div className="absolute inset-0 animate-pulseRing rounded-full border border-cyan-300/40" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-sm font-black tracking-[0.25em] text-cyan-100">POST-MINE SENTINEL</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">National illegal-mining early-warning grid</div>
          </div>
        </div>
        <nav className="ml-4 flex items-center gap-1" aria-label="Primary">
          {NAV.map(({ to, label, icon: Icon, hint }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              title={hint}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium uppercase tracking-wider transition',
                  isActive ? 'bg-cyan-400/15 text-cyan-100 shadow-glow' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100',
                )
              }
            >
              <Icon size={14} aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <span
            className={clsx('hud-chip', backendOnline ? 'border-emerald-400/50 text-emerald-300' : 'border-amber-400/50 text-amber-300')}
            title={backendOnline ? 'Streaming from the Sentinel API' : 'API unreachable: running the offline digital twin with bundled data'}
          >
            <span className={clsx('h-1.5 w-1.5 rounded-full', backendOnline ? 'bg-emerald-400' : 'bg-amber-400')} />
            {backendOnline ? 'Live' : 'Demo / offline'}
          </span>
          <SastClock />
          {session && (
            <div className="flex items-center gap-2 border-l border-slate-700 pl-4">
              <div className="text-right leading-tight">
                <div className="text-xs text-slate-200">{session.displayName}</div>
                <div className="text-[10px] uppercase tracking-wider text-cyan-400/80">{PERMISSIONS[session.role].label}</div>
              </div>
              <button
                className="hud-btn !px-2"
                onClick={() => {
                  logout();
                  navigate('/login');
                }}
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut size={14} />
              </button>
            </div>
          )}
        </div>
      </header>
      <main id="main" className="relative min-h-0 flex-1">
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}
