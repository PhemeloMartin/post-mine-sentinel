import clsx from 'clsx';
import type { ReactNode } from 'react';

export function Panel({ title, children, className, actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={clsx('hud-panel pointer-events-auto p-3', className)} aria-label={title}>
      {(title || actions) && (
        <header className="mb-2 flex items-center justify-between gap-2">
          {title && <h2 className="hud-title">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone = 'cyan' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'cyan' | 'amber' | 'red' | 'green' | 'slate' }) {
  const color = { cyan: 'text-cyan-200', amber: 'text-amber-300', red: 'text-red-400', green: 'text-emerald-300', slate: 'text-slate-200' }[tone];
  return (
    <div className="min-w-0">
      <div className="hud-label truncate">{label}</div>
      <div className={clsx('font-mono text-lg font-semibold leading-tight', color)}>{value}</div>
      {sub && <div className="truncate text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

export function Chip({ color, children, active = true, onClick, title }: { color: string; children: ReactNode; active?: boolean; onClick?: () => void; title?: string }) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      title={title}
      aria-pressed={onClick ? active : undefined}
      onClick={onClick}
      className={clsx('hud-chip transition', onClick && 'cursor-pointer hover:brightness-125', !active && 'opacity-35')}
      style={{ borderColor: `${color}80`, color, background: `${color}14` }}
    >
      {children}
    </Tag>
  );
}

export function Bar({ value, max = 1, color }: { value: number; max?: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800/80" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-slate-600 bg-slate-800 px-1 font-mono text-[10px] text-slate-300">{children}</kbd>;
}
