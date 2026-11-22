import { CheckCircle2, FileWarning, Send, XCircle } from 'lucide-react';
import { EmptyState } from '@/components/feedback/states';
import { StatusBadge } from '@/components/status/status-badge';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { DECISION_LABELS, type ApplicationVersion } from './types';

const DECISION_STYLE = {
  APPROVE: { icon: CheckCircle2, tone: 'bg-success-soft text-success' },
  REQUEST_REVISION: { icon: FileWarning, tone: 'bg-warning-soft text-warning' },
  REJECT: { icon: XCircle, tone: 'bg-danger-soft text-danger' },
} as const;

/** Immutable verification history: every submitted version and every decision, newest first (AC-FAC-04). */
export function VerificationTimeline({ history }: { history: ApplicationVersion[] }) {
  if (!history.length) return <EmptyState icon={Send} title="Belum ada pengajuan" description="Riwayat verifikasi akan muncul setelah pengajuan pertama dikirim." />;
  return (
    <ol className="space-y-5">
      {history.map((version) => (
        <li key={version.id} className="relative pl-9">
          <span className="absolute left-0 top-0 flex size-7 items-center justify-center rounded-full bg-primary-50 text-xs font-bold text-primary-700">v{version.version}</span>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-ink">Pengajuan versi {version.version}</p>
            <StatusBadge status={version.status === 'APPROVED' ? 'VERIFIED' : version.status} />
          </div>
          <p className="text-xs text-muted">Dikirim {formatDateTime(version.submittedAt)}</p>
          {version.reviews.map((review) => {
            const style = DECISION_STYLE[review.decision];
            const Icon = style.icon;
            return (
              <div key={review.id} className="mt-2.5 rounded-[var(--radius-input)] border border-line bg-app p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold', style.tone)}><Icon className="size-3" aria-hidden />{DECISION_LABELS[review.decision]}</span>
                  <span className="text-muted">oleh {review.reviewer.name} · {formatDateTime(review.createdAt)}</span>
                </div>
                {review.reason && <p className="mt-1.5 whitespace-pre-line text-sm text-ink">{review.reason}</p>}
              </div>
            );
          })}
        </li>
      ))}
    </ol>
  );
}
