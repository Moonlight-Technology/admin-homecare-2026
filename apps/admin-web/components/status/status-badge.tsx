import { Ban, CheckCircle2, Circle, CircleDashed, Clock, FileWarning, Loader, PauseCircle, XCircle, type LucideIcon } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/badge';

type StatusMeta = { label: string; tone: BadgeTone; icon: LucideIcon };

/** One label + tone + icon per backend status, so meaning never depends on colour alone (DESIGN.md §3). */
const STATUSES: Record<string, StatusMeta> = {
  // Verification (facility, practitioner)
  DRAFT: { label: 'Draf', tone: 'neutral', icon: CircleDashed },
  SUBMITTED: { label: 'Menunggu review', tone: 'warning', icon: Clock },
  UNDER_REVIEW: { label: 'Sedang direview', tone: 'info', icon: Loader },
  VERIFIED: { label: 'Terverifikasi', tone: 'success', icon: CheckCircle2 },
  REVISION_REQUIRED: { label: 'Perlu revisi', tone: 'danger', icon: FileWarning },
  REJECTED: { label: 'Ditolak', tone: 'danger', icon: XCircle },
  // Operating status
  INACTIVE: { label: 'Nonaktif', tone: 'neutral', icon: PauseCircle },
  ACTIVE: { label: 'Aktif', tone: 'success', icon: CheckCircle2 },
  SUSPENDED: { label: 'Disuspend', tone: 'danger', icon: Ban },
  // Practitioner affiliations (REJECTED and ACTIVE above)
  PROPOSED: { label: 'Diusulkan', tone: 'warning', icon: Clock },
  ENDED: { label: 'Berakhir', tone: 'neutral', icon: Circle },
  // Service offerings (DRAFT above)
  PUBLISHED: { label: 'Dipublikasikan', tone: 'success', icon: CheckCircle2 },
  UNPUBLISHED: { label: 'Tidak tayang', tone: 'neutral', icon: PauseCircle },
  ARCHIVED: { label: 'Diarsipkan', tone: 'neutral', icon: Ban },
  // Orders
  PENDING_APPROVAL: { label: 'Menunggu persetujuan', tone: 'warning', icon: Clock },
  CONFIRMED: { label: 'Dikonfirmasi', tone: 'success', icon: CheckCircle2 },
  IN_PROGRESS: { label: 'Dalam proses', tone: 'info', icon: Loader },
  COMPLETED: { label: 'Selesai', tone: 'primary', icon: CheckCircle2 },
  // Order items / assignment
  PENDING: { label: 'Menunggu', tone: 'neutral', icon: Circle },
  NOT_PERFORMED: { label: 'Tidak dilakukan', tone: 'danger', icon: XCircle },
  UNASSIGNED: { label: 'Belum ditugaskan', tone: 'warning', icon: CircleDashed },
  PARTIALLY_ASSIGNED: { label: 'Sebagian ditugaskan', tone: 'info', icon: Loader },
  ASSIGNED: { label: 'Ditugaskan', tone: 'success', icon: CheckCircle2 },
};

export function statusMeta(status: string): StatusMeta {
  return STATUSES[status] ?? { label: status.replaceAll('_', ' ').toLowerCase(), tone: 'neutral', icon: Circle };
}

export function StatusBadge({ status }: { status: string }) {
  const { label, tone, icon: Icon } = statusMeta(status);
  return (
    <Badge tone={tone}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}

export const MODE_LABELS: Record<string, string> = { ON_SITE: 'On-site', HOMECARE: 'Homecare' };
