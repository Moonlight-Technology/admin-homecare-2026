'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { FacilityMediaPanel } from '@/features/facilities/media-panel';
import { ProfileFields } from '@/features/facilities/profile-fields';
import { emptyProfile, profileFromFacility, profilePayload, type Facility } from '@/features/facilities/types';
import { api, ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-provider';
import { canPlatform } from '@/lib/auth/types';

type Action = 'ACTIVATE' | 'SUSPEND' | 'INVITE';

export default function FacilityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [values, setValues] = useState(emptyProfile);
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState('');
  const allowed = canPlatform(me, 'facility:read');
  const editable = canPlatform(me, 'facility:update');
  const profile = useQuery({ queryKey: ['admin-facility', id], queryFn: () => api<Facility>(`/admin/facilities/${id}`), enabled: allowed });
  useEffect(() => { if (profile.data) setValues(profileFromFacility(profile.data)); }, [profile.data]);

  const refresh = (facility: Facility) => {
    queryClient.setQueryData(['admin-facility', id], facility);
    void queryClient.invalidateQueries({ queryKey: ['admin-facilities'] });
    void queryClient.invalidateQueries({ queryKey: ['facility-applications'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard', 'platform'] });
  };
  const update = useMutation({
    mutationFn: () => api<Facility>(`/admin/facilities/${id}`, { method: 'PATCH', body: profilePayload(values) }),
    onSuccess: (facility) => { refresh(facility); setNotice('Profil klinik berhasil disimpan.'); },
  });
  const change = useMutation({
    mutationFn: async ({ action: selected, reason }: { action: Action; reason?: string }) => {
      if (selected === 'INVITE') {
        await api<void>(`/admin/facilities/${id}/resend-invitation`, { method: 'POST' });
        return null;
      }
      return api<Facility>(`/admin/facilities/${id}/status`, { method: 'POST', body: { action: selected, reason } });
    },
    onSuccess: (facility, variables) => {
      if (facility) refresh(facility);
      setNotice(variables.action === 'INVITE' ? 'Undangan baru masuk antrean pengiriman. Tautan undangan sebelumnya tidak berlaku.' : variables.action === 'ACTIVATE' ? 'Klinik berhasil diaktifkan.' : 'Klinik berhasil disuspend.');
      setAction(null);
    },
  });
  const begin = (selected: Action) => { change.reset(); setNotice(''); setAction(selected); };
  const submit = (event: FormEvent) => { event.preventDefault(); setNotice(''); if (editable && !update.isPending) update.mutate(); };

  if (!allowed) return <ErrorState message="Anda tidak memiliki izin melihat klinik." />;
  if (profile.error) return <Card><ErrorState message={profile.error.message} onRetry={() => void profile.refetch()} /></Card>;
  if (!profile.data) return <Card><CardBody className="space-y-3">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-14" />)}</CardBody></Card>;
  const facility = profile.data;
  const busy = update.isPending || change.isPending;
  const errors = update.error instanceof ApiError ? update.error.fieldErrors : {};
  return (
    <>
      <PageHeader title={facility.displayName} breadcrumbs={[{ label: 'Klinik', href: '/admin/facilities' }, { label: 'Detail klinik' }]} description="Profil klinik, akun pemilik, dan kontrol operasional." />
      <div className="space-y-5">
        {notice && <Alert tone="success">{notice}</Alert>}
        <Card><CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2"><StatusBadge status={facility.verificationStatus} /><StatusBadge status={facility.operatingStatus} /></div>
          {facility.statusReason && <Alert tone="warning">Alasan status: {facility.statusReason}</Alert>}
          <p className="text-sm text-muted">Aktivasi hanya tersedia setelah klinik terverifikasi. Suspend memerlukan alasan dan tidak menghapus data klinik.</p>
          <div className="flex flex-wrap gap-2">
            {canPlatform(me, 'facility:status') && <>
              <Button variant="soft" disabled={busy || facility.verificationStatus !== 'VERIFIED' || facility.operatingStatus === 'ACTIVE'} onClick={() => begin('ACTIVATE')}>Aktifkan klinik</Button>
              <Button variant="destructive" disabled={busy || facility.operatingStatus === 'SUSPENDED'} onClick={() => begin('SUSPEND')}>Suspend klinik</Button>
            </>}
            {canPlatform(me, 'facility:review') && <Button asChild variant="secondary"><Link href="/admin/facility-applications">Buka antrean verifikasi</Link></Button>}
          </div>
          <div className="space-y-2 border-t border-line pt-4">
            <h2 className="text-sm font-semibold text-ink">Akun pemilik</h2>
            {facility.owner ? <><p className="break-words text-sm text-muted">{facility.owner.name} · {facility.owner.email}</p><StatusBadge status={facility.owner.status} />{facility.owner.status === 'INVITED' && canPlatform(me, 'facility:create') && <div><Button variant="secondary" disabled={busy} onClick={() => begin('INVITE')}>Kirim ulang undangan</Button><p className="mt-2 text-xs text-muted">Undangan menunggu dispatcher notifikasi. Tidak ada password atau token yang ditampilkan di sini.</p></div>}</> : <p className="text-sm text-muted">Belum ada pemilik aktif.</p>}
          </div>
        </CardBody></Card>
        <form onSubmit={submit}><Card><CardBody className="space-y-5">
          {!editable && <Alert tone="info">Anda memiliki akses baca saja.</Alert>}
          {update.error && <Alert>{update.error.message}</Alert>}
          <ProfileFields values={values} onChange={(patch) => setValues((current) => ({ ...current, ...patch }))} errors={errors} disabled={!editable || busy} />
          {editable && <div className="flex justify-end border-t border-line pt-5"><Button type="submit" loading={update.isPending} disabled={change.isPending}>Simpan perubahan</Button></div>}
        </CardBody></Card></form>
        <FacilityMediaPanel area="admin" facilityId={facility.id} />
      </div>
      <ConfirmDialog open={action === 'ACTIVATE' || action === 'INVITE'} onOpenChange={(open) => { if (!open) setAction(null); }} title={action === 'INVITE' ? 'Kirim ulang undangan pemilik?' : 'Aktifkan klinik?'} description={action === 'INVITE' ? 'Tautan lama akan dibatalkan dan undangan baru dimasukkan ke antrean notifikasi.' : 'Klinik terverifikasi akan diaktifkan beserta provider terkait.'} confirmLabel={action === 'INVITE' ? 'Kirim ulang' : 'Aktifkan'} loading={change.isPending} onConfirm={() => { if (action) change.mutate({ action }); }}>{change.error ? <Alert>{change.error.message}</Alert> : undefined}</ConfirmDialog>
      {action === 'SUSPEND' && <ReasonDialog open onOpenChange={(open) => { if (!open) setAction(null); }} title="Suspend klinik?" description="Klinik dan provider terkait akan disuspend. Data existing tetap tersimpan." label="Alasan suspend" confirmLabel="Suspend klinik" destructive loading={change.isPending} error={change.error?.message} maxLength={1000} onConfirm={(reason) => change.mutate({ action: 'SUSPEND', reason })} />}
    </>
  );
}
