import { CheckCircle2, FileWarning, Send, XCircle } from 'lucide-react';
import { EmptyState } from '@/components/feedback/states';
import { DECISION_LABELS, type Review } from '@/features/facilities/types';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';

const DECISION_STYLE = {
  APPROVE: { icon: CheckCircle2, tone: 'bg-success-soft text-success' },
  REQUEST_REVISION: { icon: FileWarning, tone: 'bg-warning-soft text-warning' },
  REJECT: { icon: XCircle, tone: 'bg-danger-soft text-danger' },
} as const;

/** Practitioner review decisions, newest first; append-only like the facility timeline. */
export function ReviewList({ reviews }: { reviews: Review[] }) {
  if (!reviews.length) return <EmptyState icon={Send} title="Belum ada keputusan" description="Keputusan reviewer akan tercatat di sini." />;
  return (
    <ol className="space-y-3">
      {reviews.map((review) => {
        const style = DECISION_STYLE[review.decision];
        const Icon = style.icon;
        return (
          <li key={review.id} className="rounded-[var(--radius-input)] border border-line bg-app p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold', style.tone)}><Icon className="size-3" aria-hidden />{DECISION_LABELS[review.decision]}</span>
              <span className="text-muted">oleh {review.reviewer.name} · {formatDateTime(review.createdAt)}</span>
            </div>
            {review.reason && <p className="mt-1.5 whitespace-pre-line text-sm text-ink">{review.reason}</p>}
          </li>
        );
      })}
    </ol>
  );
}
