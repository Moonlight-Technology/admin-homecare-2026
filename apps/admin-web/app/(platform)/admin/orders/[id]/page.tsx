'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { Alert, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status/status-badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { HistoryTimeline, Totals, VisitCard } from '@/features/orders/order-summary';
import type { OrderDetail } from '@/features/orders/types';
import { api } from '@/lib/api/client';
import { formatDateTime, formatIDR } from '@/lib/format';

/** Read-only platform view: masked patient, no visit address (least privilege, spec §8). */
export default function AdminOrderDetailPage() {
  const id = useParams<{ id: string }>().id;
  const detail = useQuery({ queryKey: ['admin', 'order', id], queryFn: () => api<OrderDetail>(`/admin/orders/${id}`) });
  const breadcrumbs = [{ label: 'Order', href: '/admin/orders' }, { label: 'Detail' }];
  if (detail.error) return <><PageHeader title="Detail order" breadcrumbs={breadcrumbs} /><Card><ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} /></Card></>;
  if (!detail.data) return <div className="py-20 text-center text-sm text-muted">Memuat order...</div>;
  const order = detail.data;
  return (
    <>
      <PageHeader title={order.code} breadcrumbs={breadcrumbs} description={`${order.facility?.displayName ?? 'Klinik'} · ${formatDateTime(order.scheduledAt, order.timezone)} (${order.timezone})`} actions={<><StatusBadge status={order.status} /><StatusBadge status={order.assignmentStatus} /></>} />
      <Alert tone="info" className="mb-5">Tampilan baca saja. Identitas pasien disamarkan dan alamat kunjungan disembunyikan.</Alert>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="space-y-5">
          <VisitCard order={order} />
          <Card>
            <CardHeader title="Layanan" />
            <CardBody className="pt-0">
              <ul className="divide-y divide-line">{order.items.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3.5"><div><p className="font-medium text-ink">{item.nameSnapshot}{item.quantity > 1 && ` × ${item.quantity}`}</p><p className="text-xs text-muted">{formatIDR(item.priceSnapshot)} · {item.durationMinutes} menit</p></div><StatusBadge status={item.status} /></li>)}</ul>
              <Totals order={order} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Penugasan" />
            <CardBody className="pt-0">{order.assignments.length ? <ul className="divide-y divide-line">{order.assignments.map((assignment) => <li key={assignment.id} className="py-3.5"><p className="font-medium text-ink">{assignment.practitioner.fullName}</p><p className="text-xs text-muted">{assignment.practitioner.practitionerType.name} · oleh {assignment.assignedBy.name}</p></li>)}</ul> : <p className="py-4 text-sm text-muted">Belum ada penugasan.</p>}</CardBody>
          </Card>
        </div>
        <Card><CardHeader title="Riwayat status" /><CardBody><HistoryTimeline order={order} /></CardBody></Card>
      </div>
    </>
  );
}
