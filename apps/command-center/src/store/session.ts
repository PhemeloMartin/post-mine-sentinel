import { create } from 'zustand';
import type { Role, Session } from '@/types';

const KEY = 'pms.session';

/** Storage can throw (private mode, blocked site data) — never let that crash the app. */
function load(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function save(s: Session | null): void {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* non-fatal: session simply won't survive a reload */
  }
}

interface SessionStore {
  session: Session | null;
  backendOnline: boolean;
  login: (s: Session) => void;
  logout: () => void;
  setBackendOnline: (v: boolean) => void;
}

export const useSession = create<SessionStore>((set) => ({
  session: load(),
  backendOnline: false,
  login: (s) => {
    save(s);
    set({ session: s });
  },
  logout: () => {
    save(null);
    set({ session: null });
  },
  setBackendOnline: (v) => set({ backendOnline: v }),
}));

/** RBAC matrix mirrored from services/api/app/core/rbac.py (the server is authoritative). */
export const PERMISSIONS: Record<Role, { label: string; can: string[] }> = {
  admin: { label: 'System administrator', can: ['view_all', 'precise_location', 'live_alerts', 'manage_nodes', 'manage_users', 'view_audit', 'export'] },
  analyst: { label: 'SOC analyst (DMPR / CGS)', can: ['view_all', 'precise_location', 'live_alerts', 'plan_inspections', 'export'] },
  field_officer: { label: 'Field officer (SAPS / inspector)', can: ['precise_location', 'live_alerts', 'update_cases'] },
  auditor: { label: 'Auditor (AGSA / oversight)', can: ['view_all', 'view_audit'] },
  community_liaison: { label: 'Community liaison', can: ['view_generalised'] },
};

export const can = (role: Role | undefined, perm: string): boolean => !!role && PERMISSIONS[role].can.includes(perm);
