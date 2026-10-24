import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/utils/cn';
import { initials } from '@/utils/format';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-border bg-surface shadow-soft', className)} {...props} />;
}

export function CardHeader({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-border px-5 py-4', className)}>
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
const tones: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning',
  danger: 'bg-danger-soft text-danger',
};

export function Badge({ tone = 'neutral', className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium', tones[tone], className)}>{children}</span>;
}

const statusTone: Record<string, Tone> = {
  CONFIRMED: 'success', COMPLETED: 'neutral', PENDING_PAYMENT: 'warning', CANCELLED: 'danger', EXPIRED: 'neutral', PAYMENT_FAILED: 'danger',
  CAPTURED: 'success', CREATED: 'warning', AUTHORIZED: 'warning', FAILED: 'danger', REFUNDED: 'neutral', PARTIALLY_REFUNDED: 'neutral',
  PENDING: 'warning', SUBMITTED: 'accent', PROCESSED: 'success', APPROVED: 'success', REJECTED: 'danger', SUSPENDED: 'danger',
  ACTIVE: 'success', DEACTIVATED: 'neutral', DELETED: 'neutral', READY: 'success', NOT_CONFIGURED: 'neutral', SUCCEEDED: 'success', DEAD: 'danger', RUNNING: 'accent',
  OPEN: 'warning', IN_PROGRESS: 'accent', RESOLVED: 'success', CLOSED: 'neutral', REVOKED: 'danger', ERROR: 'danger', SENT: 'success', SKIPPED: 'neutral',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={statusTone[status] ?? 'neutral'}>{label ?? status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-lg bg-muted', className)} />;
}

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className={cn('size-4 animate-spin', className)} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 grid size-11 place-items-center rounded-xl bg-accent-soft text-accent [&_svg]:size-5">{icon}</div>}
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const alertIcons = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle };
export function Alert({ tone = 'info', title, children, action, className }: { tone?: 'info' | 'success' | 'warning' | 'danger'; title?: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  const Icon = alertIcons[tone];
  const t = { info: 'bg-accent-soft/60 border-accent/20 text-foreground [&>svg]:text-accent', success: 'bg-success-soft border-success/25 [&>svg]:text-success', warning: 'bg-warning-soft border-warning/30 [&>svg]:text-warning', danger: 'bg-danger-soft border-danger/25 [&>svg]:text-danger' }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-xl border px-4 py-3 text-sm', t, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn('text-[13.5px] leading-relaxed', title && 'mt-0.5 text-muted-foreground')}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Avatar({ name, src, size = 40, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} className={cn('rounded-full object-cover', className)} style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold text-white', className)}
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, oklch(0.62 0.15 ${hue}), oklch(0.5 0.17 ${(hue + 40) % 360}))` }}
    >
      {initials(name)}
    </span>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="mb-1 text-[12px] font-medium uppercase tracking-[0.12em] text-accent">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-[12.5px] text-muted-foreground">{hint}</p>}
    </Card>
  );
}

export function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
      <span className="text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <button className="rounded-lg border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button className="rounded-lg border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-40" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </nav>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert tone="danger" title="Couldn't load this" action={onRetry && <button onClick={onRetry} className="text-sm font-medium underline underline-offset-4">Retry</button>}>
      {message}
    </Alert>
  );
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-2xl border border-border bg-surface shadow-soft', className)}>
      <table className="w-full min-w-[640px] text-left text-sm [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-[12px] [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground [&_thead]:border-b [&_thead]:border-border [&_thead]:bg-surface-2 [&_tbody_tr]:border-b [&_tbody_tr]:border-border [&_tbody_tr:last-child]:border-0 [&_tbody_tr:hover]:bg-surface-2/60">
        {children}
      </table>
    </div>
  );
}
