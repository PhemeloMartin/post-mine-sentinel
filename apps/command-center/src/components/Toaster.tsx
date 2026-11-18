import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToasts, type ToastKind } from '@/store/toasts';

const ICON: Record<ToastKind, JSX.Element> = {
  info: <Info size={16} className="text-cyan-300" aria-hidden />,
  success: <CheckCircle2 size={16} className="text-emerald-300" aria-hidden />,
  warning: <AlertTriangle size={16} className="text-amber-300" aria-hidden />,
  error: <XCircle size={16} className="text-red-400" aria-hidden />,
};

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-24 right-4 z-50 flex w-80 flex-col gap-2" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className="hud-panel pointer-events-auto flex items-start gap-2 p-3 text-xs">
          {ICON[t.kind]}
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-slate-100">{t.title}</div>
            {t.detail && <div className="mt-0.5 text-slate-400">{t.detail}</div>}
          </div>
          <button className="text-slate-500 hover:text-slate-200" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
