import type { LucideIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';

const TONES = {
  primary: 'bg-primary-50 text-primary-500',
  info: 'bg-info-soft text-info',
  warning: 'bg-warning-soft text-warning',
  success: 'bg-success-soft text-success',
} as const;

/**
 * A single real KPI from the API. No trend arrows or percentages: the backend has no period comparison yet,
 * and DESIGN.md forbids fabricated growth figures.
 */
export function KpiCard({ label, value, hint, icon: Icon, tone = 'primary', loading }: { label: string; value: number | undefined; hint?: string; icon: LucideIcon; tone?: keyof typeof TONES; loading?: boolean }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(23,52,59,0.04)]">
      <div className="flex items-start gap-3">
        <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', TONES[tone])}>
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted">{label}</p>
          {loading || value === undefined ? <Skeleton className="mt-2 h-7 w-14" /> : <p className="mt-1 text-2xl font-bold text-ink">{formatNumber(value)}</p>}
          {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
        </div>
      </div>
    </div>
  );
}
