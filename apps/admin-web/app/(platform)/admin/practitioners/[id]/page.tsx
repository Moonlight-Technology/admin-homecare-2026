'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, Eye, EyeOff, FileWarning, Pencil, Play, Plus, Power, Send, X } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, EmptyState, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/fields';
import { FormField, Input } from '@/components/ui/input';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { useMasterOptions } from '@/features/facilities/api';
import type { Review } from '@/features/facilities/types';
import { CredentialFields } from '@/features/practitioners/practitioner-fields';
import { ReviewList } from '@/features/practitioners/review-list';
import { credentialPayload, emptyCredential, type Credential, type CredentialValues, type PractitionerDetail } from '@/features/practitioners/types';
import { useAuth } from '@/lib/auth/auth-provider';
import { canPlatform } from '@/lib/auth/types';
import { api, ApiError } from '@/lib/api/client';
import { formatDate, formatDateTime } from '@/lib/format';

type Profile = { fullName: string; practitionerTypeId: string; phone: string; email: string };

function EditProfileDialog({ practitioner, open, onOpenChange, onSaved }: { practitioner: PractitionerDetail; open: boolean; onOpenChange: (open: boolean) => void; onSaved: (data: PractitionerDetail) => void }) {
  const options = useMasterOptions();
  const [values, setValues] = useState<Profile>({ fullName: practitioner.fullName, practitionerTypeId: practitioner.practitionerType.id, phone: practitioner.phone ?? '', email: practitioner.email ?? '' });
  const save = useMutation({
    mutationFn: () => api<PractitionerDetail>(`/admin/practitioners/${practitioner.id}`, { method: 'PATCH', body: { fullName: values.fullName.trim(), practitionerTypeId: values.practitionerTypeId, phone: values.phone.trim() || null, email: values.email.trim() || null } }),
    onSuccess: (data) => { onSaved(data); onOpenChange(false); },
  });
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {};
  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)} title="Ubah identitas" description="Perubahan tercatat di audit log." footer={<><Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Simpan</Button></>}>
      <div className="space-y-4">
        {save.error && <Alert>{save.error.message}</Alert>}
        <FormField label="Nama lengkap dengan gelar" required error={errors.fullName?.[0]}>{(props) => <Input {...props} maxLength={160} value={values.fullName} onChange={(event) => setValues({ ...values, fullName: event.target.value })} />}</FormField>
        <FormField label="Jenis tenaga kesehatan" required error={errors.practitionerTypeId?.[0]}>{(props) => <Select {...props} value={values.practitionerTypeId} onChange={(event) => setValues({ ...values, practitionerTypeId: event.target.value })}>{(options.data?.practitionerTypes ?? [practitioner.practitionerType]).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</Select>}</FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Telepon" error={errors.phone?.[0]}>{(props) => <Input {...props} type="tel" value={values.phone} onChange={(event) => setValues({ ...values, phone: event.target.value })} />}</FormField>
          <FormField label="Email" error={errors.email?.[0]}>{(props) => <Input {...props} type="email" value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} />}</FormField>
        </div>
      </div>
    </Dialog>
  );
}

function AddCredentialDialog({ practitionerId, open, onOpenChange, onSaved }: { practitionerId: string; open: boolean; onOpenChange: (open: boolean) => void; onSaved: (data: PractitionerDetail) => void }) {
  const [values, setValues] = useState<CredentialValues>(() => emptyCredential('SIP'));
  const save = useMutation({
    mutationFn: () => api<PractitionerDetail>(`/admin/practitioners/${practitionerId}/credentials`, { method: 'POST', body: credentialPayload(values) }),
    onSuccess: (data) => { onSaved(data); onOpenChange(false); setValues(emptyCredential('SIP')); },
  });
  return (
    <Dialog open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)} title="Tambah kredensial" footer={<><Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>Batal</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Tambah</Button></>}>
      <div className="space-y-4">
        {save.error && <Alert>{save.error.message}</Alert>}
        <CredentialFields values={values} onChange={(patch) => setValues((current) => ({ ...current, ...patch }))} errors={save.error instanceof ApiError ? save.error.fieldErrors : {}} />
      </div>
    </Dialog>
  );
}

/** Masked by default; revealing fetches the number on demand (audited) and never caches it. */
function CredentialRow({ practitionerId, credential, canReveal }: { practitionerId: string; credential: Credential; canReveal: boolean }) {
  const [number, setNumber] = useState<string | null>(null);
  const reveal = useMutation({
    mutationFn: () => api<{ number: string }>(`/admin/practitioners/${practitionerId}/credentials/${credential.id}/reveal`, { method: 'POST' }),
    onSuccess: (data) => setNumber(data.number),
  });
  const expired = credential.validUntil !== null && new Date(credential.validUntil) < new Date(new Date().toDateString());
  return (
    <li className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><span className="rounded bg-primary-50 px-2 py-0.5 text-xs font-bold text-primary-700">{credential.credentialType}</span><span className="font-mono text-sm text-ink">{number ?? credential.numberMasked}</span>{credential.reviewStatus === 'ACCEPTED' && <StatusBadge status="VERIFIED" />}{expired && <span className="text-xs font-semibold text-danger">Kedaluwarsa</span>}</div>
        <p className="mt-1 text-xs text-muted">{credential.issuingAuthority ?? 'Penerbit tidak diisi'} · {credential.validFrom ? formatDate(credential.validFrom) : '—'} s.d. {credential.validUntil ? formatDate(credential.validUntil) : 'seumur hidup'}</p>
        {reveal.error && <p className="mt-1 text-xs text-danger">{reveal.error.message}</p>}
      </div>
      {canReveal && (number
        ? <Button variant="ghost" size="sm" onClick={() => setNumber(null)}><EyeOff />Sembunyikan</Button>
        : <Button variant="secondary" size="sm" loading={reveal.isPending} onClick={() => reveal.mutate()}><Eye />Lihat nomor</Button>)}
    </li>
  );
}

export default function PractitionerDetailPage() {
  const id = useParams<{ id: string }>().id;
  const queryClient = useQueryClient();
  const { me } = useAuth();
  const canReview = canPlatform(me, 'practitioner:review');
  const canStatus = canPlatform(me, 'practitioner:status');
  const [approveOpen, setApproveOpen] = useState(false);
  const [reasonAction, setReasonAction] = useState<Review['decision'] | 'SUSPEND' | null>(null);
  const [activateOpen, setActivateOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addingCredential, setAddingCredential] = useState(false);
  const detail = useQuery({ queryKey: ['practitioner', id], queryFn: () => api<PractitionerDetail>(`/admin/practitioners/${id}`) });
  const refresh = (data: PractitionerDetail) => { queryClient.setQueryData(['practitioner', id], data); void queryClient.invalidateQueries({ queryKey: ['practitioners'] }); };
  const closeDialogs = () => { setApproveOpen(false); setReasonAction(null); setActivateOpen(false); };
  const post = (path: string, body?: unknown) => api<PractitionerDetail>(`/admin/practitioners/${id}${path}`, { method: 'POST', body });
  const start = useMutation({ mutationFn: () => post('/start-review'), onSuccess: refresh });
  const submit = useMutation({ mutationFn: () => post('/submit'), onSuccess: refresh });
  const decide = useMutation({ mutationFn: (body: { decision: Review['decision']; reason?: string }) => post('/reviews', body), onSuccess: (data) => { refresh(data); closeDialogs(); } });
  const status = useMutation({ mutationFn: (body: { action: 'ACTIVATE' | 'SUSPEND'; reason?: string }) => post('/status', body), onSuccess: (data) => { refresh(data); closeDialogs(); } });

  const breadcrumbs = [{ label: 'Tenaga kesehatan', href: '/admin/practitioners' }, { label: 'Detail' }];
  if (detail.error) return <><PageHeader title="Detail tenaga kesehatan" breadcrumbs={breadcrumbs} /><Card><ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} /></Card></>;
  if (!detail.data) return <div className="py-20 text-center text-sm text-muted">Memuat data...</div>;
  const data = detail.data;
  const open = ['SUBMITTED', 'UNDER_REVIEW'].includes(data.verificationStatus);
  const actionError = start.error ?? submit.error ?? decide.error ?? status.error;

  return (
    <>
      <PageHeader
        title={data.fullName}
        breadcrumbs={breadcrumbs}
        description={`${data.practitionerType.name} · ${data.registeredVia === 'CLINIC' ? `didaftarkan oleh ${data.registeredByFacility?.displayName ?? 'klinik'}` : 'didaftarkan admin'} · ${formatDateTime(data.createdAt)}`}
        actions={<>
          <StatusBadge status={data.verificationStatus} />
          <StatusBadge status={data.operatingStatus} />
          {canReview && data.verificationStatus === 'SUBMITTED' && <Button variant="secondary" loading={start.isPending} onClick={() => start.mutate()}><Play />Mulai review</Button>}
          {canReview && open && <><Button variant="soft" onClick={() => setReasonAction('REQUEST_REVISION')}><FileWarning />Minta revisi</Button><Button variant="destructive" onClick={() => setReasonAction('REJECT')}><X />Tolak</Button><Button onClick={() => setApproveOpen(true)} disabled={Object.keys(data.missing).length > 0}><Check />Verifikasi</Button></>}
          {canReview && data.canSubmit && <Button variant="secondary" loading={submit.isPending} onClick={() => submit.mutate()}><Send />Kirim ulang ke review</Button>}
          {canStatus && data.verificationStatus === 'VERIFIED' && (data.operatingStatus === 'ACTIVE'
            ? <Button variant="destructive" onClick={() => setReasonAction('SUSPEND')}><Ban />Suspend</Button>
            : <Button variant="secondary" onClick={() => setActivateOpen(true)}><Power />Aktifkan</Button>)}
        </>}
      />
      {actionError && !approveOpen && !reasonAction && !activateOpen && <Alert className="mb-5">{actionError.message}</Alert>}
      {data.statusReason && <Alert tone="warning" className="mb-5">{data.operatingStatus === 'SUSPENDED' ? 'Alasan suspend' : 'Catatan reviewer'}: {data.statusReason}</Alert>}
      {Object.keys(data.missing).length > 0 && <Alert tone="warning" className="mb-5">Belum ada STR yang berlaku. Tambahkan STR sebelum memverifikasi.</Alert>}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Identitas" action={canReview && <Button variant="secondary" size="sm" onClick={() => setEditing(true)}><Pencil />Ubah</Button>} />
            <CardBody><dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2"><div><dt className="text-xs text-muted">Nama</dt><dd className="font-medium text-ink">{data.fullName}</dd></div><div><dt className="text-xs text-muted">Jenis</dt><dd className="font-medium text-ink">{data.practitionerType.name}</dd></div><div><dt className="text-xs text-muted">Telepon</dt><dd className="font-medium text-ink">{data.phone ?? '—'}</dd></div><div><dt className="text-xs text-muted">Email</dt><dd className="font-medium text-ink">{data.email ?? '—'}</dd></div>{data.verifiedAt && <div><dt className="text-xs text-muted">Terverifikasi</dt><dd className="font-medium text-ink">{formatDateTime(data.verifiedAt)}</dd></div>}</dl></CardBody>
          </Card>
          <Card>
            <CardHeader title="Kredensial" description="Nomor tersamar. Membuka nomor lengkap tercatat di audit log." action={canReview && <Button variant="secondary" size="sm" onClick={() => setAddingCredential(true)}><Plus />Tambah</Button>} />
            <CardBody className="pt-0"><ul className="divide-y divide-line">{data.credentials.map((credential) => <CredentialRow key={credential.id} practitionerId={data.id} credential={credential} canReveal={canReview} />)}</ul></CardBody>
          </Card>
          <Card>
            <CardHeader title="Afiliasi klinik" />
            <CardBody className="pt-0">{data.affiliations.length ? <ul className="divide-y divide-line">{data.affiliations.map((affiliation) => <li key={affiliation.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-semibold text-ink">{affiliation.facility.displayName}</p><p className="text-xs text-muted">{affiliation.startDate ? `Mulai ${formatDate(affiliation.startDate)}` : `Diusulkan ${formatDateTime(affiliation.createdAt)}`}{affiliation.endDate && ` · berakhir ${formatDate(affiliation.endDate)}`}{affiliation.note && ` · ${affiliation.note}`}</p>{affiliation.reason && <p className="text-xs text-muted">Alasan: {affiliation.reason}</p>}</div><StatusBadge status={affiliation.status} /></li>)}</ul> : <EmptyState title="Belum ada afiliasi" description="Usulan dari klinik akan muncul di sini." />}</CardBody>
          </Card>
        </div>
        <Card><CardHeader title="Riwayat verifikasi" /><CardBody><ReviewList reviews={data.history} /></CardBody></Card>
      </div>
      {editing && <EditProfileDialog practitioner={data} open={editing} onOpenChange={setEditing} onSaved={refresh} />}
      <AddCredentialDialog practitionerId={data.id} open={addingCredential} onOpenChange={setAddingCredential} onSaved={refresh} />
      <ConfirmDialog open={approveOpen} onOpenChange={setApproveOpen} title="Verifikasi tenaga kesehatan?" description="Kredensial diterima dan nakes diaktifkan sehingga afiliasinya dapat disetujui." confirmLabel="Verifikasi" loading={decide.isPending} onConfirm={() => decide.mutate({ decision: 'APPROVE' })}>{decide.error && <Alert>{decide.error.message}</Alert>}</ConfirmDialog>
      <ConfirmDialog open={activateOpen} onOpenChange={setActivateOpen} title="Aktifkan tenaga kesehatan?" description="Nakes dapat kembali ditugaskan oleh klinik afiliasinya." confirmLabel="Aktifkan" loading={status.isPending} onConfirm={() => status.mutate({ action: 'ACTIVATE' })}>{status.error && <Alert>{status.error.message}</Alert>}</ConfirmDialog>
      <ReasonDialog
        open={reasonAction !== null}
        onOpenChange={(openDialog) => !openDialog && setReasonAction(null)}
        title={reasonAction === 'SUSPEND' ? 'Suspend tenaga kesehatan?' : reasonAction === 'REJECT' ? 'Tolak verifikasi?' : 'Minta revisi?'}
        description={reasonAction === 'SUSPEND' ? 'Nakes tidak dapat ditugaskan selama disuspend.' : 'Catatan tersimpan permanen pada riwayat verifikasi.'}
        label={reasonAction === 'SUSPEND' ? 'Alasan suspend' : 'Catatan reviewer'}
        confirmLabel={reasonAction === 'SUSPEND' ? 'Suspend' : reasonAction === 'REJECT' ? 'Tolak' : 'Kirim permintaan revisi'}
        destructive={reasonAction === 'REJECT' || reasonAction === 'SUSPEND'}
        loading={decide.isPending || status.isPending}
        error={(reasonAction === 'SUSPEND' ? status.error : decide.error)?.message}
        onConfirm={(reason) => {
          if (reasonAction === 'SUSPEND') status.mutate({ action: 'SUSPEND', reason });
          else if (reasonAction) decide.mutate({ decision: reasonAction, reason });
        }}
      />
    </>
  );
}
