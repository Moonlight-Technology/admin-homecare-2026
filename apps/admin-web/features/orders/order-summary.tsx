import { CheckCircle2, Circle, Clock, XCircle } from 'lucide-react';
import { MODE_LABELS, StatusBadge } from '@/components/status/status-badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatDateTime, formatIDR } from '@/lib/format';
import { SEX_LABELS, type OrderDetail } from './types';

/** Visit, patient (minimum necessary data, spec §5.5 step 4), and the address when the viewer may see it. */
export function VisitCard({ order }: { order: OrderDetail }) {
  const patient = order.patient;
  return (
    <Card>
      <CardHeader title="Kunjungan" />
      <CardBody>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <div><dt className="text-xs text-muted">Jadwal</dt><dd className="font-medium text-ink">{formatDateTime(order.scheduledAt)} · {order.durationMinutes} menit</dd></div>
          <div><dt className="text-xs text-muted">Mode</dt><dd className="font-medium text-ink">{MODE_LABELS[order.mode] ?? order.mode}</dd></div>
          <div><dt className="text-xs text-muted">Pasien</dt><dd className="font-medium text-ink">{patient.name}{patient.sex && ` · ${SEX_LABELS[patient.sex] ?? patient.sex}`}{patient.birthYear && ` · lahir ${patient.birthYear}`}</dd></div>
          <div><dt className="text-xs text-muted">Telepon</dt><dd className="font-medium text-ink">{patient.phone ?? '—'}</dd></div>
          {order.mode === 'HOMECARE' && order.address && <div className="sm:col-span-2"><dt className="text-xs text-muted">Alamat kunjungan</dt><dd className="font-medium text-ink">{order.address.line}{order.address.postalCode && ` ${order.address.postalCode}`}</dd>{order.address.note && <dd className="text-sm text-muted">Catatan: {order.address.note}</dd>}</div>}
          {order.mode === 'ON_SITE' && order.facilitySnapshot && <div className="sm:col-span-2"><dt className="text-xs text-muted">Lokasi</dt><dd className="font-medium text-ink">{order.facilitySnapshot.displayName} · {order.facilitySnapshot.addressLine}</dd></div>}
          <div><dt className="text-xs text-muted">Dipesan</dt><dd className="font-medium text-ink">{formatDateTime(order.createdAt)}</dd></div>
          <div><dt className="text-xs text-muted">Pembayaran</dt><dd className="font-medium text-ink">{order.paymentStatus === 'NOT_CONFIGURED' ? 'Belum diatur (di luar cakupan)' : order.paymentStatus}</dd></div>
        </dl>
        {order.rejectionReason && <p className="mt-4 rounded-[var(--radius-input)] bg-danger-soft px-3 py-2 text-sm text-danger">Alasan penolakan: {order.rejectionReason}</p>}
      </CardBody>
    </Card>
  );
}

/** Totals from the booking snapshot; never recomputed from current prices (AC-SVC-03). */
export function Totals({ order }: { order: OrderDetail }) {
  return (
    <dl className="space-y-1 border-t border-line pt-3 text-sm">
      <div className="flex justify-between"><dt className="text-muted">Subtotal layanan</dt><dd className="text-ink">{formatIDR(order.itemSubtotal)}</dd></div>
      {Number(order.feeTotal) > 0 && <div className="flex justify-between"><dt className="text-muted">Biaya kunjungan</dt><dd className="text-ink">{formatIDR(order.feeTotal)}</dd></div>}
      <div className="flex justify-between font-semibold"><dt className="text-ink">Total</dt><dd className="text-ink">{formatIDR(order.grandTotal)}</dd></div>
    </dl>
  );
}

const STEP_ICON: Record<string, typeof Circle> = { CONFIRMED: CheckCircle2, COMPLETED: CheckCircle2, IN_PROGRESS: Clock, REJECTED: XCircle };

/** Append-only status history with actor and time (spec §5.5). */
export function HistoryTimeline({ order }: { order: OrderDetail }) {
  return (
    <ol className="space-y-3">
      {order.history.map((entry) => {
        const Icon = STEP_ICON[entry.newStatus] ?? Circle;
        return (
          <li key={entry.id} className="flex gap-3">
            <Icon className="mt-0.5 size-4 shrink-0 text-primary-500" aria-hidden />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><StatusBadge status={entry.newStatus} /><span className="text-xs text-muted">{formatDateTime(entry.createdAt)}</span></div>
              <p className="mt-0.5 text-xs text-muted">{entry.actor ? `oleh ${entry.actor.name}` : 'oleh sistem pemesanan'}</p>
              {entry.reason && <p className="mt-1 text-sm text-ink">{entry.reason}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
