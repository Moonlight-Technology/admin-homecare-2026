'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, FileWarning, Play, X } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import type { ApplicationDetail, Review } from '@/features/facilities/types';
import { VerificationTimeline } from '@/features/facilities/verification-timeline';
import { api } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format';

export default function FacilityApplicationDetailPage() {
  const id = useParams<{ id: string }>().id;
  const queryClient = useQueryClient();
  const [approveOpen, setApproveOpen] = useState(false);
  const [reasonAction, setReasonAction] = useState<Review['decision'] | null>(null);
  const detail = useQuery({ queryKey: ['facility-application', id], queryFn: () => api<ApplicationDetail>(`/admin/facility-applications/${id}`) });
  const refresh = (data: ApplicationDetail) => { queryClient.setQueryData(['facility-application', id], data); void queryClient.invalidateQueries({ queryKey: ['facility-applications'] }); };
  const start = useMutation({ mutationFn: () => api<ApplicationDetail>(`/admin/facility-applications/${id}/start-review`, { method: 'POST' }), onSuccess: refresh });
  const decide = useMutation({ mutationFn: (body: { decision: Review['decision']; reason?: string }) => api<ApplicationDetail>(`/admin/facility-applications/${id}/reviews`, { method: 'POST', body }), onSuccess: (data) => { refresh(data); setApproveOpen(false); setReasonAction(null); } });

  if (detail.error) return <><PageHeader title="Detail pengajuan" breadcrumbs={[{ label: 'Verifikasi klinik', href: '/admin/facility-applications' }, { label: 'Detail' }]} /><Card><ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} /></Card></>;
  if (!detail.data) return <div className="py-20 text-center text-sm text-muted">Memuat pengajuan...</div>;
  const data = detail.data;
  const open = ['SUBMITTED', 'UNDER_REVIEW'].includes(data.application.status) && data.isLatest;
  const snapshot = data.application.profileSnapshot;

  return (
    <>
      <PageHeader title={data.facility.displayName} breadcrumbs={[{ label: 'Verifikasi klinik', href: '/admin/facility-applications' }, { label: `Versi ${data.application.version}` }]} description={`Dikirim ${formatDateTime(data.application.submittedAt)}${data.application.submittedBy ? ` oleh ${data.application.submittedBy.name}` : ''}`} actions={<><StatusBadge status={data.application.status === 'APPROVED' ? 'VERIFIED' : data.application.status} />{data.application.status === 'SUBMITTED' && data.isLatest && <Button variant="secondary" loading={start.isPending} onClick={() => start.mutate()}><Play />Mulai review</Button>}{open && <><Button variant="soft" onClick={() => setReasonAction('REQUEST_REVISION')}><FileWarning />Minta revisi</Button><Button variant="destructive" onClick={() => setReasonAction('REJECT')}><X />Tolak</Button><Button onClick={() => setApproveOpen(true)}><Check />Setujui</Button></>}</>} />
      {(start.error || decide.error) && <Alert className="mb-5">{(start.error ?? decide.error)?.message}</Alert>}
      {!data.isLatest && <Alert tone="warning" className="mb-5">Ini versi lama. Keputusan hanya dapat diberikan pada versi pengajuan terbaru.</Alert>}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="space-y-5">
          <Card><CardHeader title="Profil saat diajukan" description="Snapshot yang dikunci ketika klinik mengirim versi ini." /><CardBody><dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2"><div><dt className="text-xs text-muted">Nama legal</dt><dd className="font-medium text-ink">{String(snapshot.legalName ?? data.facility.legalName)}</dd></div><div><dt className="text-xs text-muted">Jenis fasilitas</dt><dd className="font-medium text-ink">{data.facility.facilityType.name}</dd></div><div><dt className="text-xs text-muted">Telepon</dt><dd className="font-medium text-ink">{String(snapshot.phone ?? '—')}</dd></div><div><dt className="text-xs text-muted">Email</dt><dd className="font-medium text-ink">{String(snapshot.email ?? '—')}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-muted">Alamat</dt><dd className="font-medium text-ink">{String(snapshot.addressLine ?? data.facility.addressLine)}</dd></div></dl></CardBody></Card>
          <Card><CardHeader title="Checklist dokumen" /><CardBody className="pt-0"><ul className="divide-y divide-line">{data.checklist.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-semibold text-ink">{item.name}{item.mandatory && <span className="ml-2 text-xs text-danger">Wajib</span>}</p><p className="text-xs text-muted">{item.document?.fileName ?? 'Tidak dilampirkan'}</p></div>{item.document?.url && <Button asChild variant="secondary" size="sm"><a href={item.document.url} target="_blank" rel="noreferrer"><ExternalLink />Lihat dokumen</a></Button>}</li>)}</ul></CardBody></Card>
        </div>
        <Card><CardHeader title="Riwayat verifikasi" /><CardBody><VerificationTimeline history={data.history} /></CardBody></Card>
      </div>
      <ConfirmDialog open={approveOpen} onOpenChange={setApproveOpen} title="Setujui klinik?" description="Klinik akan terverifikasi dan diaktifkan." confirmLabel="Setujui klinik" loading={decide.isPending} onConfirm={() => decide.mutate({ decision: 'APPROVE' })} />
      <ReasonDialog open={reasonAction !== null} onOpenChange={(openDialog) => !openDialog && setReasonAction(null)} title={reasonAction === 'REJECT' ? 'Tolak pengajuan?' : 'Minta revisi?'} description="Catatan akan terlihat oleh klinik dan tersimpan permanen pada riwayat." label="Catatan reviewer" confirmLabel={reasonAction === 'REJECT' ? 'Tolak pengajuan' : 'Kirim permintaan revisi'} destructive={reasonAction === 'REJECT'} loading={decide.isPending} error={decide.error?.message} onConfirm={(reason) => reasonAction && decide.mutate({ decision: reasonAction, reason })} />
    </>
  );
}
