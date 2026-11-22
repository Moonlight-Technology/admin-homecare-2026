import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export type QueueRow = { key: string; icon: LucideIcon; title: ReactNode; subtitle?: ReactNode; status: ReactNode; meta?: ReactNode };

/** Record-card list used for queues; readable at every width instead of a squeezed table (DESIGN.md §4). */
export function QueueList({ rows, loading }: { rows: QueueRow[]; loading?: boolean }) {
  if (loading) {
    return (
      <ul className="divide-y divide-line">
        {[0, 1, 2].map((index) => (
          <li key={index} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-24" /></div>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {rows.map(({ key, icon: Icon, title, subtitle, status, meta }) => (
        <li key={key} className="flex gap-3 px-4 py-3.5 sm:items-center sm:px-5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500"><Icon className="size-4" aria-hidden /></span>
          {/* Mobile: status and time drop below the title so the title is never cut short. */}
          <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{title}</p>
              {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 sm:mt-0 sm:shrink-0">
              {status}
              {meta && <span className="whitespace-nowrap text-xs text-muted">{meta}</span>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
