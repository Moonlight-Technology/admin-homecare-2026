import { AlertTriangle, Inbox, RefreshCw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export function EmptyState({ title, description, icon: Icon = Inbox, action, className }: { title: string; description?: string; icon?: LucideIcon; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center px-4 py-10 text-center', className)}>
      <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-primary-50 text-primary-500">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center px-4 py-10 text-center', className)}>
      <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="size-5" aria-hidden />
      </span>
      <p className="font-semibold text-ink">Data gagal dimuat</p>
      <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw aria-hidden /> Coba lagi
        </Button>
      )}
    </div>
  );
}

export function Alert({ tone = 'danger', children, className }: { tone?: 'danger' | 'success' | 'info' | 'warning'; children: ReactNode; className?: string }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'rounded-[var(--radius-input)] px-3.5 py-3 text-sm',
        tone === 'danger' && 'bg-danger-soft text-danger',
        tone === 'success' && 'bg-success-soft text-success',
        tone === 'info' && 'bg-info-soft text-info',
        tone === 'warning' && 'bg-warning-soft text-warning',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FullPageLoader({ label = 'Memuat...' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center gap-2 text-sm text-muted" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-primary-500 border-r-transparent" aria-hidden />
      {label}
    </div>
  );
}
