'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Search, Stethoscope, Undo2, UserPlus, UserX } from 'lucide-react';
import { useState } from 'react';
import { Pagination } from '@/components/data/pagination';
import { Alert, EmptyState, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Select, Textarea } from '@/components/ui/fields';
import { FormField, Input } from '@/components/ui/input';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { stripFieldPrefix } from '@/features/facilities/api';
import { PractitionerFields } from '@/features/practitioners/practitioner-fields';
import { PractitionerDocumentsPanel } from '@/features/practitioners/documents-panel';
import { emptyPractitioner, practitionerPayload, primaryCredential, type Affiliation, type Paged, type PractitionerValues } from '@/features/practitioners/types';
import { useAuth } from '@/lib/auth/auth-provider';
import { canFacility } from '@/lib/auth/types';
import { api, ApiError } from '@/lib/api/client';
import { formatDate, formatDateTime } from '@/lib/format';

const LIMIT = 20;

type Found = { id: string; fullName: string; verificationStatus: string; operatingStatus: string; practitionerType: { id: string; name: string } };
type Step = { kind: 'lookup' } | { kind: 'found'; practitioner: Found } | { kind: 'register'; strNumber: string };

/**
 * Add a practitioner in two steps: look up the exact STR number; propose the practitioner found, or register a new
 * one in the same request when the number is not on file. Clinics never browse the practitioner directory.
 */
function ProposeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>({ kind: 'lookup' });
  const [strNumber, setStrNumber] = useState('');
  const [values, setValues] = useState<PractitionerValues>(emptyPractitioner);
  const [note, setNote] = useState('');
  const [startDate, setStartDate] = useState('');
  const reset = () => { setStep({ kind: 'lookup' }); setStrNumber(''); setValues(emptyPractitioner()); setNote(''); setStartDate(''); lookup.reset(); propose.reset(); };
  const close = () => { onOpenChange(false); reset(); };

  const lookup = useMutation({
    mutationFn: () => api<Found>('/clinic/practitioners/lookup', { method: 'POST', body: { strNumber: strNumber.trim() } }),
    onSuccess: (practitioner) => setStep({ kind: 'found', practitioner }),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 404) { setValues(emptyPractitioner(strNumber.trim())); setStep({ kind: 'register', strNumber: strNumber.trim() }); }
    },
  });
  const propose = useMutation({
    mutationFn: () => api<Affiliation>('/clinic/practitioner-affiliations', {
      method: 'POST',
      body: { ...(step.kind === 'found' ? { practitionerId: step.practitioner.id } : { practitioner: practitionerPayload(values) }), note: note.trim() || null, startDate: startDate || null },
    }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['clinic', 'affiliations'] }); close(); },
  });
  const proposeError = propose.error instanceof ApiError ? propose.error : null;
  const lookupError = lookup.error instanceof ApiError && lookup.error.status === 404 ? null : lookup.error;

  const terms = (
    <div className="space-y-4">
      <div className="sm:w-56"><FormField label="Mulai bertugas" error={proposeError?.fieldErrors.startDate?.[0]} hint="Kosongkan untuk mulai saat disetujui.">{(props) => <Input {...props} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />}</FormField></div>
      <FormField label="Peran / kompetensi di klinik" error={proposeError?.fieldErrors.note?.[0]} hint="Contoh: dokter umum homecare, perawat luka. Jangan isi data klinis.">{(props) => <Textarea {...props} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />}</FormField>
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (propose.isPending) return; if (next) onOpenChange(true); else close(); }}
      title={step.kind === 'register' ? 'Daftarkan tenaga kesehatan baru' : 'Tambah tenaga kesehatan'}
      description={step.kind === 'lookup' ? 'Cari dengan nomor STR lengkap.' : 'Usulan akan diverifikasi admin platform sebelum aktif.'}
      className={step.kind === 'register' ? 'sm:w-[min(92vw,680px)]' : undefined}
      footer={step.kind === 'lookup'
        ? <><Button variant="secondary" onClick={close}>Batal</Button><Button loading={lookup.isPending} disabled={strNumber.trim().length < 5} onClick={() => lookup.mutate()}><Search />Cari</Button></>
        : <><Button variant="secondary" onClick={() => { propose.reset(); setStep({ kind: 'lookup' }); }} disabled={propose.isPending}><ArrowLeft />Kembali</Button><Button loading={propose.isPending} onClick={() => propose.mutate()}>{step.kind === 'register' ? 'Daftarkan & usulkan' : 'Usulkan afiliasi'}</Button></>}
    >
      <div className="space-y-4">
        {propose.error && <Alert>{propose.error.message}</Alert>}
        {step.kind === 'lookup' && (
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (strNumber.trim().length >= 5) lookup.mutate(); }}>
            {lookupError && <Alert>{lookupError.message}</Alert>}
            <FormField label="Nomor STR" required hint="Nomor harus sama persis. Bila belum terdaftar, Anda dapat mendaftarkannya.">{(props) => <Input {...props} autoFocus autoComplete="off" spellCheck={false} maxLength={60} value={strNumber} onChange={(event) => setStrNumber(event.target.value)} />}</FormField>
          </form>
        )}
        {step.kind === 'found' && (
          <>
            <div className="rounded-[var(--radius-input)] border border-line bg-app p-4">
              <p className="text-xs text-muted">Ditemukan</p>
              <p className="font-semibold text-ink">{step.practitioner.fullName}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">{step.practitioner.practitionerType.name}<StatusBadge status={step.practitioner.verificationStatus} /></div>
              {step.practitioner.operatingStatus === 'SUSPENDED' && <Alert className="mt-3">Nakes ini sedang disuspend platform; usulan tidak akan disetujui.</Alert>}
            </div>
            {terms}
          </>
        )}
        {step.kind === 'register' && (
          <>
            <Alert tone="info">STR {step.strNumber} belum terdaftar. Lengkapi data berikut; admin platform akan memverifikasinya.</Alert>
            <PractitionerFields values={values} onChange={(patch) => setValues((current) => ({ ...current, ...patch }))} errors={stripFieldPrefix(proposeError?.fieldErrors ?? {}, 'practitioner.')} />
            {terms}
          </>
        )}
      </div>
    </Dialog>
  );
}

export default function ClinicPractitionersPage() {
  const queryClient = useQueryClient();
  const { me } = useAuth();
  const canManage = canFacility(me, 'affiliation:manage');
  const facility = me?.memberships.find((membership) => membership.facility?.id === me.facility?.facilityId)?.facility;
  const verified = facility?.verificationStatus === 'VERIFIED';
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [proposing, setProposing] = useState(false);
  const [documentsFor, setDocumentsFor] = useState<Affiliation | null>(null);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [withdrawing, setWithdrawing] = useState<Affiliation | null>(null);
  const [ending, setEnding] = useState<Affiliation | null>(null);
  const affiliations = useQuery({
    queryKey: ['clinic', 'affiliations', status, page],
    queryFn: () => api<Paged<Affiliation>>('/clinic/practitioner-affiliations', { query: { status, page, limit: LIMIT } }),
    placeholderData: keepPreviousData,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; action: 'WITHDRAW' | 'END'; reason?: string }) => api<Affiliation>(`/clinic/practitioner-affiliations/${id}`, { method: 'PATCH', body }),
    onSuccess: () => { setWithdrawing(null); setEnding(null); void queryClient.invalidateQueries({ queryKey: ['clinic', 'affiliations'] }); },
  });
  const items = affiliations.data?.items ?? [];
  const counts = affiliations.data?.counts ?? {};

  return (
    <>
      <PageHeader title="Tenaga kesehatan" breadcrumbs={[{ label: 'Dashboard', href: '/clinic' }, { label: 'Tenaga kesehatan' }]} description="Nakes yang berafiliasi dengan klinik Anda. Hanya nakes aktif dan terafiliasi yang dapat ditugaskan." actions={canManage && <Button onClick={() => setProposing(true)} disabled={!verified}><UserPlus />Tambah nakes</Button>} />
      {canManage && !verified && <Alert tone="warning" className="mb-5">Klinik harus terverifikasi sebelum dapat mengusulkan tenaga kesehatan.</Alert>}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4 sm:p-5">
          <p className="text-sm text-muted">{counts.ACTIVE ?? 0} aktif · {counts.PROPOSED ?? 0} menunggu persetujuan platform</p>
          <div className="w-full sm:w-56"><Select aria-label="Status afiliasi" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">Semua status</option><option value="ACTIVE">Aktif</option><option value="PROPOSED">Diusulkan</option><option value="REJECTED">Ditolak</option><option value="ENDED">Berakhir</option></Select></div>
        </div>
        {update.error && !withdrawing && !ending && <Alert className="m-4">{update.error.message}</Alert>}
        {affiliations.error ? <ErrorState message={affiliations.error.message} onRetry={() => void affiliations.refetch()} /> : affiliations.isLoading ? <div className="space-y-3 p-5">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-14" />)}</div> : !items.length ? <EmptyState icon={Stethoscope} title="Belum ada tenaga kesehatan" description="Tambahkan nakes dengan nomor STR mereka." /> : (
          <ul className="divide-y divide-line">{items.map((item) => {
            const credential = primaryCredential(item.practitioner.credentials);
            return (
              <li key={item.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-ink">{item.practitioner.fullName}</p><StatusBadge status={item.status} />{item.practitioner.operatingStatus === 'SUSPENDED' && <StatusBadge status="SUSPENDED" />}</div>
                  <p className="text-xs text-muted">{item.practitioner.practitionerType.name}{credential && ` · ${credential.credentialType} ${credential.numberMasked}`} · {item.startDate ? `mulai ${formatDate(item.startDate)}` : `diusulkan ${formatDateTime(item.createdAt)}`}{item.endDate && ` · berakhir ${formatDate(item.endDate)}`}</p>
                  {item.note && <p className="text-sm text-ink">{item.note}</p>}
                  {item.status === 'PROPOSED' && item.practitioner.verificationStatus !== 'VERIFIED' && <p className="text-xs text-warning">Menunggu verifikasi nakes oleh platform.</p>}
                  {item.reason && <p className="text-xs text-muted">Alasan: {item.reason}</p>}
                </div>
                {canManage && (item.status === 'PROPOSED' || item.status === 'ACTIVE') && (
                  <div className="flex shrink-0 gap-2">
                    {item.practitioner.canManageDocuments && <Button variant="secondary" size="sm" onClick={() => setDocumentsFor(item)}>Scan STR / SIP</Button>}
                    {item.status === 'PROPOSED' ? <Button variant="secondary" size="sm" onClick={() => setWithdrawing(item)}><Undo2 />Batalkan usulan</Button> : <Button variant="secondary" size="sm" onClick={() => setEnding(item)}><UserX />Akhiri afiliasi</Button>}
                  </div>
                )}
              </li>
            );
          })}</ul>
        )}
        <Pagination page={page} limit={LIMIT} total={affiliations.data?.total ?? 0} onPageChange={setPage} />
      </Card>
      <ProposeDialog open={proposing} onOpenChange={setProposing} />
      {documentsFor && <Dialog open onOpenChange={(open) => { if (!open && !uploadingDocument) setDocumentsFor(null); }} title={`Dokumen ${documentsFor.practitioner.fullName}`} description="Kelola scan nakes yang didaftarkan oleh klinik ini." className="sm:w-[min(92vw,680px)]"><PractitionerDocumentsPanel practitionerId={documentsFor.practitioner.id} area="clinic" onBusyChange={setUploadingDocument} /></Dialog>}
      <ConfirmDialog open={withdrawing !== null} onOpenChange={(open) => !open && setWithdrawing(null)} title="Batalkan usulan?" description={withdrawing ? `Usulan afiliasi ${withdrawing.practitioner.fullName} akan dibatalkan.` : undefined} confirmLabel="Batalkan usulan" destructive loading={update.isPending} onConfirm={() => withdrawing && update.mutate({ id: withdrawing.id, action: 'WITHDRAW' })}>{update.error && <Alert>{update.error.message}</Alert>}</ConfirmDialog>
      <ReasonDialog open={ending !== null} onOpenChange={(open) => !open && setEnding(null)} title="Akhiri afiliasi?" description="Nakes tidak dapat lagi ditugaskan pada order klinik Anda." label="Alasan" confirmLabel="Akhiri afiliasi" destructive loading={update.isPending} error={update.error?.message} onConfirm={(reason) => ending && update.mutate({ id: ending.id, action: 'END', reason })} />
    </>
  );
}
