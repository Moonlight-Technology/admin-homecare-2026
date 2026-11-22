'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, EyeOff, Rocket, Save } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { OfferingForm } from '@/features/catalog/offering-form';
import { BLOCKER_LABELS, offeringPayload, offeringValues, type Offering, type OfferingValues } from '@/features/catalog/types';
import { useAuth } from '@/lib/auth/auth-provider';
import { canFacility } from '@/lib/auth/types';
import { api, ApiError } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format';

export default function ServiceDetailPage() {
  const id = useParams<{ id: string }>().id;
  const queryClient = useQueryClient();
  const { me } = useAuth();
  const canUpdate = canFacility(me, 'offering:update');
  const canPublish = canFacility(me, 'offering:publish');
  const [values, setValues] = useState<OfferingValues | null>(null);
  const [confirm, setConfirm] = useState<'publish' | 'unpublish' | 'archive' | null>(null);
  const detail = useQuery({ queryKey: ['clinic', 'offering', id], queryFn: () => api<Offering>(`/clinic/offerings/${id}`) });
  useEffect(() => { if (detail.data && !values) setValues(offeringValues(detail.data)); }, [detail.data, values]);

  const refresh = (offering: Offering) => { queryClient.setQueryData(['clinic', 'offering', id], offering); setValues(offeringValues(offering)); void queryClient.invalidateQueries({ queryKey: ['clinic', 'offerings'] }); };
  const save = useMutation({ mutationFn: () => api<Offering>(`/clinic/offerings/${id}`, { method: 'PATCH', body: offeringPayload(values!, detail.data?.status === 'DRAFT') }), onSuccess: refresh });
  const action = useMutation({ mutationFn: (name: 'publish' | 'unpublish' | 'archive') => api<Offering>(`/clinic/offerings/${id}/${name}`, { method: 'POST' }), onSuccess: (offering) => { refresh(offering); setConfirm(null); } });

  const breadcrumbs = [{ label: 'Layanan', href: '/clinic/services' }, { label: 'Detail' }];
  if (detail.error) return <><PageHeader title="Detail layanan" breadcrumbs={breadcrumbs} /><Card><ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} /></Card></>;
  if (!detail.data || !values) return <div className="py-20 text-center text-sm text-muted">Memuat layanan...</div>;
  const offering = detail.data;
  const archived = offering.status === 'ARCHIVED';
  const dirty = JSON.stringify(values) !== JSON.stringify(offeringValues(offering));
  const blockers = offering.publishBlockers;
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const actionError = action.error instanceof ApiError ? action.error : null;

  return (
    <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <PageHeader
        title={offering.name}
        breadcrumbs={breadcrumbs}
        description={offering.publishedAt ? `Terakhir dipublikasikan ${formatDateTime(offering.publishedAt)}` : 'Belum pernah dipublikasikan'}
        actions={<>
          <StatusBadge status={offering.status} />
          {canUpdate && !archived && <Button type="submit" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} loading={save.isPending}><Save />Simpan perubahan</Button>}
          {canPublish && (offering.status === 'DRAFT' || offering.status === 'UNPUBLISHED') && <Button type="button" disabled={dirty || blockers.length > 0} title={dirty ? 'Simpan perubahan terlebih dahulu' : undefined} onClick={() => setConfirm('publish')}><Rocket />Publikasikan</Button>}
          {canPublish && offering.status === 'PUBLISHED' && <Button type="button" variant="secondary" onClick={() => setConfirm('unpublish')}><EyeOff />Hentikan tayang</Button>}
          {canUpdate && (offering.status === 'DRAFT' || offering.status === 'UNPUBLISHED') && <Button type="button" variant="ghost" onClick={() => setConfirm('archive')}><Archive />Arsipkan</Button>}
        </>}
      />
      {save.error && <Alert className="mb-5">{save.error.message}</Alert>}
      {actionError && !confirm && <Alert className="mb-5">{actionError.message}</Alert>}
      {archived && <Alert tone="info" className="mb-5">Layanan diarsipkan dan tidak dapat diubah. Riwayat order yang memakainya tetap utuh.</Alert>}
      {!archived && blockers.length > 0 && (
        <Alert tone="warning" className="mb-5">
          <p className="font-semibold">{offering.status === 'PUBLISHED' ? 'Layanan tidak tampil untuk pasien karena:' : 'Belum dapat dipublikasikan:'}</p>
          <ul className="mt-1 list-disc pl-5">{blockers.map((blocker) => <li key={blocker}>{BLOCKER_LABELS[blocker] ?? blocker}</li>)}</ul>
        </Alert>
      )}
      {offering.status === 'PUBLISHED' && <Alert tone="info" className="mb-5">Perubahan harga berlaku untuk order baru; order yang sudah dibuat menyimpan nama dan harga saat dipesan.</Alert>}
      <OfferingForm values={values} onChange={(patch) => setValues((current) => (current ? { ...current, ...patch } : current))} errors={errors} masterServiceLocked={offering.status !== 'DRAFT'} disabled={archived || !canUpdate} />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === 'publish' ? 'Publikasikan layanan?' : confirm === 'unpublish' ? 'Hentikan tayang layanan?' : 'Arsipkan layanan?'}
        description={confirm === 'publish' ? 'Layanan akan tampil dan dapat dipesan pasien.' : confirm === 'unpublish' ? 'Pasien tidak dapat lagi memesan layanan ini. Order yang sudah ada tidak berubah.' : 'Layanan arsip tidak dapat diubah atau dipublikasikan lagi.'}
        confirmLabel={confirm === 'publish' ? 'Publikasikan' : confirm === 'unpublish' ? 'Hentikan tayang' : 'Arsipkan'}
        destructive={confirm !== 'publish'}
        loading={action.isPending}
        onConfirm={() => confirm && action.mutate(confirm)}
      >
        {actionError && <Alert>{actionError.message}</Alert>}
      </ConfirmDialog>
    </form>
  );
}
