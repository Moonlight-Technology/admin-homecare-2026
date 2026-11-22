'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Handshake, Plus, Search, Stethoscope, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { Pagination } from '@/components/data/pagination';
import { Alert, EmptyState, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/fields';
import { Input } from '@/components/ui/input';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PractitionerFields } from '@/features/practitioners/practitioner-fields';
import { emptyPractitioner, practitionerPayload, primaryCredential, type Affiliation, type Paged, type PractitionerDetail, type PractitionerRow, type PractitionerValues } from '@/features/practitioners/types';
import { useAuth } from '@/lib/auth/auth-provider';
import { canPlatform } from '@/lib/auth/types';
import { api, ApiError } from '@/lib/api/client';
import { formatDate, formatDateTime } from '@/lib/format';

const LIMIT = 20;

function CreatePractitionerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<PractitionerValues>(emptyPractitioner);
  const create = useMutation({
    mutationFn: () => api<PractitionerDetail>('/admin/practitioners', { method: 'POST', body: practitionerPayload(values) }),
    onSuccess: (created) => { void queryClient.invalidateQueries({ queryKey: ['practitioners'] }); onOpenChange(false); setValues(emptyPractitioner()); router.push(`/admin/practitioners/${created.id}`); },
  });
  const error = create.error instanceof ApiError ? create.error : null;
  const existingId = (error?.details as { practitionerId?: string } | undefined)?.practitionerId;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !create.isPending && onOpenChange(next)}
      title="Tambah tenaga kesehatan"
      description="Data masuk antrean verifikasi. Pendaftaran bukan verifikasi."
      className="sm:w-[min(92vw,680px)]"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)} disabled={create.isPending}>Batal</Button><Button loading={create.isPending} onClick={() => create.mutate()}>Simpan & kirim ke review</Button></>}
    >
      <div className="space-y-4">
        {create.error && <Alert>{create.error.message}{existingId && <> <Link className="font-semibold underline" href={`/admin/practitioners/${existingId}`}>Buka data yang sudah ada</Link></>}</Alert>}
        <PractitionerFields values={values} onChange={(patch) => setValues((current) => ({ ...current, ...patch }))} errors={error?.fieldErrors ?? {}} />
      </div>
    </Dialog>
  );
}

function PractitionerDirectory() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('SUBMITTED');
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search.trim());
  const practitioners = useQuery({
    queryKey: ['practitioners', deferredSearch, status, page],
    queryFn: () => api<Paged<PractitionerRow>>('/admin/practitioners', { query: { search: deferredSearch, verificationStatus: status, page, limit: LIMIT } }),
    placeholderData: keepPreviousData,
  });
  const items = practitioners.data?.items ?? [];
  return (
    <Card>
      <div className="grid grid-cols-1 gap-3 border-b border-line p-4 sm:grid-cols-[minmax(0,1fr)_220px] sm:p-5">
        <Input icon={Search} placeholder="Cari nama, email, atau nomor STR/SIP lengkap..." aria-label="Cari tenaga kesehatan" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        <Select aria-label="Status verifikasi" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          <option value="">Semua status</option><option value="SUBMITTED">Menunggu review</option><option value="UNDER_REVIEW">Sedang direview</option><option value="VERIFIED">Terverifikasi</option><option value="REVISION_REQUIRED">Perlu revisi</option><option value="REJECTED">Ditolak</option>
        </Select>
      </div>
      {practitioners.error ? <ErrorState message={practitioners.error.message} onRetry={() => void practitioners.refetch()} /> : practitioners.isLoading ? <div className="space-y-3 p-5">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-14" />)}</div> : !items.length ? <EmptyState icon={Stethoscope} title="Tidak ada data" description="Tidak ada tenaga kesehatan yang cocok dengan filter saat ini." /> : (
        <>
          <ul className="divide-y divide-line md:hidden">{items.map((item) => { const credential = primaryCredential(item.credentials); return <li key={item.id}><Link href={`/admin/practitioners/${item.id}`} className="block space-y-1 px-4 py-4 hover:bg-app"><div className="flex items-start justify-between gap-3"><p className="font-semibold text-ink">{item.fullName}</p><StatusBadge status={item.verificationStatus} /></div><p className="text-xs text-muted">{item.practitionerType.name}{credential && ` · ${credential.credentialType} ${credential.numberMasked}`} · {item.activeAffiliations} klinik</p></Link></li>; })}</ul>
          <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead className="bg-app text-xs font-semibold uppercase tracking-wide text-muted"><tr><th className="px-5 py-3">Nama</th><th className="px-5 py-3">Jenis</th><th className="px-5 py-3">Kredensial</th><th className="px-5 py-3">Klinik aktif</th><th className="px-5 py-3">Diperbarui</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-line">{items.map((item) => { const credential = primaryCredential(item.credentials); return <tr key={item.id} className="hover:bg-app/60"><td className="px-5 py-3"><Link href={`/admin/practitioners/${item.id}`} className="font-semibold text-primary-700 hover:underline">{item.fullName}</Link><span className="block text-xs text-muted">{item.registeredVia === 'CLINIC' ? 'Didaftarkan klinik' : 'Didaftarkan admin'}</span></td><td className="px-5 py-3 text-muted">{item.practitionerType.name}</td><td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-muted">{credential ? `${credential.credentialType} ${credential.numberMasked}` : '—'}</td><td className="px-5 py-3 text-muted">{item.activeAffiliations}</td><td className="whitespace-nowrap px-5 py-3 text-muted">{formatDateTime(item.updatedAt)}</td><td className="px-5 py-3"><div className="flex flex-wrap gap-1.5"><StatusBadge status={item.verificationStatus} />{item.operatingStatus !== 'INACTIVE' && <StatusBadge status={item.operatingStatus} />}</div></td></tr>; })}</tbody></table></div>
        </>
      )}
      <Pagination page={page} limit={LIMIT} total={practitioners.data?.total ?? 0} onPageChange={setPage} />
    </Card>
  );
}

function AffiliationQueue({ canReview }: { canReview: boolean }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('PROPOSED');
  const [page, setPage] = useState(1);
  const [approving, setApproving] = useState<Affiliation | null>(null);
  const [rejecting, setRejecting] = useState<Affiliation | null>(null);
  const affiliations = useQuery({
    queryKey: ['admin-affiliations', status, page],
    queryFn: () => api<Paged<Affiliation>>('/admin/practitioner-affiliations', { query: { status, page, limit: LIMIT } }),
    placeholderData: keepPreviousData,
  });
  const decide = useMutation({
    mutationFn: ({ id, ...body }: { id: string; decision: 'APPROVE' | 'REJECT'; reason?: string }) => api<Affiliation>(`/admin/practitioner-affiliations/${id}/reviews`, { method: 'POST', body }),
    onSuccess: () => { setApproving(null); setRejecting(null); void queryClient.invalidateQueries({ queryKey: ['admin-affiliations'] }); void queryClient.invalidateQueries({ queryKey: ['practitioner'] }); },
  });
  const items = affiliations.data?.items ?? [];
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4 sm:p-5">
        <p className="text-sm text-muted">Klinik mengusulkan, admin platform memverifikasi. Nakes harus sudah terverifikasi sebelum usulan disetujui.</p>
        <div className="w-full sm:w-56"><Select aria-label="Status afiliasi" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="PROPOSED">Diusulkan</option><option value="ACTIVE">Aktif</option><option value="REJECTED">Ditolak</option><option value="ENDED">Berakhir</option><option value="">Semua</option></Select></div>
      </div>
      {decide.error && !approving && !rejecting && <Alert className="m-4">{decide.error.message}</Alert>}
      {affiliations.error ? <ErrorState message={affiliations.error.message} onRetry={() => void affiliations.refetch()} /> : affiliations.isLoading ? <div className="space-y-3 p-5">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-14" />)}</div> : !items.length ? <EmptyState icon={Handshake} title="Tidak ada usulan" description="Tidak ada afiliasi dengan status ini." /> : (
        <ul className="divide-y divide-line">{items.map((item) => (
          <li key={item.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2"><Link href={`/admin/practitioners/${item.practitioner.id}`} className="font-semibold text-primary-700 hover:underline">{item.practitioner.fullName}</Link><StatusBadge status={item.practitioner.verificationStatus} /></div>
              <p className="text-xs text-muted">{item.practitioner.practitionerType.name} · diusulkan oleh <span className="font-medium text-ink">{item.facility.displayName}</span> · {formatDateTime(item.createdAt)}{item.startDate && ` · mulai ${formatDate(item.startDate)}`}</p>
              {item.note && <p className="text-sm text-ink">{item.note}</p>}
              {item.reason && <p className="text-xs text-muted">Alasan: {item.reason}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusBadge status={item.status} />
              {canReview && item.status === 'PROPOSED' && <><Button variant="secondary" size="sm" onClick={() => setRejecting(item)}><X />Tolak</Button><Button size="sm" disabled={item.practitioner.verificationStatus !== 'VERIFIED'} title={item.practitioner.verificationStatus !== 'VERIFIED' ? 'Verifikasi nakes terlebih dahulu' : undefined} onClick={() => setApproving(item)}><Check />Setujui</Button></>}
            </div>
          </li>
        ))}</ul>
      )}
      <Pagination page={page} limit={LIMIT} total={affiliations.data?.total ?? 0} onPageChange={setPage} />
      <ConfirmDialog open={approving !== null} onOpenChange={(open) => !open && setApproving(null)} title="Setujui afiliasi?" description={approving ? `${approving.practitioner.fullName} akan aktif sebagai tenaga kesehatan ${approving.facility.displayName}.` : undefined} confirmLabel="Setujui afiliasi" loading={decide.isPending} onConfirm={() => approving && decide.mutate({ id: approving.id, decision: 'APPROVE' })}>{decide.error && <Alert>{decide.error.message}</Alert>}</ConfirmDialog>
      <ReasonDialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)} title="Tolak usulan afiliasi?" description="Alasan akan terlihat oleh klinik." label="Alasan penolakan" confirmLabel="Tolak usulan" destructive loading={decide.isPending} error={decide.error?.message} onConfirm={(reason) => rejecting && decide.mutate({ id: rejecting.id, decision: 'REJECT', reason })} />
    </Card>
  );
}

export default function AdminPractitionersPage() {
  const { me } = useAuth();
  const canReview = canPlatform(me, 'practitioner:review');
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader title="Tenaga kesehatan" breadcrumbs={[{ label: 'Dashboard', href: '/admin' }, { label: 'Tenaga kesehatan' }]} description="Verifikasi identitas dan kredensial nakes, serta afiliasi mereka dengan klinik." actions={canReview && <Button onClick={() => setCreating(true)}><Plus />Tambah nakes</Button>} />
      <Tabs defaultValue="directory" className="space-y-4">
        <TabsList><TabsTrigger value="directory"><Stethoscope className="size-4" />Nakes</TabsTrigger><TabsTrigger value="affiliations"><Handshake className="size-4" />Usulan afiliasi</TabsTrigger></TabsList>
        <TabsContent value="directory"><PractitionerDirectory /></TabsContent>
        <TabsContent value="affiliations"><AffiliationQueue canReview={canReview} /></TabsContent>
      </Tabs>
      <CreatePractitionerDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
