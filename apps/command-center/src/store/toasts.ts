import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
}

interface ToastStore {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>, ttlMs?: number) => void;
  dismiss: (id: number) => void;
}

let next = 1;

export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (t, ttlMs = 6000) => {
    const id = next++;
    set({ toasts: [...get().toasts.slice(-4), { ...t, id }] });
    if (ttlMs > 0) setTimeout(() => get().dismiss(id), ttlMs);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));

/** Convenience for non-React code paths (e.g. the API layer). */
export const notify = (t: Omit<Toast, 'id'>, ttlMs?: number) => useToasts.getState().push(t, ttlMs);
