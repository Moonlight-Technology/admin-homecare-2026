'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCheck, Play, UserPlus, X } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/fields';
import { FormField } from '@/components/ui/input';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { HistoryTimeline, Totals, VisitCard } from '@/features/orders/order-summary';
import { RescheduleDialog } from '@/features/orders/reschedule-dialog';
import type { AssignablePractitioner, OrderDetail, OrderItem } from '@/features/orders/types';
import { useAuth } from '@/lib/auth/auth-provider';
import { canFacility } from '@/lib/auth/types';
import { api } from '@/lib/api/client';
import { formatDateTime, formatIDR } from '@/lib/format';

/** Pick an affiliated practitioner for the whole visit or one service; conflicts are shown and enforced by the API. */
function AssignDialog({ order, open, onOpenChange, onAssigned }: { order: OrderDetail; open: boolean; onOpenChange: (open: boolean) => void; onAssigned: (order: OrderDetail) => void }) {
  const [practitionerId, setPractitionerId] = useState('');
  const [orderItemId, setOrderItemId] = useState('');
  const candidates = useQuery({ queryKey: ['clinic', 'order', order.id, 'assignable'], queryFn: () => api<AssignablePractitioner[]>(`/clinic/orders/${order.id}/assignable-practitioners`), enabled: open });
  const assign = useMutation({
    mutationFn: () => api<OrderDetail>(`/clinic/orders/${order.id}/assignments`, { method: 'POST', body: { practitionerId, ...(orderItemId ? { orderItemId } : {}) } }),
    onSuccess: (data) => { onAssigned(data); onOpenChange(false); setPractitionerId(''); setOrderItemId(''); },
  });
  const chosen = candidates.data?.find((candidate) => candidate.id === practitionerId);
  return (
    <Dialog open={open} onOpenChange={(next) => !assign.isPending && onOpenChange(next)} title="Tugaskan tenaga kesehatan" description="Hanya nakes aktif yang berafiliasi dengan klinik pada tanggal kunjungan." footer={<><Button variant="secondary" onClick={() => onOpenChange(false)} disabled={assign.isPending}>Batal</Button><Button loading={assign.isPending} disabled={!practitionerId || Boolean(chosen?.conflict)} onClick={() => assign.mutate()}>Tugaskan</Button></>}>
      <div className="space-y-4">
        {assign.error && <Alert>{assign.error.message}</Alert>}
        {candidates.error && <Alert>{candidates.error.message}</Alert>}
        {candidates.data && !candidates.data.length && <Alert tone="warning">Belum ada nakes aktif yang berafiliasi. Tambahkan lewat menu Tenaga Kesehatan.</Alert>}
        <FormField label="Tenaga kesehatan" required hint={chosen?.conflict ? `Bentrok dengan ${chosen.conflict.orderCode} (${formatDateTime(chosen.conflict.scheduledAt)}).` : undefined}>
          {(props) => <Select {...props} value={practitionerId} onChange={(event) => setPractitionerId(event.target.value)}><option value="" disabled>{candidates.isLoading ? 'Memuat...' : 'Pilih nakes'}</option>{(candidates.data ?? []).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.fullName} · {candidate.practitionerType.name}{candidate.conflict ? ' (bentrok jadwal)' : ''}</option>)}</Select>}
        </FormField>
        {order.items.length > 1 && (
          <FormField label="Untuk" hint="Pilih satu layanan bila nakes berbeda per layanan.">
            {(props) => <Select {...props} value={orderItemId} onChange={(event) => setOrderItemId(event.target.value)}><option value="">Seluruh kunjungan</option>{order.items.map((item) => <option key={item.id} value={item.id}>{item.nameSnapshot}</option>)}</Select>}
          </FormField>
        )}
      </div>
    </Dialog>
  );
}

function ItemRow({ order, item, canProgress, onChanged }: { order: OrderDetail; item: OrderItem; canProgress: boolean; onChanged: (order: OrderDetail) => void }) {
  const [notPerformed, setNotPerformed] = useState(false);
  const update = useMutation({
    mutationFn: (body: { status: 'IN_PROGRESS' | 'COMPLETED' | 'NOT_PERFORMED'; reason?: string }) => api<OrderDetail>(`/clinic/orders/${order.id}/items/${item.id}/status`, { method: 'PATCH', body }),
    onSuccess: (data) => { onChanged(data); setNotPerformed(false); },
  });
  const assignee = order.assignments.filter((assignment) => assignment.orderItemId === item.id || assignment.orderItemId === null);
  const open = order.status === 'IN_PROGRESS' && ['PENDING', 'IN_PROGRESS'].includes(item.status);
  return (
    <li className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-ink">{item.nameSnapshot}{item.quantity > 1 && ` × ${item.quantity}`}</p><StatusBadge status={item.status} /></div>
        <p className="text-xs text-muted">{formatIDR(item.priceSnapshot)} · {item.durationMinutes} menit{assignee.length ? ` · ${assignee.map((assignment) => assignment.practitioner.fullName).join(', ')}` : ''}</p>
        {item.notPerformedReason && <p className="text-xs text-danger">Tidak dilakukan: {item.notPerformedReason}</p>}
        {update.error && <p className="text-xs text-danger">{update.error.message}</p>}
      </div>
      {canProgress && open && (
        <div className="flex shrink-0 gap-2">
          {item.status === 'PENDING' && <Button variant="secondary" size="sm" loading={update.isPending} onClick={() => update.mutate({ status: 'IN_PROGRESS' })}>Mulai</Button>}
          <Button variant="secondary" size="sm" onClick={() => setNotPerformed(true)}>Tidak dilakukan</Button>
          <Button size="sm" loading={update.isPending} onClick={() => update.mutate({ status: 'COMPLETED' })}><Check />Selesai</Button>
        </div>
      )}
      <ReasonDialog open={notPerformed} onOpenChange={setNotPerformed} title="Layanan tidak dilakukan?" description="Tulis alasan operasional saja, tanpa catatan klinis." label="Alasan" confirmLabel="Tandai tidak dilakukan" destructive loading={update.isPending} error={update.error?.message} onConfirm={(reason) => update.mutate({ status: 'NOT_PERFORMED', reason })} />
    </li>
  );
}

export default function ClinicOrderDetailPage() {
  const id = useParams<{ id: string }>().id;
  const queryClient = useQueryClient();
  const { me } = useAuth();
  const canApprove = canFacility(me, 'order:approve');
  const canAssign = canFacility(me, 'order:assign');
  const canProgress = canFacility(me, 'order:progress');
  const [dialog, setDialog] = useState<'approve' | 'reject' | 'cancel' | 'no-show' | 'reschedule' | 'assign' | 'start' | 'complete' | null>(null);
  const detail = useQuery({ queryKey: ['clinic', 'order', id], queryFn: () => api<OrderDetail>(`/clinic/orders/${id}`) });
  const refresh = (data: OrderDetail) => { queryClient.setQueryData(['clinic', 'order', id], data); void queryClient.invalidateQueries({ queryKey: ['/clinic/orders'] }); };
  const action = useMutation({
    mutationFn: ({ name, body }: { name: 'approve' | 'reject' | 'cancel' | 'no-show' | 'start' | 'complete'; body?: unknown }) => api<OrderDetail>(`/clinic/orders/${id}/${name}`, { method: 'POST', body }),
    onSuccess: (data) => { refresh(data); setDialog(null); },
    onError: () => { if (dialog === 'approve') setDialog(null); void queryClient.invalidateQueries({ queryKey: ['clinic', 'order', id] }); void queryClient.invalidateQueries({ queryKey: ['/clinic/orders'] }); },
  });
  const unassign = useMutation({ mutationFn: (assignmentId: string) => api<OrderDetail>(`/clinic/orders/${id}/assignments/${assignmentId}`, { method: 'DELETE' }), onSuccess: refresh });

  const breadcrumbs = [{ label: 'Order', href: '/clinic/orders' }, { label: 'Detail' }];
  if (detail.error) return <><PageHeader title="Detail order" breadcrumbs={breadcrumbs} /><Card><ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} /></Card></>;
  if (!detail.data) return <div className="py-20 text-center text-sm text-muted">Memuat order...</div>;
  const order = detail.data;
  const assignable = ['CONFIRMED', 'IN_PROGRESS'].includes(order.status);
  const allTerminal = order.items.every((item) => ['COMPLETED', 'NOT_PERFORMED'].includes(item.status));

  return (
    <>
      <PageHeader
        title={order.code}
        breadcrumbs={breadcrumbs}
        description={`${formatDateTime(order.scheduledAt, order.timezone)} (${order.timezone}) · ${order.patient.name}`}
        actions={<>
          <StatusBadge status={order.status} />
          {assignable && <StatusBadge status={order.assignmentStatus} />}
          {canApprove && ['PENDING_APPROVAL', 'CONFIRMED'].includes(order.status) && <Button variant="destructive" disabled={action.isPending || unassign.isPending} onClick={() => { action.reset(); setDialog('cancel'); }}><X />Batalkan order</Button>}
          {canApprove && order.status === 'CONFIRMED' && order.items.every((item) => item.status === 'PENDING') && <Button variant="secondary" disabled={action.isPending || unassign.isPending} onClick={() => setDialog('reschedule')}>Ubah jadwal</Button>}
          {canApprove && order.status === 'PENDING_APPROVAL' && <><Button variant="destructive" onClick={() => setDialog('reject')}><X />Tolak</Button><Button onClick={() => setDialog('approve')}><Check />Setujui</Button></>}
          {canAssign && assignable && <Button variant="secondary" onClick={() => setDialog('assign')}><UserPlus />Tugaskan nakes</Button>}
          {canProgress && order.status === 'CONFIRMED' && <Button disabled={order.assignmentStatus !== 'ASSIGNED'} title={order.assignmentStatus !== 'ASSIGNED' ? 'Tugaskan nakes ke semua layanan terlebih dahulu' : undefined} onClick={() => setDialog('start')}><Play />Mulai kunjungan</Button>}
          {canProgress && order.status === 'CONFIRMED' && order.items.every((item) => item.status === 'PENDING') && <Button variant="destructive" disabled={action.isPending || unassign.isPending} onClick={() => { action.reset(); setDialog('no-show'); }}><X />Tandai tidak hadir</Button>}
          {canProgress && order.status === 'IN_PROGRESS' && <Button disabled={!allTerminal} title={!allTerminal ? 'Selesaikan atau tandai semua layanan terlebih dahulu' : undefined} onClick={() => setDialog('complete')}><CheckCheck />Selesaikan order</Button>}
        </>}
      />
      {action.error && !dialog && <Alert className="mb-5">{action.error.message}</Alert>}
      {unassign.error && <Alert className="mb-5">{unassign.error.message}</Alert>}
      {order.status === 'PENDING_APPROVAL' && <Alert tone="info" className="mb-5">Order disetujui atau ditolak secara utuh. Item dan harga tidak dapat diubah saat persetujuan.</Alert>}
      {order.status === 'CANCELLED' && <Alert tone="warning" className="mb-5">Order dibatalkan. Kapasitas yang dipesan dan penugasan nakes sudah dilepas. Pembatalan tidak memproses pembayaran atau refund.</Alert>}
      {order.status === 'EXPIRED' && <Alert tone="warning" className="mb-5">Batas waktu persetujuan telah berakhir. Order tidak bisa disetujui atau dibuka kembali. Pembayaran dan refund tidak diproses otomatis.</Alert>}
      {order.status === 'NO_SHOW' && <Alert tone="warning" className="mb-5">Pasien ditandai tidak hadir. Layanan tidak dilakukan dan penugasan ditutup. Slot lampau tetap tercatat; pembayaran, denda, dan refund tidak diubah.</Alert>}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="space-y-5">
          <VisitCard order={order} />
          <Card>
            <CardHeader title="Layanan" description="Nama dan harga tersimpan saat pemesanan." />
            <CardBody className="pt-0">
              <ul className="divide-y divide-line">{order.items.map((item) => <ItemRow key={item.id} order={order} item={item} canProgress={canProgress} onChanged={refresh} />)}</ul>
              <Totals order={order} />
            </CardBody>
          </Card>
          {assignable && (
            <Card>
              <CardHeader title="Penugasan" />
              <CardBody className="pt-0">
                {order.assignments.length ? <ul className="divide-y divide-line">{order.assignments.map((assignment) => (
                  <li key={assignment.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5">
                    <div><p className="font-medium text-ink">{assignment.practitioner.fullName}</p><p className="text-xs text-muted">{assignment.practitioner.practitionerType.name} · {assignment.orderItemId ? order.items.find((item) => item.id === assignment.orderItemId)?.nameSnapshot : 'Seluruh kunjungan'} · oleh {assignment.assignedBy.name}</p></div>
                    {canAssign && <Button variant="ghost" size="sm" loading={unassign.isPending} onClick={() => unassign.mutate(assignment.id)}>Lepas</Button>}
                  </li>
                ))}</ul> : <p className="py-4 text-sm text-muted">Belum ada nakes yang ditugaskan.</p>}
              </CardBody>
            </Card>
          )}
        </div>
        <Card><CardHeader title="Riwayat status" /><CardBody><HistoryTimeline order={order} /></CardBody></Card>
      </div>
      <AssignDialog order={order} open={dialog === 'assign'} onOpenChange={(open) => setDialog(open ? 'assign' : null)} onAssigned={refresh} />
      <ReasonDialog open={dialog === 'no-show'} onOpenChange={(open) => !open && setDialog(null)} title="Tandai pasien tidak hadir?" description="Hanya setelah jadwal ditambah seluruh durasi layanan berakhir dan kunjungan belum dimulai. Semua layanan ditandai tidak dilakukan, penugasan ditutup, dan slot lampau tetap tercatat. Tidak mengubah pembayaran, denda, atau refund." label="Alasan tidak hadir" hint="Alasan operasional 5–1000 karakter; jangan isi data klinis pasien." maxLength={1000} confirmLabel="Tandai tidak hadir" destructive loading={action.isPending} error={action.error?.message} onConfirm={(reason) => action.mutate({ name: 'no-show', body: { reason } })} />
      <RescheduleDialog order={order} open={dialog === 'reschedule'} onOpenChange={(open) => setDialog(open ? 'reschedule' : null)} onChanged={refresh} />
      <ConfirmDialog
        open={dialog === 'approve' || dialog === 'start' || dialog === 'complete'}
        onOpenChange={(open) => !action.isPending && !open && setDialog(null)}
        title={dialog === 'approve' ? 'Setujui order?' : dialog === 'start' ? 'Mulai kunjungan?' : 'Selesaikan order?'}
        description={dialog === 'approve' ? 'Order dikonfirmasi dan kapasitas slot dipakai. Bila slot sudah penuh, persetujuan ditolak.' : dialog === 'start' ? 'Status berubah menjadi dalam proses.' : 'Order ditutup sebagai selesai.'}
        confirmLabel={dialog === 'approve' ? 'Setujui order' : dialog === 'start' ? 'Mulai kunjungan' : 'Selesaikan'}
        loading={action.isPending}
        onConfirm={() => dialog && dialog !== 'reject' && dialog !== 'cancel' && dialog !== 'no-show' && dialog !== 'reschedule' && dialog !== 'assign' && action.mutate({ name: dialog })}
      >
        {action.error && <Alert>{action.error.message}</Alert>}
      </ConfirmDialog>
      <ReasonDialog open={dialog === 'reject'} onOpenChange={(open) => !open && setDialog(null)} title="Tolak order?" description="Alasan disimpan di riwayat dan dikirim sebagai notifikasi ke pelanggan." label="Alasan penolakan" confirmLabel="Tolak order" destructive loading={action.isPending} error={action.error?.message} onConfirm={(reason) => action.mutate({ name: 'reject', body: { reason } })} />
      <ReasonDialog open={dialog === 'cancel'} onOpenChange={(open) => !open && setDialog(null)} title="Batalkan order?" description="Order tidak dapat dibuka kembali. Slot yang dipesan dan penugasan nakes dilepas; alasan masuk riwayat serta antrean notifikasi. Tidak memproses pembayaran atau refund." label="Alasan pembatalan" hint="Alasan operasional 5–1000 karakter, tanpa informasi klinis pasien." maxLength={1000} confirmLabel="Batalkan order" destructive loading={action.isPending} error={action.error?.message} onConfirm={(reason) => action.mutate({ name: 'cancel', body: { reason } })} />
    </>
  );
}
