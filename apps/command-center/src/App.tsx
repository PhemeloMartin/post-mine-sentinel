import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useRouteError } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Shell } from '@/components/Shell';
import { LoginPage } from '@/pages/LoginPage';
import { useSession } from '@/store/session';

// Heavy 3D pages are code-split so the login screen loads instantly.
const OrbitalPage = lazy(() => import('@/pages/OrbitalPage').then((m) => ({ default: m.OrbitalPage })));
const SitePage = lazy(() => import('@/pages/SitePage').then((m) => ({ default: m.SitePage })));
const NetworkPage = lazy(() => import('@/pages/NetworkPage').then((m) => ({ default: m.NetworkPage })));
const IntelPage = lazy(() => import('@/pages/IntelPage').then((m) => ({ default: m.IntelPage })));
const GovernancePage = lazy(() => import('@/pages/GovernancePage').then((m) => ({ default: m.GovernancePage })));

function Loading() {
  return (
    <div className="grid h-full place-items-center" role="status" aria-live="polite">
      <div className="font-display text-xs uppercase tracking-[0.4em] text-cyan-300/70">Initialising…</div>
    </div>
  );
}

function RequireSession({ children }: { children: ReactNode }) {
  const session = useSession((s) => s.session);
  return session ? <>{children}</> : <Navigate to="/login" replace />;
}

function page(region: string, el: ReactNode) {
  return (
    <ErrorBoundary region={region}>
      <Suspense fallback={<Loading />}>{el}</Suspense>
    </ErrorBoundary>
  );
}

/** Router-level error element: chunk-load failures, bad URLs, thrown loader errors. */
function RouteError() {
  const err = useRouteError() as { status?: number; statusText?: string; message?: string };
  return (
    <div className="grid h-full place-items-center p-6 text-sm text-slate-300">
      <div className="hud-panel max-w-md p-5" role="alert">
        <div className="hud-title mb-2 !text-amber-300">{err?.status === 404 ? 'Page not found' : 'Navigation error'}</div>
        <p>{err?.statusText ?? err?.message ?? 'Something went wrong while loading this view.'}</p>
        <a className="hud-btn mt-3" href="/">
          Return to the national view
        </a>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  {
    path: '/',
    element: (
      <RequireSession>
        <Shell />
      </RequireSession>
    ),
    errorElement: <RouteError />,
    children: [
      { index: true, element: page('Orbital view', <OrbitalPage />) },
      { path: 'site/:mineId?', element: page('Site twin', <SitePage />) },
      { path: 'network', element: page('SilkNet', <NetworkPage />) },
      { path: 'intel', element: page('Intelligence', <IntelPage />) },
      { path: 'governance', element: page('Governance', <GovernancePage />) },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
