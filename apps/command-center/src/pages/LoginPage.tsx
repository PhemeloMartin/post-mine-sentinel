import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { apiFetch, ApiError } from '@/api/client';
import { PERMISSIONS, useSession } from '@/store/session';
import type { Role } from '@/types';

const DEMO_USERS: { role: Role; name: string; username: string }[] = [
  { role: 'analyst', name: 'Duty Analyst · SOC-KOSH', username: 'analyst' },
  { role: 'field_officer', name: 'Field Officer · SAPS', username: 'officer' },
  { role: 'auditor', name: 'Auditor · Oversight', username: 'auditor' },
  { role: 'community_liaison', name: 'Community Liaison', username: 'liaison' },
  { role: 'admin', name: 'Platform Administrator', username: 'admin' },
];

export function LoginPage() {
  const { login, backendOnline } = useSession();
  const navigate = useNavigate();
  const [role, setRole] = useState<Role>('analyst');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enterDemo = () => {
    const u = DEMO_USERS.find((d) => d.role === role)!;
    login({ username: u.username, displayName: u.name, role, mode: 'demo' });
    navigate('/');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ access_token: string; role: Role; display_name: string }>('/auth/login', {
        method: 'POST',
        body: { username, password },
        retries: 0,
      });
      login({ username, displayName: res.display_name, role: res.role, mode: 'live', token: res.access_token });
      navigate('/');
    } catch (err) {
      // Never reveal whether the username or the password was wrong (OWASP ASVS 2.2).
      setError(err instanceof ApiError && err.status === 401 ? 'Sign-in failed. Check your credentials.' : err instanceof ApiError ? err.problem.title : 'Unexpected error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative grid h-full place-items-center overflow-auto bg-void p-6">
      <div className="scanlines pointer-events-none absolute inset-0 opacity-60" />
      <div className="hud-panel relative w-full max-w-3xl p-6">
        <div className="mb-5 text-center">
          <div className="font-display text-2xl font-black tracking-[0.3em] text-cyan-100">POST-MINE SENTINEL</div>
          <p className="mt-1 text-xs uppercase tracking-[0.25em] text-slate-500">Restricted system · access is logged and audited</p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <form onSubmit={submit} className="space-y-3" aria-describedby="live-note">
            <h2 className="hud-title flex items-center gap-2">
              <KeyRound size={14} /> Operator sign-in
            </h2>
            <label className="block text-xs">
              <span className="hud-label">Username</span>
              <input
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm outline-none focus:border-cyan-400"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </label>
            <label className="block text-xs">
              <span className="hud-label">Password</span>
              <input
                type="password"
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm outline-none focus:border-cyan-400"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && (
              <p role="alert" className="flex items-center gap-1.5 text-xs text-red-400">
                <ShieldAlert size={14} /> {error}
              </p>
            )}
            <button className="hud-btn w-full justify-center py-2" disabled={busy || !backendOnline}>
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
            <p id="live-note" className="text-[11px] text-slate-500">
              {backendOnline ? 'Connected to the Sentinel API. Credentials are verified server-side (Argon2id, MFA-ready).' : 'API offline: live sign-in is unavailable. Use the demo console instead.'}
            </p>
          </form>
          <div className="space-y-3">
            <h2 className="hud-title">Demo console (offline)</h2>
            <p className="text-xs text-slate-400">Choose a role to see how role-based access control changes what is visible.</p>
            <div className="space-y-1.5" role="radiogroup" aria-label="Demo role">
              {DEMO_USERS.map((u) => (
                <button
                  key={u.role}
                  type="button"
                  role="radio"
                  aria-checked={role === u.role}
                  onClick={() => setRole(u.role)}
                  className={clsx(
                    'w-full rounded-md border px-3 py-2 text-left text-xs transition',
                    role === u.role ? 'border-cyan-300/70 bg-cyan-400/10' : 'border-slate-700 hover:border-slate-500',
                  )}
                >
                  <div className="font-medium text-slate-100">{u.name}</div>
                  <div className="text-[10px] text-slate-500">{PERMISSIONS[u.role].can.join(' · ')}</div>
                </button>
              ))}
            </div>
            <button className="hud-btn hud-btn-active w-full justify-center py-2" onClick={enterDemo}>
              Enter demo console
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
